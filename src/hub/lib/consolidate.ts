// Consolidate & Swap (claim portal): one workflow that (1) collects every accrued earning the
// connected wallet can claim across the $HUB protocol's reward surfaces — per-desk yield
// (`claim_yield`, pays $OTC) and the M.I.M hub-pot round shares (`claim_hub_pot_reward`, pays
// the 4-bucket basket) — then (2) converts everything that actually arrived into the user's
// chosen output token through the same hardened pipeline as SwapPanel: fresh validated Jupiter
// quote per token → relay-built tx → fee-payer + destination-account checks → unsigned RPC sim
// gate → ONE signAll prompt → send → confirm with a signature-status fallback. Every stage is
// isolated: a failed claim never blocks the swaps, a failed token swap never blocks the other
// tokens, and the final report says exactly what was claimed, what was converted, and what was
// left behind with the reason.
import { Buffer } from "buffer";
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { LINEUP_STOCKS } from "@/lib/otcClaim";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ataPda,
  otcDueForLamports,
  type ConfigView,
  type HubPotView,
  type HubProgram,
  type OtcPotView,
} from "@hub-sdk";
import { executeClaimYield } from "./claim";
import { blowfishScanTx } from "./blowfish";
import { executeClaimHubPotReward } from "./hubPotClaim";
import {
  SOL_DECIMALS,
  SOL_MINT,
  getQuote,
  validateBuiltSwapTx,
  type SwapTransport,
  type TxLog,
} from "./swap";
import type { WalletSigner } from "./wallets";

export type ConsolidationTarget = { symbol: string; mint: string; decimals: number };

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Output dropdown: $HUB first (protocol token), the base currencies, then the 13 supported
 *  MemeStock lineup mints (recovered from the OTC program's on-chain config — see
 *  `src/lib/otcClaim.js`'s LINEUP_STOCKS). */
export function consolidationTargets(hubMint: string): ConsolidationTarget[] {
  return [
    { symbol: "HUB", mint: hubMint, decimals: 6 },
    { symbol: "SOL", mint: SOL_MINT, decimals: SOL_DECIMALS },
    { symbol: "USDC", mint: USDC_MINT, decimals: 6 },
    ...LINEUP_STOCKS.map((s) => ({ symbol: s.symbol, mint: s.mint, decimals: s.decimals })),
  ];
}

export type ClaimSummary = {
  yieldAssets: number;
  yieldOk: number;
  potAssets: number;
  potOk: number;
};
export type SwapOutcome = {
  symbol: string;
  inUnits: bigint;
  ok: boolean;
  sig?: string;
  reason?: string;
};
export type ConsolidationReport = { claims: ClaimSummary; swaps: SwapOutcome[] };

/** Tokens that can actually arrive from claims: $OTC (yield + pot bucket) plus the pot's three
 *  stock buckets — deduped by mint. */
export function claimSourceMints(config: ConfigView, pot: HubPotView | null): string[] {
  const mints = [config.otcMint];
  if (pot) mints.push(pot.otcMint, pot.crclxMint, pot.nvdaxMint, pot.spcxxMint);
  return [...new Set(mints)];
}

/** Live balance of `owner`'s ATA for `mint` (token program resolved off the mint itself —
 * never assumed; lineup mints are Token-2022 on mainnet but devnet mocks are classic). */
async function sourceBalance(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
): Promise<bigint> {
  const info = await connection.getAccountInfo(mint, "confirmed").catch(() => null);
  if (!info) return 0n;
  const [ata] = ataPda(owner, mint, info.owner);
  return connection
    .getTokenAccountBalance(ata, "confirmed")
    .then((b) => BigInt(b.value.amount))
    .catch(() => 0n);
}

export async function executeConsolidation(opts: {
  connection: Connection;
  program: HubProgram;
  signer: WalletSigner;
  config: ConfigView;
  otcPot: OtcPotView | null;
  /** Desks with pending yield (asset ids). */
  yieldAssets: string[];
  yieldPendingLamports: number;
  /** Hub-pot claim targets for the latest open round (empty when nothing claimable). */
  pot: HubPotView | null;
  potRoundIndex: number | null;
  potAssets: string[];
  target: ConsolidationTarget;
  slippageBps: number;
  transport: SwapTransport;
  onLog: (l: TxLog) => void;
  onPhase?: (p: string) => void;
}): Promise<ConsolidationReport> {
  const { connection, program, signer, config, otcPot, target, slippageBps, transport, onLog } =
    opts;
  const owner = new PublicKey(signer.publicKey);
  const report: ConsolidationReport = {
    claims: { yieldAssets: 0, yieldOk: 0, potAssets: 0, potOk: 0 },
    swaps: [],
  };

  // ── Phase 1: claims (each executor sim-gates and batch-signs internally) ──
  onLog({ type: "info", msg: `PHASE 1/3 :: CLAIM — reading pre-claim balances…` });
  const sourceMints = claimSourceMints(config, opts.pot);
  const before = new Map<string, bigint>();
  for (const m of sourceMints) before.set(m, await sourceBalance(connection, owner, new PublicKey(m)));

  if (opts.yieldAssets.length) {
    opts.onPhase?.("claim:yield");
    report.claims.yieldAssets = opts.yieldAssets.length;
    const res = await executeClaimYield({
      connection,
      program,
      signer,
      assets: opts.yieldAssets,
      config,
      otcPot,
      // Keep the underfunded-vault precheck active on this path too — bail with the clear
      // keeper message before building anything instead of failing deep in a sim.
      estimatedOtcDueUnits:
        opts.yieldPendingLamports > 0
          ? (otcDueForLamports(opts.yieldPendingLamports, otcPot) ?? undefined)
          : undefined,
      onLog,
    });
    report.claims.yieldOk = res.filter((r) => r.ok).length;
  }
  if (opts.pot && opts.potRoundIndex != null && opts.potAssets.length) {
    opts.onPhase?.("claim:pot");
    report.claims.potAssets = opts.potAssets.length;
    const res = await executeClaimHubPotReward({
      connection,
      program,
      signer,
      assets: opts.potAssets,
      roundIndex: opts.potRoundIndex,
      pot: opts.pot,
      onLog,
    });
    report.claims.potOk = res.filter((r) => r.ok).length;
  }
  if (!opts.yieldAssets.length && !opts.potAssets.length) {
    onLog({ type: "info", msg: "nothing claimable right now — swap phase will consolidate existing source-token balances only if they grew" });
  }

  // ── Phase 2: deltas → what actually arrived decides what gets swapped ──
  opts.onPhase?.("quote");
  const deltas: { mint: string; symbol: string; units: bigint }[] = [];
  for (const m of sourceMints) {
    const after = await sourceBalance(connection, owner, new PublicKey(m));
    const delta = after - (before.get(m) ?? 0n);
    if (delta > 0n && m !== target.mint) {
      const symbol =
        consolidationTargets(config.hubMint).find((t) => t.mint === m)?.symbol ??
        `${m.slice(0, 4)}…`;
      deltas.push({ mint: m, symbol, units: delta });
    }
  }
  if (!deltas.length) {
    onLog({ type: "info", msg: "no new source tokens arrived — nothing to swap" });
    return report;
  }

  // ── Phase 3: quote → build → validate → sim per token (isolated), then ONE sign prompt ──
  const built: { d: (typeof deltas)[number]; tx: VersionedTransaction; msg: Buffer; estOut: bigint }[] = [];
  for (const d of deltas) {
    try {
      const quote = await getQuote(transport, {
        inputMint: d.mint,
        outputMint: target.mint,
        amount: d.units.toString(),
        slippageBps,
      });
      const b64 = await transport.swapTransaction(quote, signer.publicKey);
      const unsigned = VersionedTransaction.deserialize(new Uint8Array(Buffer.from(b64, "base64")));
      const v = validateBuiltSwapTx(unsigned, signer.publicKey, target.mint);
      if ("reason" in v) throw new Error(v.reason);
      const sim = await connection.simulateTransaction(unsigned, { sigVerify: false });
      if (sim.value.err) throw new Error(`sim: ${JSON.stringify(sim.value.err)}`);
      // Same pre-flight as executeSwap / the claim executors (env-gated; no key = no opinion).
      const verdict = await blowfishScanTx({
        tx: unsigned,
        userAccount: signer.publicKey,
        rpcEndpoint: connection.rpcEndpoint,
      });
      if (verdict?.action === "BLOCK")
        throw new Error(`Blowfish BLOCK: ${verdict.messages.join("; ") || "flagged as unsafe"}`);
      if (verdict?.action === "WARN")
        onLog({ type: "info", msg: `${d.symbol} BLOWFISH WARN: ${verdict.messages.join("; ")}` });
      built.push({ d, tx: unsigned, msg: v.message, estOut: BigInt(quote.outAmount) });
      onLog({
        type: "sim",
        msg: `${d.symbol} → ${target.symbol}: quote OK (est. ${quote.outAmount} out) · sim OK`,
      });
    } catch (e) {
      const reason = (e as Error).message;
      onLog({ type: "err", msg: `SKIP ${d.symbol}: ${reason}` });
      report.swaps.push({ symbol: d.symbol, inUnits: d.units, ok: false, reason });
    }
  }
  if (!built.length) return report;

  opts.onPhase?.("sign");
  onLog({ type: "info", msg: `SIGN :: 1 prompt for ${built.length} swap(s)…` });
  let signed: Uint8Array[];
  try {
    signed = await signer.signAllTransactionsRaw(built.map((b) => b.tx));
  } catch (e) {
    const reason = `rejected: ${(e as Error).message}`;
    onLog({ type: "err", msg: `SIGN_REJECTED — claims already landed; source tokens stay in your wallet` });
    for (const b of built)
      report.swaps.push({ symbol: b.d.symbol, inUnits: b.d.units, ok: false, reason });
    return report;
  }

  opts.onPhase?.("send");
  for (const [i, b] of built.entries()) {
    try {
      const bytes = signed[i];
      if (!bytes) throw new Error("wallet returned fewer signatures than transactions");
      const signedTx = VersionedTransaction.deserialize(new Uint8Array(bytes));
      if (!Buffer.from(signedTx.message.serialize()).equals(b.msg))
        throw new Error("wallet returned a changed transaction");
      const sig = await connection.sendRawTransaction(bytes, { skipPreflight: true, maxRetries: 3 });
      onLog({ type: "ok", msg: `${b.d.symbol} SWAP SENT ${sig.slice(0, 8)}…`, sig });
      opts.onPhase?.("confirm");
      try {
        const bh = await connection.getLatestBlockhash("confirmed");
        const conf = await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
        if (conf.value.err) throw new Error(JSON.stringify(conf.value.err));
        report.swaps.push({ symbol: b.d.symbol, inUnits: b.d.units, ok: true, sig });
      } catch (e) {
        // Block-height-exceeded doesn't prove non-landing — check the signature directly.
        const status = await connection
          .getSignatureStatus(sig, { searchTransactionHistory: true })
          .catch(() => null);
        const landed =
          status?.value != null &&
          status.value.err == null &&
          (status.value.confirmationStatus === "confirmed" ||
            status.value.confirmationStatus === "finalized");
        if (landed) report.swaps.push({ symbol: b.d.symbol, inUnits: b.d.units, ok: true, sig });
        else throw e;
      }
    } catch (e) {
      const reason = (e as Error).message;
      onLog({ type: "err", msg: `${b.d.symbol} SWAP FAILED: ${reason} — tokens stay in your wallet` });
      report.swaps.push({ symbol: b.d.symbol, inUnits: b.d.units, ok: false, reason });
    }
  }
  const ok = report.swaps.filter((s) => s.ok).length;
  onLog({ type: ok === report.swaps.length ? "ok" : "err", msg: `DONE :: ${ok}/${report.swaps.length} swap(s) landed` });
  return report;
}
