// Desk activate / upgrade (§A4): one tx per desk, paid in SOL (`activate_tier` / `upgrade_tier`,
// flat step fee, 90% pot / 10% ops) or in $OTC (`activate_tier_otc` / `upgrade_tier_otc`) — either
// way, `target_tier` is reached directly in ONE call: a fresh activation into T4 pays the flat
// step fee once, exactly like a fresh T1 activation. The SOL path burns the $HUB tier cost
// directly from the payer's wallet; the $OTC path (§otc_pay.rs, revised) charges the *same* flat
// SOL fee **plus** a live-quoted Jupiter $OTC→$HUB swap that both produces the tier's $HUB burn
// (`min_out = liveHubCostDeltaUnits`, enforced on-chain via balance-delta) and — at an equal-scaled
// amount injected straight into `OtcPotState.otc_vault` (see `otcPotLeg`) — pays roughly 2× that
// swap's $OTC cost in total. Pricing is no longer a static authority-refreshed rate: the caller
// must fetch a live route (`fetchOtcToHubRoute`) and pass its `otcSwapAmount`/`jupiterData` in.
// Same reliability model as claim.ts: simulate unsigned first, one wallet prompt, send, confirm.
// `upgrade_tier` rejects desks with pending yield, so a `claim_yield` ix is prepended when needed.
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  Transaction,
  type AccountMeta,
  type TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";
import {
  BPS,
  JUPITER_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ataPda,
  burnPda,
  configPda,
  createAtaIdempotentIx,
  epochPda,
  liveHubCostDeltaUnits,
  otcPayPda,
  otcPayable,
  otcPotPda,
  potPda,
  tierFeePda,
  tierPda,
  tokenomicsPda,
  type ConfigView,
  type HubProgram,
  type OtcPayView,
  type OtcPotView,
  type TierFeeView,
  type TokenomicsView,
} from "@hub-sdk";
import { buildClaimYieldIx } from "./claim";
import { blowfishScanTx } from "./blowfish";
import type { HubCluster } from "./explorer";
import type { TxLog } from "./swap";
import type { WalletSigner } from "./wallets";

export type PayMethod = "sol" | "otc";
export type TierChangePhase = "build" | "sim" | "sign" | "send" | "confirm";
export type TierChangeResult = { asset: string; ok: boolean; sig?: string; reason?: string };

export type TierQuote = {
  steps: number;
  solLamports: number;
  otcAvailable: boolean;
  otcUnavailableReason?: string;
  /** $HUB base units burned for this call (full tier cost on activation, delta on upgrade). Also
   *  the floor (`minHubOut`) `fetchOtcToHubRoute` must clear for the $OTC path. */
  hubBurnUnits: number;
};

const CU_LIMIT = 300_000;
const CU_PRICE_MICRO = 10_000;
const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");
export const MAX_TIER = 4;

const JUP_QUOTE_API = "https://lite-api.jup.ag/swap/v1/quote";
const JUP_BUILD_API = "https://api.jup.ag/swap/v2/build";
/** ExactOut quote → ExactIn build is two separate calls; pad the ExactOut estimate so price drift
 *  between them (plus the build's own slippage) still clears `minHubOut` on the first try. */
const OTC_SWAP_INPUT_BUFFER_BP = 150;
const OTC_SWAP_SLIPPAGE_BPS = 100;

export type OtcSwapRoute = {
  /** $OTC base units the caller must hold; becomes `activate_tier_otc`'s `otc_swap_amount` arg. */
  otcSwapAmount: bigint;
  /** Raw Jupiter route instruction data, passed verbatim as the ix's `jupiter_data` arg. */
  jupiterData: Buffer;
  /** The route's account list, passed verbatim as `ctx.remaining_accounts`. */
  remainingAccounts: AccountMeta[];
  /** Unrounded expected $HUB out, for display. */
  outAmount: bigint;
  routeLabels: string[];
};

function assertTierRange(fromTier: number, toTier: number) {
  if (!Number.isInteger(toTier) || toTier < 1 || toTier > MAX_TIER)
    throw new Error(`target tier must be 1..${MAX_TIER}`);
  if (!Number.isInteger(fromTier) || fromTier < 0 || toTier <= fromTier)
    throw new Error("target tier must be above the current tier");
}

/** Why `otcPayable` is false, for the UI. Pricing is a live Jupiter quote now, not a stored rate
 *  — there's nothing left to go stale, only the on/off switch and whether it was ever initialized.
 *
 *  `cluster !== "mainnet-beta"` is checked *first* and short-circuits everything else: Jupiter's
 *  aggregator only indexes mainnet-beta liquidity, so a devnet/localnet-only $OTC mint (e.g. the
 *  devnet mock at `4Qoo4Ck…uzuu`) can never resolve a route no matter how `OtcPayConfig` is
 *  configured — `/quote` returns `TOKEN_NOT_TRADABLE` for every such mint, unconditionally. No
 *  amount of re-minting or re-configuring the token fixes this; the SOL path is the only way to
 *  activate/upgrade tiers off mainnet. */
export function otcUnavailableReason(
  p: OtcPayView | null,
  cluster?: HubCluster,
): string | undefined {
  if (cluster && cluster !== "mainnet-beta")
    return "$OTC pay requires mainnet — Jupiter has no devnet/localnet liquidity to route through";
  if (!p) return "not initialized on this cluster";
  if (!p.enabled) return "disabled";
  return undefined;
}

/** Side-by-side cost of moving `fromTier → toTier` (fromTier 0 = fresh activation). The $HUB
 *  burn is the *live* USD-pegged cost (`liveHubCostDeltaUnits` — tracks `config`'s price cache,
 *  falling back to the genesis/ceiling table only when stale), matching what `Config::hub_cost_
 *  delta` will actually charge on-chain right now. The $OTC amount itself isn't known until
 *  `fetchOtcToHubRoute` returns a live quote.
 *
 *  `tierFee` must be `ProtocolState.tierFee` — the live, admin-retunable ascending per-tier SOL
 *  fee (`TierFeeConfig`, T1 0.2 / T2 0.3 / T3 0.4 / T4 0.5 SOL genesis default). `config.
 *  stepFeeLamports` is a dead legacy field the program no longer reads for this charge; falling
 *  back to it here only covers the pre-`init_tier_fee_config` edge case (the on-chain accounts
 *  actually require `TierFeeConfig` to exist, so `tierFee` should never be null once a cluster
 *  is fully provisioned). */
export function quoteTierChange(opts: {
  config: ConfigView;
  tierFee: TierFeeView | null;
  otcPay: OtcPayView | null;
  fromTier: number;
  toTier: number;
  /** Gates the $OTC path off mainnet — see `otcUnavailableReason`. */
  cluster?: HubCluster;
}): TierQuote {
  const { config, tierFee, otcPay, fromTier, toTier, cluster } = opts;
  assertTierRange(fromTier, toTier);
  const steps = toTier - fromTier;
  const reason = otcUnavailableReason(otcPay, cluster);
  return {
    steps,
    // Ascending, indexed by the *target* tier reached (never `fromTier` nor the step count) —
    // one `activate_tier`/`upgrade_tier` call always costs exactly `tierFee[toTier - 1]`.
    solLamports: tierFee?.tierStepFeeLamports[toTier - 1] ?? config.stepFeeLamports,
    otcAvailable: !reason && otcPayable(otcPay),
    otcUnavailableReason: reason,
    hubBurnUnits: liveHubCostDeltaUnits(fromTier, toTier, Math.floor(Date.now() / 1000), config),
  };
}

/** One ExactIn `/quote` call — the live rate Jupiter would actually route `amount` of $OTC at
 *  right now. Used by `fetchOtcToHubRoute`'s sizing loop below, since `/quote`'s ExactOut mode
 *  has no route on several of $OTC's pools (Meteora DAMM v2, Pump.fun AMM — `NO_ROUTES_FOUND`),
 *  even though the pair is perfectly tradable ExactIn. */
async function exactInQuote(
  doFetch: typeof fetch,
  headers: Record<string, string> | undefined,
  otcMint: PublicKey,
  hubMint: PublicKey,
  amount: bigint,
): Promise<{ inAmount: bigint; outAmount: bigint }> {
  const qs = new URLSearchParams({
    inputMint: otcMint.toBase58(),
    outputMint: hubMint.toBase58(),
    amount: amount.toString(),
    swapMode: "ExactIn",
    slippageBps: String(OTC_SWAP_SLIPPAGE_BPS),
  });
  const res = await doFetch(`${JUP_QUOTE_API}?${qs}`, { headers });
  const body = (await res.json().catch(() => ({}))) as {
    inAmount?: string;
    outAmount?: string;
    error?: string;
  };
  if (!res.ok || !body.outAmount)
    throw new Error(body.error ?? `Jupiter quote HTTP ${res.status}`);
  return { inAmount: BigInt(body.inAmount ?? amount.toString()), outAmount: BigInt(body.outAmount) };
}

/**
 * Sizes and builds the $OTC→$HUB Jupiter route `activate_tier_otc`/`upgrade_tier_otc` swap-burns
 * on-chain (§otc_pay.rs). Swap V2's `/build` (the CPI-oriented endpoint, raw instruction data, no
 * ALT dependency) is ExactIn-only, and the legacy Metis `/quote`'s ExactOut mode has no route on
 * several of $OTC's pools (`NO_ROUTES_FOUND`, even though the pair is fine ExactIn), so the $OTC
 * input needed to clear `minHubOut` can't be asked for directly. Instead, probe the live ExactIn
 * rate with a tiny, decimals-agnostic seed amount (negligible price impact, so it reads close to
 * spot price regardless of the real trade's size) and cross-multiply toward `minHubOut`, padding
 * each intermediate step slightly so integer-division truncation converges from *above* the floor
 * rather than asymptotically from below, then pads the confirmed-sufficient amount once more for
 * drift before building the real route via `/build` — double-checking its own
 * `otherAmountThreshold` still clears `minHubOut`, the same floor `jupiter_swap::swap_exact_in`
 * enforces on-chain.
 */
export async function fetchOtcToHubRoute(opts: {
  taker: PublicKey;
  otcMint: PublicKey;
  hubMint: PublicKey;
  destinationTokenAccount: PublicKey;
  minHubOut: bigint;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<OtcSwapRoute> {
  const { taker, otcMint, hubMint, destinationTokenAccount, minHubOut } = opts;
  if (minHubOut <= 0n) throw new Error("fetchOtcToHubRoute: minHubOut must be > 0");
  const doFetch = opts.fetchImpl ?? fetch;
  const headers = opts.apiKey ? { "x-api-key": opts.apiKey } : undefined;

  // Negligible-impact seed for any plausible token decimals — just needs to be small relative to
  // the real trade size so the first probe reads close to the pool's spot price.
  const OTC_PROBE_SEED = 1_000n;
  let inputAmount = OTC_PROBE_SEED;
  let outAmount = 0n;
  const MAX_OTC_PROBES = 6;
  for (let i = 0; i < MAX_OTC_PROBES; i++) {
    const probe = await exactInQuote(doFetch, headers, otcMint, hubMint, inputAmount);
    outAmount = probe.outAmount;
    if (outAmount <= 0n) throw new Error(`The token ${otcMint.toBase58()} is not tradable`);
    if (outAmount >= minHubOut) break;
    const nextAmount = (inputAmount * minHubOut + outAmount - 1n) / outAmount; // ceil cross-multiply
    inputAmount = (nextAmount * BigInt(BPS + 50)) / BigInt(BPS); // tiny nudge past the floor
  }
  if (outAmount < minHubOut)
    throw new Error("Jupiter route can't clear the required $HUB output right now — try again");
  // Pad the confirmed-sufficient amount for drift between the last probe above and `/build` below.
  const otcSwapAmount = (inputAmount * BigInt(BPS + OTC_SWAP_INPUT_BUFFER_BP)) / BigInt(BPS);

  const bqs = new URLSearchParams({
    inputMint: otcMint.toBase58(),
    outputMint: hubMint.toBase58(),
    amount: otcSwapAmount.toString(),
    taker: taker.toBase58(),
    slippageBps: String(OTC_SWAP_SLIPPAGE_BPS),
    wrapAndUnwrapSol: "false",
    destinationTokenAccount: destinationTokenAccount.toBase58(),
  });
  const bRes = await doFetch(`${JUP_BUILD_API}?${bqs}`, { headers });
  const bBody = (await bRes.json().catch(() => ({}))) as {
    outAmount?: string;
    otherAmountThreshold?: string;
    routePlan?: { swapInfo?: { label?: string } }[];
    swapInstruction?: {
      programId: string;
      accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
      data: string;
    };
    error?: string;
  };
  if (!bRes.ok || !bBody.swapInstruction)
    throw new Error(bBody.error ?? `Jupiter build HTTP ${bRes.status}`);
  const ix = bBody.swapInstruction;
  if (ix.programId !== JUPITER_PROGRAM_ID)
    throw new Error(`Jupiter build returned unexpected programId ${ix.programId}`);
  if (!Array.isArray(ix.accounts) || ix.accounts.length === 0)
    throw new Error("Jupiter build returned a route with no accounts");
  // The route must actually spend from the caller and pay the protocol's destination account —
  // the on-chain min_out balance-delta enforces the *amount*, but a route missing either account
  // would fail there with an opaque CPI error instead of this clear client-side one.
  const routeKeys = new Set(ix.accounts.map((a) => a.pubkey));
  if (!routeKeys.has(taker.toBase58()))
    throw new Error("Jupiter route does not spend from the caller's wallet");
  if (!routeKeys.has(destinationTokenAccount.toBase58()))
    throw new Error("Jupiter route does not pay the protocol's destination account");
  const minOut = BigInt(bBody.otherAmountThreshold ?? "0");
  if (minOut < minHubOut)
    throw new Error("Jupiter route can't clear the required $HUB output right now — try again");
  return {
    otcSwapAmount,
    jupiterData: Buffer.from(ix.data, "base64"),
    remainingAccounts: ix.accounts.map((a) => ({
      pubkey: new PublicKey(a.pubkey),
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    })),
    outAmount: BigInt(bBody.outAmount ?? "0"),
    routeLabels: (bBody.routePlan ?? [])
      .map((p) => p.swapInfo?.label)
      .filter((l): l is string => !!l),
  };
}

/**
 * Unsigned ixs: optional `claim_yield`, then exactly ONE of `activate_tier(toTier)` (fresh
 * activation, straight into `toTier`) or `upgrade_tier(toTier)` (already active) — never both.
 * A fresh T4 activation is one `activate_tier(4)` call, not `activate_tier` + `upgrade_tier(4)`.
 */
export async function buildTierChangeIxs(opts: {
  program: HubProgram;
  payer: PublicKey;
  deskAsset: PublicKey;
  fromTier: number;
  toTier: number;
  method: PayMethod;
  config: ConfigView;
  otcPay: OtcPayView | null;
  /** §A5 90% leg state — required to settle pending yield before an upgrade (see below), and to
   *  fund the $OTC path's desk-pot vault. */
  otcPot: OtcPotView | null;
  /** Required — the 50%-of-cost "reward" leg of the burn split lands in
   *  `tokenomics.treasuryLockVault` (see `Config.tier_cost_burn_bp`). */
  tokenomics: TokenomicsView | null;
  pendingLamports: number;
  /** Required for `method: "otc"` — a live route from `fetchOtcToHubRoute`, sized to clear this
   *  call's `liveHubCostDeltaUnits`. Unused on the SOL path. */
  otcRoute?: OtcSwapRoute;
  /** The token program that actually owns `config.hubMint` on this cluster
   *  (`ProtocolState.token.hubTokenProgram`, resolved live off-chain) — never assume classic:
   *  devnet's harness mint and mainnet's real launch mint sit on different token programs, and
   *  the on-chain accounts here (`payerHub`, `tokenProgram`/`hubTokenProgram`) must match
   *  whichever one truly owns the mint or `burn_checked`/`transfer_checked` reject the tx. */
  hubTokenProgram: string;
  /** The token program that actually owns `config.otcMint` on this cluster (`PayerBalances.
   *  otcTokenProgram`, resolved live off-chain) — never assume Token-2022: mainnet's real $OTC
   *  launch mint is Token-2022, but devnet's mock $OTC mint is classic Token. Used for every
   *  $OTC ATA derivation and the `otcTokenProgram` account on the $OTC-pay path, plus the
   *  pre-upgrade claim-yield ATA (claim_yield always pays out in $OTC). Defaults to Token-2022
   *  only as a last resort when the caller hasn't resolved it yet. */
  otcTokenProgram?: string;
}): Promise<TransactionInstruction[]> {
  const { program, payer, deskAsset, fromTier, toTier, method, config, otcPay, otcPot } = opts;
  assertTierRange(fromTier, toTier);
  if (!opts.tokenomics)
    throw new Error("TokenomicsConfig isn't initialized on this cluster (init_tokenomics)");
  const id = program.programId;
  const otcTokenProgram = opts.otcTokenProgram ?? TOKEN_2022_PROGRAM_ID;
  const ixs: TransactionInstruction[] = [];
  if (fromTier > 0 && opts.pendingLamports > 0) {
    if (!otcPot || otcPot.totalLamportsSpent <= 0)
      throw new Error(
        "pending yield must be claimed before upgrading, but the $OTC yield vault isn't funded yet",
      );
    // Idempotent — a no-op if the payer already has the ATA; the settle-claim below pays into it.
    // The ATA's owner-program derivation must match whichever program truly owns $OTC.
    ixs.push(createAtaIdempotentIx(payer, payer, new PublicKey(config.otcMint), otcTokenProgram));
    ixs.push(await buildClaimYieldIx(program, payer, deskAsset, config, otcPot, otcTokenProgram));
  }
  const hubMint = new PublicKey(config.hubMint);
  // Idempotent — a no-op if the payer already has the $HUB ATA (the common case, funded by a
  // prior drip/transfer); required for a wallet activating its very first desk with no $HUB
  // ATA yet, where `activate_tier`/`upgrade_tier`'s `payer_hub` account would otherwise not
  // exist on-chain and the simulation fails before the program even runs.
  ixs.push(createAtaIdempotentIx(payer, payer, hubMint, opts.hubTokenProgram));
  const common = {
    payer,
    deskAsset,
    config: configPda(id)[0],
    epoch: epochPda(id, config.currentEpoch)[0],
    pot: potPda(id)[0],
    opsWallet: new PublicKey(config.opsWallet),
    deskTier: tierPda(id, deskAsset)[0],
    hubMint,
    payerHub: ataPda(payer, hubMint, opts.hubTokenProgram)[0],
    // Ascending per-tier SOL fee — required by the on-chain `activate_tier`/`upgrade_tier`
    // (and $OTC-path equivalents) accounts; see `quoteTierChange`'s doc for the display side.
    tierFee: tierFeePda(id)[0],
    tokenomics: tokenomicsPda(id)[0],
    treasuryLockVault: new PublicKey(opts.tokenomics.treasuryLockVault),
    // Lifetime $HUB-burned ledger — required by on-chain `activate_tier`/`upgrade_tier` (and the
    // $OTC-path equivalents) since the BurnState ledger-drift fix; omitting it shifts every
    // subsequent account by one slot (AccountOwnedByWrongProgram on `burn`).
    burn: burnPda(id)[0],
  };

  if (method === "sol") {
    const accs = {
      ...common,
      systemProgram: SYSTEM_PROGRAM,
      tokenProgram: new PublicKey(opts.hubTokenProgram),
    };
    if (fromTier === 0)
      ixs.push(await program.methods.activateTier(toTier).accountsStrict(accs).instruction());
    else ixs.push(await program.methods.upgradeTier(toTier).accountsStrict(accs).instruction());
    return ixs;
  }

  if (!otcPay || !otcPayable(otcPay))
    throw new Error(`$OTC payment unavailable: ${otcUnavailableReason(otcPay) ?? "not payable"}`);
  if (!otcPot) throw new Error("$OTC yield vault (OtcPotState) isn't initialized on this cluster");
  if (!opts.otcRoute)
    throw new Error("missing $OTC→$HUB Jupiter route — call fetchOtcToHubRoute first");
  const { otcSwapAmount, jupiterData, remainingAccounts } = opts.otcRoute;
  const otcMint = new PublicKey(config.otcMint);
  const accs = {
    ...common,
    systemProgram: SYSTEM_PROGRAM,
    otcPay: otcPayPda(id)[0],
    otcMint,
    payerOtc: ataPda(payer, otcMint, otcTokenProgram)[0],
    otcPot: otcPotPda(id)[0],
    otcVault: new PublicKey(otcPot.otcVault),
    // $OTC and $HUB sit on different token programs — see `activateTierOtc`'s IDL docs. Resolved
    // live (never hardcoded) since devnet's mock $OTC mint sits on classic Token, not Token-2022.
    otcTokenProgram: new PublicKey(otcTokenProgram),
    hubTokenProgram: new PublicKey(opts.hubTokenProgram),
    jupiterProgram: new PublicKey(JUPITER_PROGRAM_ID),
  };
  const swapAmountBn = new BN(otcSwapAmount.toString());
  if (fromTier === 0)
    ixs.push(
      await program.methods
        .activateTierOtc(toTier, swapAmountBn, jupiterData)
        .accountsStrict(accs)
        .remainingAccounts(remainingAccounts)
        .instruction(),
    );
  else
    ixs.push(
      await program.methods
        .upgradeTierOtc(toTier, swapAmountBn, jupiterData)
        .accountsStrict(accs)
        .remainingAccounts(remainingAccounts)
        .instruction(),
    );
  return ixs;
}

/**
 * Activate / upgrade one desk in a single tx: build → sim (unsigned; a failing sim is dropped, no
 * fee spent) → one sign prompt → send → confirm.
 */
export async function executeTierChange(opts: {
  connection: Connection;
  program: HubProgram;
  signer: WalletSigner;
  deskAsset: string;
  fromTier: number;
  toTier: number;
  method: PayMethod;
  config: ConfigView;
  otcPay: OtcPayView | null;
  /** §A5 90% leg state — only needed when `pendingLamports > 0` on an upgrade, or on the $OTC
   *  path (desk-pot vault destination). */
  otcPot: OtcPotView | null;
  /** Required — see `buildTierChangeIxs`. */
  tokenomics: TokenomicsView | null;
  pendingLamports: number;
  /** Required for `method: "otc"` — see `buildTierChangeIxs`. */
  otcRoute?: OtcSwapRoute;
  /** See `buildTierChangeIxs`'s doc — threaded straight through. */
  hubTokenProgram: string;
  /** See `buildTierChangeIxs`'s doc — threaded straight through. */
  otcTokenProgram?: string;
  onLog: (l: TxLog) => void;
  onPhase?: (p: TierChangePhase) => void;
}): Promise<TierChangeResult> {
  const { connection, program, signer, deskAsset, fromTier, toTier, method, onLog, onPhase } = opts;
  const payer = new PublicKey(signer.publicKey);
  const fail = (reason: string): TierChangeResult => ({ asset: deskAsset, ok: false, reason });
  try {
    onPhase?.("build");
    const ixs = await buildTierChangeIxs({
      program,
      payer,
      deskAsset: new PublicKey(deskAsset),
      fromTier,
      toTier,
      method,
      config: opts.config,
      otcPay: opts.otcPay,
      otcPot: opts.otcPot,
      tokenomics: opts.tokenomics,
      pendingLamports: opts.pendingLamports,
      otcRoute: opts.otcRoute,
      hubTokenProgram: opts.hubTokenProgram,
      otcTokenProgram: opts.otcTokenProgram,
    });
    const bh = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: payer, recentBlockhash: bh.blockhash });
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: CU_LIMIT }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: CU_PRICE_MICRO }),
      ...ixs,
    );
    const verb = fromTier === 0 ? "ACTIVATE" : "UPGRADE";
    onLog({
      type: "info",
      msg: `${verb} :: T${fromTier} → T${toTier} via ${method.toUpperCase()} (${ixs.length} ix)`,
    });

    onPhase?.("sim");
    const sim = await connection.simulateTransaction(tx, undefined, false);
    if (sim.value.err) {
      const line = sim.value.logs?.find((l) => /Error Message|Error Code/.test(l));
      const reason = line?.replace("Program log: ", "") ?? JSON.stringify(sim.value.err);
      onLog({ type: "err", msg: `SIM_FAIL: ${reason}` });
      return fail(reason);
    }
    onLog({ type: "sim", msg: `sim OK (${sim.value.unitsConsumed ?? "?"} CU)` });

    // Blowfish pre-flight (optional, env-gated — see blowfish.ts): BLOCK aborts before the
    // wallet prompt; WARN is surfaced in the log; no API key / unreachable = no opinion.
    const verdict = await blowfishScanTx({
      tx,
      userAccount: payer.toBase58(),
      rpcEndpoint: connection.rpcEndpoint,
    });
    if (verdict?.action === "BLOCK") {
      const reason = `Blowfish BLOCK: ${verdict.messages.join("; ") || "flagged as unsafe"}`;
      onLog({ type: "err", msg: `ABORT: ${reason}` });
      return fail(reason);
    }
    if (verdict?.action === "WARN")
      onLog({ type: "info", msg: `BLOWFISH WARN: ${verdict.messages.join("; ")}` });

    onPhase?.("sign");
    onLog({ type: "info", msg: "SIGN :: 1 prompt for 1 tx…" });
    let signed: Uint8Array;
    try {
      signed = await signer.signTransactionRaw(tx);
    } catch (e) {
      onLog({ type: "err", msg: `SIGN_REJECTED: ${(e as Error).message}` });
      return fail("rejected");
    }

    onPhase?.("send");
    const sig = await connection.sendRawTransaction(signed, {
      skipPreflight: true,
      maxRetries: 3,
    });
    onLog({ type: "ok", msg: `SENT ${sig.slice(0, 8)}…`, sig });

    onPhase?.("confirm");
    try {
      // Re-fetch the blockhash right before confirming — not the `bh` from before the wallet
      // sim/sign round-trip above, which may already be stale by now, causing an immediate,
      // false "expired" the instant `confirmTransaction` is called even though the tx lands
      // moments later (see curve.ts's `confirmWithRecheck` for the same fix on that flow).
      const confirmBh = await connection.getLatestBlockhash("confirmed");
      const conf = await connection.confirmTransaction(
        { signature: sig, ...confirmBh },
        "confirmed",
      );
      if (conf.value.err) throw new Error(`FAILED_ON_CHAIN: ${JSON.stringify(conf.value.err)}`);
    } catch (e) {
      // A confirm error (block-height-exceeded in particular) doesn't guarantee the activation
      // never landed — client-side height tracking and network confirmation can race. Check the
      // signature directly before telling the user the desk wasn't upgraded when it actually was.
      const status = await connection.getSignatureStatus(sig, { searchTransactionHistory: true });
      const landed =
        status.value != null &&
        status.value.err == null &&
        (status.value.confirmationStatus === "confirmed" ||
          status.value.confirmationStatus === "finalized");
      if (!landed) {
        const reason = (e as Error).message;
        onLog({ type: "err", msg: `FAILED_ON_CHAIN: ${reason}`, sig });
        return { asset: deskAsset, ok: false, sig, reason };
      }
    }
    onLog({ type: "ok", msg: `DONE :: desk now T${toTier}`, sig });
    return { asset: deskAsset, ok: true, sig };
  } catch (e) {
    const reason = (e as Error).message;
    onLog({ type: "err", msg: `ABORT: ${reason}` });
    return fail(reason);
  }
}
