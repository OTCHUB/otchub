import React from "react";
import { fmtSol } from "@/lib/format";

// One-day fee flow, drawn as proportional CSS bars instead of a Sankey:
// inflow sources → POT node → outflows. Scales cleanly to any screen width,
// every stage sized against the same SOL total so widths are comparable.

const COLORS = {
  mint: "#3b82f6",
  royalty: "#22d3ee",
  other: "#fbbf24",
  dist: "#4ade80",
  retained: "#f59e0b",
  broken: "#f43f5e",
};

function Bar({ label, value, total, color, broken = false, note }) {
  const pct = !broken && total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div className="flex min-w-0 items-center gap-1.5 font-mono text-[9px] sm:gap-2">
      <span className="w-[70px] shrink-0 truncate uppercase tracking-wide text-green-500/70 sm:w-24">
        {label}
      </span>
      <span
        className={`relative h-4 min-w-0 flex-1 overflow-hidden border ${
          broken ? "border-dashed border-red-500/60 bg-red-500/5" : "border-green-500/15 bg-green-500/5"
        }`}
      >
        {!broken && pct > 0 && (
          <span
            className="absolute inset-y-0 left-0 transition-[width] duration-500"
            style={{ width: `${pct}%`, background: color, opacity: 0.7 }}
          />
        )}
      </span>
      <span
        className={`w-[64px] shrink-0 text-right sm:w-16 ${broken ? "text-red-400" : ""}`}
        style={!broken ? { color } : undefined}
      >
        {broken ? "✖ 0.00" : `+${fmtSol(value, 2)}`}
      </span>
      {note && <span className="hidden shrink-0 text-[8px] text-green-500/40 sm:block">{note}</span>}
    </div>
  );
}

const Arrow = ({ label, value }) => (
  <div className="flex items-center justify-center gap-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-green-500/60">
    <span className="h-3 w-0.5 pot-flow-y" />
    <span>▼ {label} {value != null ? `+${fmtSol(value, 2)} SOL` : ""}</span>
  </div>
);

export default function PotFlowDiagram({ latest }) {
  const todayKey = new Date().toISOString().slice(0, 10);
  const dayRows = Object.entries(latest?.pot_sources?.days || {}).sort(([a], [b]) => a.localeCompare(b));
  const closedRows = dayRows.filter(([d]) => d < todayKey);
  const [day, seg] = closedRows.at(-1) || dayRows.at(-1) || [];
  const mint = seg?.mint || 0;
  const royalty = seg?.royalty || 0;
  const other = seg?.other || 0;
  const inflow = mint + royalty + other;

  const deskRows = (latest?.per_desk?.items || [])
    .filter((r) => String(r.day || "") < todayKey)
    .sort((a, b) => String(a.day).localeCompare(String(b.day)));
  const sameDayDesk = deskRows.find((r) => r.day === day);
  const dist = (sameDayDesk || deskRows.at(-1) || {}).total_earned_sol || 0;
  const retained = Math.max(0, inflow - dist);
  const perDesk = (sameDayDesk || deskRows.at(-1) || {}).per_desk_sol;

  // REWARD_SPLIT: who the protocol's distributions actually enrich. The
  // otcdesks ledger (byStock) sums to the distributed headline; rows in the
  // 13-stock desk rotation go to DESK holders, everything else (GPRO, PUMP,
  // QQQx, SPYx, …) is the launchpad's launcher-coin-holder reward basket.
  const deskLedgerSol = (latest?.by_stock?.items || []).reduce(
    (a, r) => a + (r.distributed_sol || 0),
    0
  );
  const totalDist = latest?.protocol_distributed_sol;
  const launcherSol = totalDist != null ? Math.max(0, totalDist - deskLedgerSol) : null;
  const launcherPct =
    totalDist > 0 && launcherSol != null ? Math.round((launcherSol / totalDist) * 100) : null;

  return (
    <div className="space-y-1.5 border border-green-500/20 px-2 py-2">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <span className="font-mono text-[10px] uppercase tracking-widest text-green-500/70">
          FLOW :: {day ? day.slice(5) : "—"} · CLOSED DAY · BAR = SOL
        </span>
        <span className="font-mono text-[9px] text-green-500/60">
          IN {fmtSol(inflow, 1)} · DIST {fmtSol(dist, 1)} · KEPT {fmtSol(retained, 1)}
        </span>
      </div>

      {inflow > 0 || day ? (
        <>
          <Bar label="DESK_MINTS" value={mint} total={inflow} color={COLORS.mint} note="0.45/mint" />
          <Bar label="ME_SALES" value={royalty} total={inflow} color={COLORS.royalty} note="5% royalty" />
          <Bar label="SWEEPS" value={other} total={inflow} color={COLORS.other} note="unattrib" />
          <Bar label="CREATOR_FEES" value={0} total={inflow} color={COLORS.broken} broken note="vaults ≠ pot" />

          <Arrow label="IN" value={inflow} />

          <div className="mx-auto max-w-[200px] border-2 border-emerald-400 bg-emerald-400/10 px-3 py-1 text-center">
            <div className="font-mono text-[11px] font-bold uppercase tracking-widest text-emerald-300">POT</div>
            <div className="font-mono text-[9px] text-green-500/70">{fmtSol(latest?.pot_sol_balance ?? null, 1)} SOL</div>
          </div>

          <Arrow label="OUT" />
          <Bar label="DESK_HOLDERS" value={dist} total={inflow} color={COLORS.dist}
            note={perDesk != null ? `${fmtSol(perDesk, 3)}/desk` : null} />
          <Bar label="RETAINED" value={retained} total={inflow} color={COLORS.retained} note="in pot" />
        </>
      ) : (
        <div className="py-3 text-center font-mono text-[10px] text-green-500/50">
          NO FLOW DATA FOR THE LAST CLOSED DAY
        </div>
      )}

      <div className="text-center font-mono text-[8px] text-red-400/80">
        ✖ CREATOR_FEES · 10% DESK SHARE OF LAUNCHPAD FEES NOT LANDING
      </div>

      {/* who gets enriched: launcher-coin holders vs desk holders */}
      {totalDist != null && deskLedgerSol > 0 && launcherSol != null && (
        <div className="space-y-1 border border-fuchsia-500/30 bg-fuchsia-500/5 px-2 py-1.5">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <span className="font-mono text-[10px] uppercase tracking-widest text-fuchsia-300/80">
              REWARD_SPLIT :: WHO GETS ENRICHED
            </span>
            <span className="font-mono text-[9px] text-green-500/60">
              {fmtSol(totalDist, 0)} SOL DISTRIBUTED · {launcherPct}/{100 - launcherPct} SPLIT
            </span>
          </div>
          <Bar label="LAUNCH_HOLDERS" value={launcherSol} total={totalDist} color="#e879f9"
            note={launcherPct != null ? `${launcherPct}%` : null} />
          <Bar label="DESK_HOLDERS" value={deskLedgerSol} total={totalDist} color="#4ade80"
            note={`${100 - launcherPct}%`} />
          <div className="font-mono text-[8px] text-green-500/50">
            LAUNCH_BASKETS: GPRO · PUMP · QQQx · SPYx · TTWO · HOODx … → LAUNCHER-COIN HOLDERS · DESKS: 13-STOCK ROTATION · LEDGER: otcdesks.cash
          </div>
          <div className="font-mono text-[9px] text-fuchsia-300/90">
            ✦ LAUNCH HOLDERS OUT-EARN DESKS ≈{(deskLedgerSol > 0 ? (launcherSol / deskLedgerSol).toFixed(1) : "—")}:1
            — LAUNCHPAD FEES ENRICH LAUNCHERS &amp; HOLDERS FIRST
          </div>
        </div>
      )}
    </div>
  );
}