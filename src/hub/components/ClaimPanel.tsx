import { useState } from "react";
import {
  otcDueForLamports,
  pendingYieldLamports,
  TIER_NAMES,
  type ProtocolState,
} from "@hub-sdk";
import type { OwnedDesk } from "../hooks/useWalletPortfolio";
import { useClaimRunner } from "../hooks/useClaimRunner";
import { fmtSol, fmtUnits } from "../lib/format";
import { AddressLink } from "./ui/AddressLink";
import { TxLogView } from "./ui/TxLogView";

/** $OTC mint decimals fallback when no ATA balance has been fetched to read the real value from. */
const OTC_DECIMALS = 6;

type Props = { address: string; state: ProtocolState; desks: OwnedDesk[]; onClaimed?: () => void };

/** CLAIM — one compact bar under the wallet summary: total pending + [CLAIM ALL] + an opt-in
 * SELECT list for per-desk claims. Renders nothing until the wallet has an activated desk, so
 * raw-only wallets see no claim chrome at all. Per-desk claims also live in the DeskSheet. */
export function ClaimPanel({ address, state, desks, onClaimed }: Props) {
  const claim = useClaimRunner(address, state, () => {
    setSelected(new Set());
    onClaimed?.();
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState(false);

  const otcPot = state.otcPot;
  const otcReady = !!otcPot && otcPot.totalLamportsSpent > 0;
  const rows = desks
    .filter((d) => d.tier && !d.tier.voided)
    .map((d) => ({ ...d, pending: pendingYieldLamports(d.tier!, state.config) }))
    .sort((a, b) => b.pending - a.pending);
  if (rows.length === 0) return null;

  const claimable = rows.filter((r) => r.pending > 0);
  const totalPending = claimable.reduce((s, r) => s + r.pending, 0);
  const totalOtcDue = otcDueForLamports(totalPending, otcPot);

  const toggle = (a: string) =>
    setSelected((p) => {
      const n = new Set(p);
      if (n.has(a)) n.delete(a);
      else n.add(a);
      return n;
    });

  return (
    <div className="mt-2 border border-emerald-500/25 bg-emerald-500/5 p-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">
          YIELD
        </span>
        <span className="text-green-300">
          {fmtSol(totalPending, 4)}
          {totalOtcDue != null ? ` ≈ ${fmtUnits(totalOtcDue, OTC_DECIMALS)} OTC` : ""}
        </span>
        {claimable.length > 0 && (
          <button
            type="button"
            onClick={() => void claim.run(claimable.map((r) => r.asset), totalPending)}
            disabled={claim.busy || !otcReady}
            className="ml-auto border border-emerald-500/60 px-2.5 py-1 font-bold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-30"
          >
            {claim.busy ? `${(claim.phase ?? "prep").toUpperCase()}…` : "[CLAIM ALL]"}
          </button>
        )}
        <button
          type="button"
          onClick={() => setPicking((o) => !o)}
          disabled={claimable.length === 0}
          className="border border-green-500/30 px-2 py-1 text-green-500/70 hover:text-green-300 disabled:opacity-30"
        >
          [{picking ? "CLOSE" : "SELECT"}]
        </button>
      </div>

      {picking && claimable.length > 0 && (
        <div className="mt-2 max-h-40 overflow-y-auto border border-green-500/20">
          {claimable.map((r) => (
            <label
              key={r.asset}
              className={`flex cursor-pointer items-center gap-2 border-b border-green-500/10 px-2 py-1.5 text-xs last:border-0 ${
                selected.has(r.asset) ? "bg-emerald-500/10" : "hover:bg-green-500/5"
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(r.asset)}
                disabled={claim.busy}
                onChange={() => toggle(r.asset)}
                className="accent-emerald-500"
              />
              <span className="min-w-0 flex-1">
                <AddressLink address={r.asset} />
              </span>
              <span className="text-cyan-300">
                {TIER_NAMES[r.tier!.tier - 1] ?? `T${r.tier!.tier}`}
              </span>
              <span className="w-24 text-right text-emerald-300">
                {fmtSol(r.pending, 4)}
                {(() => {
                  const due = otcDueForLamports(r.pending, otcPot);
                  return due != null ? (
                    <span className="block text-[9px] text-green-600">
                      ≈{fmtUnits(due, OTC_DECIMALS)} OTC
                    </span>
                  ) : null;
                })()}
              </span>
            </label>
          ))}
          {selected.size > 0 && (
            <div className="p-1.5">
              <button
                type="button"
                onClick={() => {
                  const rows = claimable.filter((r) => selected.has(r.asset));
                  void claim.run(
                    rows.map((r) => r.asset),
                    rows.reduce((s, r) => s + r.pending, 0),
                  );
                }}
                disabled={claim.busy || !otcReady}
                className="w-full border border-emerald-500/60 py-1 text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-30"
              >
                [CLAIM SELECTED ({selected.size})]
              </button>
            </div>
          )}
        </div>
      )}

      {claim.err && <div className="mt-1 text-[11px] text-amber-400">ERR: {claim.err}</div>}
      <TxLogView logs={claim.logs} />
      {!otcReady && (
        <div className="mt-1 text-[10px] text-amber-400/80">
          {!otcPot
            ? "$OTC yield vault not provisioned yet"
            : "waiting on the keeper's first $OTC buy — claims unlock after"}
        </div>
      )}
    </div>
  );
}