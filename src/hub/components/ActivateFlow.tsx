import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import {
  BPS,
  HUB_DECIMALS,
  OTC_PAY_SWAP_BURN_PCT_BP,
  TIER_NAMES,
  ataPda,
  liveHubCostUnits,
  otcPotLeg,
  pendingYieldLamports,
  splitFee,
  type ProtocolState,
} from "@hub-sdk";
import { useHub } from "../HubProvider";
import { useOtcPay } from "../hooks/useOtcPay";
import { usePayerBalances } from "../hooks/usePayerBalances";
import type { OwnedDesk } from "../hooks/useWalletPortfolio";
import {
  MAX_TIER,
  executeTierChange,
  fetchOtcToHubRoute,
  quoteTierChange,
  type OtcSwapRoute,
  type PayMethod,
  type TierChangePhase,
  type TierQuote,
} from "../lib/activate";
import { fmtSol, fmtUnits } from "../lib/format";
import { OFFICIAL_DESKS_URL } from "../lib/marketplace";
import type { TxLog } from "../lib/swap";
import { StockIcon } from "./ui/StockIcon";
import { TxLogView } from "./ui/TxLogView";

/** Fixed by `OTC_PAY_SWAP_BURN_PCT_BP` (currently an even 50/50 swap/pot split) — not a live
 * quote, so this can be shown as soon as a tier quote exists. */
const OTC_TOTAL_PREMIUM = (BPS / OTC_PAY_SWAP_BURN_PCT_BP).toFixed(2);
const OTC_DECIMALS = 6;
const TIERS = [1, 2, 3, 4] as const;
/** Fixed USD peg per tier (§ActivationGuide): T1 $50 · T2 $60 · T3 $70 · T4 $80. */
const TIER_USD = ["$50", "$60", "$70", "$80"];

const currentTier = (d: OwnedDesk) => (d.tier && !d.tier.voided ? d.tier.tier : 0);

type Props = {
  address: string;
  state: ProtocolState;
  /** The single desk to activate/upgrade — picked from the wallet's desk grid (DeskSheet) or a
   * faucet result (DripPage). */
  desk: OwnedDesk;
  onChanged?: () => void;
};

/** ACTIVATE / UPGRADE — the focused single-desk tier flow: pick a tier → pick pay method → one
 * big confirm. Same signing path as the old list-based ACTIVATE_DESK panel (quoteTierChange +
 * executeTierChange + the live $OTC→$HUB Jupiter route), minus the desk list, the balance boxes
 * and the verbose footnotes — the sheet that hosts it carries the desk context. */
export function ActivateFlow({ address, state, desk, onChanged }: Props) {
  const { connection, program, resolveSigner } = useHub();
  const qc = useQueryClient();
  const otcPayQ = useOtcPay();
  const balances = usePayerBalances(
    address,
    state.config.otcMint,
    state.config.hubMint,
    state.token.hubTokenProgram,
  );
  const [toTier, setToTier] = useState(1);
  const [method, setMethod] = useState<PayMethod>("sol");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<TierChangePhase | null>(null);
  const [logs, setLogs] = useState<TxLog[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [otcRoute, setOtcRoute] = useState<OtcSwapRoute | null>(null);
  const [otcRouteLoading, setOtcRouteLoading] = useState(false);
  const [otcRouteErr, setOtcRouteErr] = useState<string | null>(null);

  const nowTs = Math.floor(Date.now() / 1000);
  const otcPay = otcPayQ.data ?? null;
  const fromTier = currentTier(desk);
  const pending =
    desk.tier && !desk.tier.voided ? pendingYieldLamports(desk.tier, state.config) : 0;
  const claimBlocked = pending > 0 && (!state.otcPot || state.otcPot.totalLamportsSpent <= 0);
  const signer = resolveSigner(address);
  const otcDecimals = balances.data?.otcDecimals ?? OTC_DECIMALS;

  useEffect(() => {
    if (toTier <= fromTier) setToTier(Math.min(fromTier + 1, MAX_TIER));
  }, [fromTier, toTier]);

  const quote: TierQuote | null =
    toTier > fromTier && toTier <= MAX_TIER
      ? quoteTierChange({ config: state.config, tierFee: state.tierFee, otcPay, fromTier, toTier })
      : null;
  const hasQuote = quote !== null;
  const otcAvailable = quote?.otcAvailable ?? false;

  // $OTC can flip to unavailable mid-session (path disabled): fall back to SOL.
  useEffect(() => {
    if (method === "otc" && hasQuote && !otcAvailable) setMethod("sol");
  }, [method, hasQuote, otcAvailable]);

  // Pricing is a live Jupiter quote (§otc_pay.rs), not a stored rate — fetch it whenever the
  // $OTC path is selected and the tier change (i.e. its $HUB burn floor) is known.
  useEffect(() => {
    setOtcRoute(null);
    setOtcRouteErr(null);
    if (method !== "otc" || !quote || !otcAvailable) return;
    let live = true;
    setOtcRouteLoading(true);
    fetchOtcToHubRoute({
      taker: new PublicKey(address),
      otcMint: new PublicKey(state.config.otcMint),
      hubMint: new PublicKey(state.config.hubMint),
      destinationTokenAccount: ataPda(
        new PublicKey(address),
        new PublicKey(state.config.hubMint),
        state.token.hubTokenProgram,
      )[0],
      minHubOut: BigInt(quote.hubBurnUnits),
    })
      .then((route) => {
        if (live) setOtcRoute(route);
      })
      .catch((e: Error) => {
        if (live) setOtcRouteErr(e.message);
      })
      .finally(() => {
        if (live) setOtcRouteLoading(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on primitives, not `quote` identity
  }, [
    method,
    desk.asset,
    quote?.hubBurnUnits,
    otcAvailable,
    address,
    state.config.otcMint,
    state.config.hubMint,
  ]);

  const split = quote ? splitFee(quote.solLamports) : null;
  const otcBal = balances.data?.otcUnits ?? null;
  const hubBal = balances.data?.hubUnits ?? null;
  const hubDecimals = balances.data?.hubDecimals ?? HUB_DECIMALS;
  const otcTotalUnits = otcRoute ? otcPotLeg(otcRoute.otcSwapAmount).otcPaidTotal : null;
  const otcShort =
    method === "otc" && otcTotalUnits != null && otcBal !== null && otcBal < otcTotalUnits;
  const solShort =
    method === "sol" && quote && balances.data
      ? balances.data.solLamports < BigInt(quote.solLamports)
      : false;
  const hubShort =
    quote && hubBal !== null
      ? hubBal < BigInt(quote.hubBurnUnits)
      : quote != null && hubBal === null;

  const run = async () => {
    setErr(null);
    if (!signer) return setErr("read-only address — connect the wallet itself to sign");
    if (!quote) return setErr("pick a target tier above the current tier");
    if (method === "otc" && !quote.otcAvailable)
      return setErr(`$OTC payment unavailable: ${quote.otcUnavailableReason}`);
    if (method === "otc" && !otcRoute)
      return setErr(otcRouteErr ?? "still fetching the $OTC→$HUB route — wait a moment");
    if (hubShort) return setErr("insufficient $HUB balance for this activation's burn cost");
    if (solShort) return setErr("insufficient SOL for the flat activation fee");
    if (method === "otc" && otcShort)
      return setErr("insufficient $OTC balance for this activation's swap cost");
    if (claimBlocked)
      return setErr("pending yield must settle first, but the $OTC yield vault isn't funded yet");
    setBusy(true);
    setLogs([]);
    const res = await executeTierChange({
      connection,
      program,
      signer,
      deskAsset: desk.asset,
      fromTier,
      toTier,
      method,
      config: state.config,
      otcPay,
      otcPot: state.otcPot,
      tokenomics: state.tokenomics,
      pendingLamports: pending,
      otcRoute: otcRoute ?? undefined,
      hubTokenProgram: state.token.hubTokenProgram,
      otcTokenProgram: balances.data?.otcTokenProgram ?? undefined,
      onLog: (l) => setLogs((p) => [...p, l]),
      onPhase: setPhase,
    });
    setBusy(false);
    setPhase(null);
    if (res.ok) {
      // Tier + stamps moved on-chain: refresh protocol + wallet reads.
      await qc.invalidateQueries({ queryKey: ["hub"] });
      onChanged?.();
    }
  };

  const verb = fromTier ? "UPGRADE" : "ACTIVATE";
  // The tier cost is paid in $HUB (burned from the payer's wallet) or in $OTC (Jupiter-swapped
  // into the $HUB burn) — the flat SOL step fee applies to both paths, so the toggle reads
  // $HUB / $OTC, never "SOL" as a payment method.
  const ticker = method === "sol" ? "$HUB" : "$OTC";
  const runLabel = busy
    ? `${(phase ?? "prep").toUpperCase()}…`
    : `[${verb} → T${toTier} · ${ticker}]`;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {TIERS.map((t) => (
          <button
            key={t}
            type="button"
            disabled={busy || t <= fromTier}
            onClick={() => setToTier(t)}
            className={`flex flex-col items-center border py-1.5 text-[11px] disabled:opacity-25 ${
              toTier === t
                ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                : "border-green-500/30 text-green-500/70 hover:border-green-400/50"
            }`}
          >
            <span className="font-bold">
              T{t} {TIER_NAMES[t - 1]}
            </span>
            <span className="inline-flex items-center gap-1 text-[9px] opacity-70">
              {TIER_USD[t - 1]} ·{" "}
              {fmtUnits(BigInt(liveHubCostUnits(t, nowTs, state.config)), HUB_DECIMALS, 0)}
              <StockIcon symbol="HUB" className="h-3 w-3" />
            </span>
          </button>
        ))}
      </div>

      <div className="flex gap-1">
        {(["sol", "otc"] as PayMethod[]).map((m) => (
          <button
            key={m}
            type="button"
            disabled={busy || (m === "otc" && !otcAvailable)}
            onClick={() => setMethod(m)}
            title={
              m === "sol"
                ? "burn the tier cost in $HUB from your wallet (plus the flat SOL fee)"
                : quote?.otcUnavailableReason
                  ? `$OTC unavailable — ${quote.otcUnavailableReason}`
                  : "swap $OTC → $HUB on Jupiter for the burn (plus the flat SOL fee)"
            }
            className={`flex flex-1 items-center justify-center gap-1.5 border py-1 text-[11px] font-bold disabled:opacity-25 ${
              method === m
                ? m === "sol"
                  ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                  : "border-amber-400/60 bg-amber-500/10 text-amber-300"
                : "border-green-500/30 text-green-500/60"
            }`}
          >
            <StockIcon symbol={m === "sol" ? "HUB" : "OTC"} className="h-4 w-4" />
            PAY {m === "sol" ? "$HUB" : `$OTC · ${OTC_TOTAL_PREMIUM}×`}
          </button>
        ))}
      </div>

      {quote && split && (
        <div className="space-y-0.5 border border-green-500/20 p-2 text-[11px]">
          <div className="flex justify-between gap-2">
            <span
              className={`inline-flex items-center gap-1 ${
                method === "sol" ? "text-emerald-300" : "text-amber-300"
              }`}
            >
              <StockIcon symbol={method === "sol" ? "HUB" : "OTC"} className="h-3.5 w-3.5" />
              {method === "sol"
                ? `burn ${fmtUnits(BigInt(quote.hubBurnUnits), HUB_DECIMALS, 0)} HUB`
                : !otcAvailable
                  ? `unavailable — ${quote.otcUnavailableReason}`
                  : otcRouteErr
                    ? `route error — ${otcRouteErr}`
                    : otcRouteLoading || otcTotalUnits == null
                      ? "quoting…"
                      : `${fmtUnits(otcTotalUnits, otcDecimals)} OTC`}
            </span>
            <span className="text-right text-green-700">
              {method === "sol"
                ? fromTier
                  ? `T${fromTier} → T${toTier} difference`
                  : `full T${toTier} cost`
                : `half → $HUB burn · half → yield vault`}
            </span>
          </div>
          {method === "otc" && (
            <div
              className={`flex justify-between gap-2 ${hubShort ? "text-amber-400" : "text-cyan-300"}`}
            >
              <span className="inline-flex items-center gap-1">
                <StockIcon symbol="HUB" className="h-3.5 w-3.5" />
                burn {fmtUnits(BigInt(quote.hubBurnUnits), HUB_DECIMALS, 0)} HUB
              </span>
              <span className="text-green-700">
                {fromTier ? `T${fromTier} → T${toTier} difference` : `full T${toTier} cost`}
              </span>
            </div>
          )}
          <div className="flex justify-between gap-2 text-green-500/70">
            <span className="inline-flex items-center gap-1">
              <StockIcon symbol="SOL" className="h-3.5 w-3.5" />
              {fmtSol(quote.solLamports, 2)} SOL flat fee
            </span>
            <span className="text-green-700">
              {fmtSol(split.toPot, 2)} pot · {fmtSol(split.toOps, 2)} ops
            </span>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-green-700">
        <span className="inline-flex items-center gap-1">
          <StockIcon symbol="SOL" className="h-3.5 w-3.5" />
          {balances.data ? fmtSol(Number(balances.data.solLamports), 3) : "…"}
        </span>
        <span className={`inline-flex items-center gap-1 ${otcShort ? "text-amber-400" : ""}`}>
          <StockIcon symbol="OTC" className="h-3.5 w-3.5" />
          {!balances.data ? "…" : otcBal === null ? "—" : fmtUnits(otcBal, otcDecimals)}
        </span>
        <span className={`inline-flex items-center gap-1 ${hubShort ? "text-amber-400" : ""}`}>
          <StockIcon symbol="HUB" className="h-3.5 w-3.5" />
          {!balances.data ? "…" : hubBal === null ? "—" : fmtUnits(hubBal, hubDecimals, 0)}
        </span>
      </div>
      {(otcShort || solShort || hubShort) && (
        <div className="text-[10px] text-amber-400">
          insufficient {hubShort ? "$HUB" : otcShort ? "$OTC" : "SOL (flat fee)"} for this{" "}
          {verb.toLowerCase()}.
        </div>
      )}

      <button
        type="button"
        onClick={run}
        disabled={
          busy ||
          !hasQuote ||
          hubShort ||
          solShort ||
          claimBlocked ||
          (method === "otc" && (!otcAvailable || !otcRoute || otcShort))
        }
        className="w-full border border-emerald-500/60 py-2 text-[13px] font-bold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-30"
      >
        {runLabel}
      </button>

      {claimBlocked && (
        <div className="text-[10px] text-amber-400">
          this desk has {fmtSol(pending, 4)} pending yield that must settle first — the $OTC yield
          vault isn't funded yet.
        </div>
      )}
      {!signer && (
        <div className="text-[10px] text-amber-400/80">
          read-only address — connect the wallet itself to sign.
        </div>
      )}
      {err && <div className="text-[11px] text-amber-400">ERR: {err}</div>}
      <TxLogView logs={logs} />
      <div className="text-[10px] text-green-700">
        SOL fee scales by target tier (T1–T4) · upgrades burn only the $HUB difference ·
        simulated before signing · or use the{" "}
        <a
          href={OFFICIAL_DESKS_URL}
          target="_blank"
          rel="noreferrer"
          className="text-cyan-500 underline hover:text-cyan-300"
          title="official OTC Desks activation platform (mainnet)"
        >
          official interface ↗
        </a>
      </div>
    </div>
  );
}