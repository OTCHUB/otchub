import React from "react";
import { fmtSol } from "@/lib/format";

// One-day fee flow, drawn as proportional CSS bars instead of a Sankey:
// inflow sources → POT node → outflows. Scales cleanly to any screen width,
// every stage sized against the same SOL total so widths are comparable.

const COLORS = {
  mint: "#3b82f6",
  royalty: "#22d3ee",
  launchpad: "#a78bfa",
  other: "#fbbf24",
  dist: "#4ade80",
  retained: "#f59e0b",
};

// Every bar row shares the same fixed label / value / note column widths, so
// all tracks are exactly the same width and stack pixel-aligned — including
// rows with no note (the note column is always reserved on sm+). The share
// percentage reads out inside the track so short fills still carry their info.
function Bar({ label, value, total, color, note = null }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] sm:gap-2">
      <span className="w-28 shrink-0 truncate uppercase tracking-wide text-green-500/70">
        {label}
      </span>
      <span className="relative h-4 min-w-0 flex-1 overflow-hidden border border-green-500/15 bg-green-500/5">
        {pct > 0 && (
          <span
            className="absolute inset-y-0 left-0 transition-[width] duration-500"
            style={{ width: `${pct}%`, background: color, opacity: 0.7 }}
          />
        )}
        <span className="absolute inset-y-0 right-1 flex items-center text-[9px] leading-none text-green-400/80">
          {pct >= 1 ? `${Math.round(pct)}%` : total > 0 ? "<1%" : "—"}
        </span>
      </span>
      <span className="w-[72px] shrink-0 text-right sm:w-20" style={{ color }}>
        +{fmtSol(value, 2)}
      </span>
      <span className="hidden w-24 shrink-0 truncate text-right text-[10px] text-green-500/40 sm:block">
        {note ?? ""}
      </span>
    </div>
  );
}

const Arrow = ({ label, value = null }) => (
  <div className="flex items-center justify-center gap-1.5 py-0.5 font-mono text-[11px] uppercase tracking-widest text-green-500/60">
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
  const launchpad = seg?.launchpad || 0;
  const other = seg?.other || 0;
  const inflow = mint + royalty + launchpad + other;

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
        <span className="font-mono text-[12px] uppercase tracking-widest text-green-500/70">
          Fee flow · {day ? day.slice(5) : "—"} · closed day · bar = SOL
        </span>
        <span className="font-mono text-[11px] uppercase text-green-500/60">
          in {fmtSol(inflow, 1)} · dist {fmtSol(dist, 1)} · kept {fmtSol(retained, 1)}
        </span>
      </div>

      {inflow > 0 || day ? (
        <>
          <Bar label="Desk mints" value={mint} total={inflow} color={COLORS.mint} note="0.45/mint" />
          <Bar label="ME sales" value={royalty} total={inflow} color={COLORS.royalty} note="5% royalty" />
          <Bar label="Creator fees" value={launchpad} total={inflow} color={COLORS.launchpad} note="10% pot share" />
          <Bar label="Sweeps" value={other} total={inflow} color={COLORS.other} note="unattrib" />

          <Arrow label="in" value={inflow} />

          <div className="mx-auto max-w-[200px] border-2 border-emerald-400 bg-emerald-400/10 px-3 py-1 text-center">
            <div className="font-mono text-[13px] font-bold uppercase tracking-widest text-emerald-300">POT</div>
            <div className="font-mono text-[11px] text-green-500/70">{fmtSol(latest?.pot_sol_balance ?? null, 1)} SOL</div>
          </div>

          <Arrow label="out" />
          <Bar label="Desk holders" value={dist} total={inflow} color={COLORS.dist}
            note={perDesk != null ? `${fmtSol(perDesk, 3)}/desk` : null} />
          <Bar label="Retained" value={retained} total={inflow} color={COLORS.retained} note="in pot" />
        </>
      ) : (
        <div className="py-3 text-center font-mono text-[12px] uppercase text-green-500/50">
          No flow data for the last closed day
        </div>
      )}

      {/* who gets enriched: launcher-coin holders vs desk holders */}
      {totalDist != null && deskLedgerSol > 0 && launcherSol != null && (
        <div className="space-y-1 border border-fuchsia-500/30 bg-fuchsia-500/5 px-2 py-1.5">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <span className="font-mono text-[12px] uppercase tracking-widest text-fuchsia-300/80">
              Reward split · who gets enriched
            </span>
            <span className="font-mono text-[11px] uppercase text-green-500/60">
              {fmtSol(totalDist, 0)} SOL distributed · {launcherPct}/{100 - launcherPct} split
            </span>
          </div>
          <Bar label="Launch holders" value={launcherSol} total={totalDist} color="#e879f9"
            note={launcherPct != null ? `${launcherPct}%` : null} />
          <Bar label="Desk holders" value={deskLedgerSol} total={totalDist} color="#4ade80"
            note={`${100 - launcherPct}%`} />
          <div className="font-mono text-[10px] uppercase text-green-500/50">
            Launch baskets: GPRO · PUMP · QQQx · SPYx · TTWO · HOODx … → launcher-coin holders · Desks: 13-stock rotation · Ledger: otcdesks.cash
          </div>
          <div className="font-mono text-[11px] uppercase text-fuchsia-300/90">
            ✦ Launch holders out-earn desks ≈{(deskLedgerSol > 0 ? (launcherSol / deskLedgerSol).toFixed(1) : "—")}:1
            — launchpad fees enrich launchers &amp; holders first
          </div>
        </div>
      )}
    </div>
  );
}