// §A5.1 keeper-downtime mitigation — "Sync Now": lets ANY connected wallet permissionlessly
// trigger `recognize_hub_pot_inflow` (skims the OTC Desks launcher's automatic vault payout into
// the 4 pending buckets) and `open_hub_pot_round` (snapshots pending into a new claimable round),
// mirroring `scripts/mainnet-recognize-hub-pot-inflow.ts` / `scripts/mainnet-open-hub-pot-round.ts`'s
// own account-resolution logic. Both instructions are permissionless and fully deterministic (see
// their IDL docs — "anyone may trigger reconciliation", "nothing for a caller to gain beyond
// paying their own tx fee") — this is a UI escape hatch for when the mainnet keeper cron
// (`hub-keeper-hub-pot-round-mainnet`) stalls, not a privileged action.
//
// Bundled into ONE atomic transaction when both steps are needed, so `open_hub_pot_round` sees
// `recognize_hub_pot_inflow`'s freshly credited pending buckets within the same tx. A dry-run
// simulation of `recognize_hub_pot_inflow` alone decides whether it's worth including — the
// on-chain `NoHubPotInflow` revert (no new inflow since the last recognition) is treated as a
// clean signal, not a failure, same as the mainnet script.
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  ataPda,
  configPda,
  createAtaIdempotentIx,
  fetchHubPot,
  fetchProtocolState,
  hubPotInflowPda,
  hubPotPda,
  hubPotRoundPda,
  treasuryPda,
  vaultPda,
  type HubPotView,
  type HubProgram,
} from "@hub-sdk";
import type { TxLog } from "./swap";
import type { WalletSigner } from "./wallets";

export type HubPotSyncPhase = "check" | "build" | "sim" | "sign" | "send" | "confirm";
export type HubPotSyncResult =
  | { ok: true; skipped: true; reason: string }
  | { ok: true; skipped: false; sig: string; recognized: boolean }
  | { ok: false; reason: string };

const CU_LIMIT = 600_000;
const CU_PRICE_MICRO = 10_000;
const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");

const pendingIsZero = (p: HubPotView) =>
  p.otcPendingUnits === 0n &&
  p.crclxPendingUnits === 0n &&
  p.nvdaxPendingUnits === 0n &&
  p.spcxxPendingUnits === 0n;

const simFailReason = (logs: string[] | null | undefined, err: unknown) => {
  const line = logs?.find((l) => /Error Message|Error Code/.test(l));
  return line?.replace("Program log: ", "") ?? JSON.stringify(err);
};

/** Unsigned `open_hub_pot_round` instruction. `round`'s PDA is derived from `pot.roundCount`
 *  directly (no extra RPC needed — the caller already has a fresh `HubPotView`). */
export async function buildOpenHubPotRoundIx(
  program: HubProgram,
  payer: PublicKey,
  pot: HubPotView,
): Promise<TransactionInstruction> {
  const id = program.programId;
  return program.methods
    .openHubPotRound()
    .accountsStrict({
      payer,
      config: configPda(id)[0],
      hubPot: hubPotPda(id)[0],
      round: hubPotRoundPda(id, pot.roundCount)[0],
      systemProgram: SYSTEM_PROGRAM,
    })
    .instruction();
}

/** Unsigned `recognize_hub_pot_inflow` instruction. `tokenPrograms` must be the 4 bucket mints'
 *  actual owner programs, in `[otc, crclx, nvdax, spcxx]` order — resolved live, never assumed. */
export async function buildRecognizeHubPotInflowIx(
  program: HubProgram,
  payer: PublicKey,
  opsWallet: PublicKey,
  pot: HubPotView,
  tokenPrograms: PublicKey[],
): Promise<TransactionInstruction> {
  const id = program.programId;
  const [otcMint, crclxMint, nvdaxMint, spcxxMint] = [
    pot.otcMint,
    pot.crclxMint,
    pot.nvdaxMint,
    pot.spcxxMint,
  ].map((m) => new PublicKey(m));
  const [otcTokenProgram, crclxTokenProgram, nvdaxTokenProgram, spcxxTokenProgram] = tokenPrograms;
  return program.methods
    .recognizeHubPotInflow()
    .accountsStrict({
      payer,
      config: configPda(id)[0],
      hubPot: hubPotPda(id)[0],
      inflow: hubPotInflowPda(id)[0],
      treasuryState: treasuryPda(id)[0],
      vault: vaultPda(id)[0],
      otcMint,
      crclxMint,
      nvdaxMint,
      spcxxMint,
      otcVault: new PublicKey(pot.otcVault),
      crclxVault: new PublicKey(pot.crclxVault),
      nvdaxVault: new PublicKey(pot.nvdaxVault),
      spcxxVault: new PublicKey(pot.spcxxVault),
      opsOtc: ataPda(opsWallet, otcMint, otcTokenProgram)[0],
      opsCrclx: ataPda(opsWallet, crclxMint, crclxTokenProgram)[0],
      opsNvdax: ataPda(opsWallet, nvdaxMint, nvdaxTokenProgram)[0],
      opsSpcxx: ataPda(opsWallet, spcxxMint, spcxxTokenProgram)[0],
      otcTokenProgram,
      crclxTokenProgram,
      nvdaxTokenProgram,
      spcxxTokenProgram,
    })
    .instruction();
}

/**
 * Reconciles + (if anything ends up pending) opens a new HUB Pot round, in one signed tx. Safe to
 * call speculatively any time — resolves to `skipped: true` when there's genuinely nothing to do
 * (no new inflow AND no pre-existing pending balance), never spends a fee in that case since the
 * decision is made from a simulation, before anything is signed.
 */
export async function executeSyncHubPot(opts: {
  connection: Connection;
  program: HubProgram;
  signer: WalletSigner;
  onLog: (l: TxLog) => void;
  onPhase?: (p: HubPotSyncPhase) => void;
}): Promise<HubPotSyncResult> {
  const { connection, program, signer, onLog, onPhase } = opts;
  const payer = new PublicKey(signer.publicKey);

  onPhase?.("check");
  const [pot, state] = await Promise.all([fetchHubPot(program), fetchProtocolState(program)]);
  if (!pot) {
    const reason = "HUB Pot not initialized on this cluster yet";
    onLog({ type: "err", msg: reason });
    return { ok: false, reason };
  }
  const opsWallet = new PublicKey(state.config.opsWallet);
  const mints = [pot.otcMint, pot.crclxMint, pot.nvdaxMint, pot.spcxxMint].map(
    (m) => new PublicKey(m),
  );
  const mintInfos = await connection.getMultipleAccountsInfo(mints, "confirmed");
  const tokenPrograms = mintInfos.map((info, i) => {
    if (!info) throw new Error(`bucket mint ${mints[i].toBase58()} not found on-chain`);
    return info.owner;
  });

  onPhase?.("build");
  const recognizeIx = await buildRecognizeHubPotInflowIx(
    program,
    payer,
    opsWallet,
    pot,
    tokenPrograms,
  );
  const opsAtas = mints.map((m, i) => ataPda(opsWallet, m, tokenPrograms[i])[0]);
  const opsAtaInfos = await connection.getMultipleAccountsInfo(opsAtas, "confirmed");
  const preamble = mints
    .map((m, i) => ({ mint: m, tp: tokenPrograms[i], exists: !!opsAtaInfos[i] }))
    .filter((x) => !x.exists)
    .map((x) => createAtaIdempotentIx(payer, opsWallet, x.mint, x.tp));

  const bh = await connection.getLatestBlockhash("confirmed");
  const cuIxs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: CU_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: CU_PRICE_MICRO }),
  ];

  // Dry-run `recognize_hub_pot_inflow` alone first — `NoHubPotInflow` (no new inflow since the
  // last recognition) is a clean no-op, not a failure, same as the mainnet script's try/catch.
  const recognizeTx = new Transaction({ feePayer: payer, recentBlockhash: bh.blockhash });
  recognizeTx.add(...cuIxs, ...preamble, recognizeIx);
  const recognizeSim = await connection.simulateTransaction(recognizeTx, undefined, false);
  let includeRecognize = !recognizeSim.value.err;
  if (recognizeSim.value.err) {
    const logs = recognizeSim.value.logs ?? [];
    if (!logs.some((l) => l.includes("NoHubPotInflow"))) {
      const reason = simFailReason(logs, recognizeSim.value.err);
      onLog({ type: "err", msg: `RECOGNIZE SIM_FAIL: ${reason}` });
      return { ok: false, reason };
    }
    onLog({ type: "info", msg: "no new inflow since the last recognition" });
  }

  if (!includeRecognize && pendingIsZero(pot)) {
    const reason = "nothing to sync — no new inflow and no pending balance";
    onLog({ type: "info", msg: reason });
    return { ok: true, skipped: true, reason };
  }

  const openIx = await buildOpenHubPotRoundIx(program, payer, pot);
  const tx = new Transaction({ feePayer: payer, recentBlockhash: bh.blockhash });
  tx.add(
    ...cuIxs,
    ...(includeRecognize ? [...preamble, recognizeIx] : []),
    openIx,
  );
  onLog({ type: "info", msg: `SYNC :: ${includeRecognize ? "recognize + open" : "open"} in 1 tx` });

  onPhase?.("sim");
  const sim = await connection.simulateTransaction(tx, undefined, false);
  if (sim.value.err) {
    const reason = simFailReason(sim.value.logs, sim.value.err);
    onLog({ type: "err", msg: `SIM_FAIL: ${reason}` });
    return { ok: false, reason };
  }
  onLog({ type: "sim", msg: `sim OK (${sim.value.unitsConsumed ?? "?"} CU)` });

  onPhase?.("sign");
  let signed: Uint8Array;
  try {
    signed = await signer.signTransactionRaw(tx);
  } catch (e) {
    const reason = (e as Error).message;
    onLog({ type: "err", msg: `SIGN_REJECTED: ${reason}` });
    return { ok: false, reason };
  }

  onPhase?.("send");
  let sig: string;
  try {
    sig = await connection.sendRawTransaction(signed, { skipPreflight: true, maxRetries: 3 });
    onLog({ type: "ok", msg: `SENT ${sig.slice(0, 8)}…`, sig });
  } catch (e) {
    const reason = (e as Error).message;
    onLog({ type: "err", msg: `SEND_FAIL: ${reason}` });
    return { ok: false, reason };
  }

  onPhase?.("confirm");
  const conf = await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  if (conf.value.err) {
    const reason = JSON.stringify(conf.value.err);
    onLog({ type: "err", msg: `FAILED_ON_CHAIN: ${reason}`, sig });
    return { ok: false, reason };
  }
  onLog({ type: "ok", msg: "DONE :: hub pot synced" });
  return { ok: true, skipped: false, sig, recognized: includeRecognize };
}
