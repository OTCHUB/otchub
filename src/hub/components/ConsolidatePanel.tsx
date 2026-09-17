import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import {
  hubPotClaimPda,
  otcDueForLamports,
  pendingYieldLamports,
  type ProtocolState,
} from "@hub-sdk";
import { useHub } from "../HubProvider";
import { useHubPot } from "../hooks/useHubPot";
import type { OwnedDesk } from "../hooks/useWalletPortfolio";
import {
  consolidationTargets,
  executeConsolidation,
  type ConsolidationReport,
} from "../lib/consolidate";
import { fmtSol, fmtUnits, shortKey } from "../lib/format";
import type { TxLog } from "../lib/swap";
import { AddressLink } from "./ui/AddressLink";
import { StockIcon } from "./ui/StockIcon";
import { TxLogView } from "./ui/TxLogView";

type Props = { state: ProtocolState; address: string; desks: OwnedDesk[]; onDone?: () => void };
const SLIPPAGES = [50, 100, 300] as const;

/**
 * CONSOLIDATE & SWAP — one workflow over every reward surface the wallet can collect on: yield
 * claims ($OTC) + M.I.M pot round shares (basket), then converts everything that arrived into
 * the chosen output token (default SOL; $HUB pinned first in the dropdown). Mainnet-only — the
 * conversion leg routes through Jupiter, which has no devnet liquidity. Claims stay available
 * via the normal panels on other clusters.
 */
export function ConsolidatePanel({ state, address, desks, onDone }: Props) {
  const { connection, program, programId, cluster, swapTransport, resolveSigner } = useHub();
  const hubPot = useHubPot();
  const [targetSymbol, setTargetSymbol] = useState("SOL");
  const [slippageBps, setSlippageBps] = useState(100);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [logs, setLogs] = useState<TxLog[]>([]);
  const [report, setReport] = useState<ConsolidationReport | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const { config } = state;
  const targets = useMemo(() => consolidationTargets(config.hubMint), [config.hubMint]);
  const target = targets.find((t) => t.symbol === targetSymbol) ?? targets[1];

  const activeDesks = desks.filter((d) => d.tier && !d.tier.voided);
  const yieldRows = activeDesks
    .map((d) => ({ asset: d.asset, pending: pendingYieldLamports(d.tier!, config) }))
    .filter((r) => r.pending > 0);
  const totalPending = yieldRows.reduce((s, r) => s + r.pending, 0);
  const estOtc = otcDueForLamports(totalPending, state.otcPot);
  const round = hubPot.data?.latestRound ?? null;

  // Which of this wallet's active desks already claimed the latest pot round (HubPotClaim PDA
  // exists ⇒ paid) — same check HubPotPanel runs, so CONSOLIDATE never re-bills a paid desk.
  const potStatus = useQuery({
    queryKey: ["hub", "consolidate-pot", programId.toBase58(), round?.index, address],
    enabled: !!round && activeDesks.length > 0,
    queryFn: async () => {
      const keys = activeDesks.map(
        (d) => hubPotClaimPda(programId, round!.index, new PublicKey(d.asset))[0],
      );
      const infos = await connection.getMultipleAccountsInfo(keys, "confirmed");
      return new Set(activeDesks.filter((_, i) => infos[i]).map((d) => d.asset));
    },
  });
  const potClaimable = round
    ? activeDesks.map((d) => d.asset).filter((a) => !potStatus.data?.has(a))
    : [];
  const nothingToDo = yieldRows.length === 0 && potClaimable.length === 0;

  const signer = resolveSigner(address);
  if (cluster !== "mainnet-beta" || !address || nothingToDo || (!hubPot.data?.pot && yieldRows.length === 0))
    return null;

  const run = async () => {
    setErr(null);
    setReport(null);
    if (!signer) return setErr("read-only address — connect the wallet itself to sign");
    setBusy(true);
    setLogs([]);
    try {
      const rep = await executeConsolidation({
        connection,
        program,
        signer,
        config,
        otcPot: state.otcPot,
        yieldAssets: yieldRows.map((r) => r.asset),
        yieldPendingLamports: totalPending,
        pot: hubPot.data?.pot ?? null,
        potRoundIndex: round?.index ?? null,
        potAssets: potClaimable,
        target,
        slippageBps,
        transport: swapTransport,
        onLog: (l) => setLogs((p) => [...p, l]),
        onPhase: setPhase,
      });
      setReport(rep);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      setPhase(null);
      onDone?.();
    }
  };

  return (
    <div className="mt-2 border border-cyan-500/25 bg-cyan-500/5 p-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-300">
          CONSOLIDATE &amp; SWAP
        </span>
        <span className="text-green-600">
          yield ≈ {fmtSol(totalPending, 4)}
          {estOtc != null ? ` (${fmtUnits(estOtc, 6)} OTC)` : ""} · pot: {potClaimable.length}{" "}
          desk share(s){round ? ` · round #${round.index}` : ""}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-green-600">into</span>
        <span className="flex items-center gap-1 border border-green-500/30 bg-black px-1">
          <StockIcon symbol={target.symbol} className="h-4 w-4" />
          <select
            value={targetSymbol}
            onChange={(e) => setTargetSymbol(e.target.value)}
            disabled={busy}
            aria-label="output token"
            className="bg-black py-1 text-[11px] font-bold text-cyan-300 outline-none"
          >
            {targets.map((t) => (
              <option key={t.mint} value={t.symbol}>
                {t.symbol === "HUB" ? "$HUB (protocol)" : t.symbol}
              </option>
            ))}
          </select>
        </span>
        <span className="flex gap-1 text-[10px]">
          {SLIPPAGES.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setSlippageBps(b)}
              disabled={busy}
              className={`border px-1.5 py-0.5 ${slippageBps === b ? "border-emerald-500/60 text-emerald-300" : "border-green-500/30 text-green-500/60"}`}
            >
              {b / 100}%
            </button>
          ))}
        </span>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || !signer}
          className="ml-auto border border-cyan-400/60 px-2.5 py-1 font-bold text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-30"
        >
          {busy ? `${(phase ?? "prep").toUpperCase()}…` : `[CONSOLIDATE → ${target.symbol}]`}
        </button>
      </div>
      {!signer && (
        <div className="mt-1 text-[10px] text-amber-400/80">
          read-only address — connect the wallet itself to sign.
        </div>
      )}
      {err && <div className="mt-1 text-[11px] text-amber-400">ERR: {err}</div>}
      <TxLogView logs={logs} />
      {report && (
        <div className="mt-2 space-y-0.5 border-t border-cyan-500/20 pt-1.5 text-[10px]">
          <div className="text-green-500">
            CLAIMS: yield {report.claims.yieldOk}/{report.claims.yieldAssets} · pot{" "}
            {report.claims.potOk}/{report.claims.potAssets}
          </div>
          {report.swaps.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-16">{s.symbol}</span>
              <span className="flex-1 text-green-600">in {s.inUnits.toString()} raw</span>
              {s.ok && s.sig ? (
                <AddressLink address={s.sig} kind="tx" label="landed ↗" />
              ) : (
                <span className="truncate text-amber-400" title={s.reason}>
                  left in wallet ({shortKey(s.reason ?? "", 6)})
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 text-[10px] text-green-700">
        Claims sim-gate per desk; each token gets a fresh quote + unsigned sim; one sign prompt
        covers the swaps; anything that fails is left in your wallet with the reason.
      </div>
    </div>
  );
}
