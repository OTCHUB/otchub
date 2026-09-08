import React, { useState } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { fmtSol, fmtUsd } from "@/lib/format";

export default function EarningsChart({ latest, history }) {
  const [unit, setUnit] = useState("USD");
  const raw = latest?.per_desk?.items || [];
  const solUsd = latest?.sol_price_usd || 0;
  const toUnit = (sol) => (unit === "USD" ? sol * solUsd : sol);
  const fmt = (v) => (unit === "USD" ? fmtUsd(v, 2) : fmtSol(v, 3));

  // Only CLOSED (completed) UTC days feed every metric and both charts: the
  // feed's newest day is the in-progress working day, whose partial numbers
  // would skew the 1D figures and dwarf the APR/breakeven trend scale.
  const todayKey = new Date().toISOString().slice(0, 10);
  const closed = raw
    .filter((d) => String(d.day || "") < todayKey)
    .sort((a, b) => String(a.day).localeCompare(String(b.day)));
  const floorSol = latest?.nft_floor_sol || 0;

  // Daily floor from snapshot history (last floor recorded per day) so the
  // trend uses each day's ACTUAL floor, not today's.
  const floorByDay = {};
  for (const h of history || []) {
    if (h?.nft_floor_sol != null && h?.t) {
      floorByDay[String(h.t).slice(0, 10)] = h.nft_floor_sol;
    }
  }

  // ONE aligned dataset for BOTH charts (same rows, same order, same labels)
  // so the earnings bars and the APR/breakeven points line up day-for-day.
  // Bootstrap (single-desk) days keep their bar but carry no avg/APR point —
  // their one-off payout would dwarf the trend.
  const data = closed.map((d) => {
    const desks = d.desks || 0;
    const pd = d.per_desk_sol || 0;
    const totalSol = d.total_earned_sol ?? pd * desks;
    const floor = floorByDay[String(d.day)] ?? floorSol;
    return {
      day: String(d.day),
      label: String(d.day).slice(5),
      total: toUnit(totalSol),
      avg: desks > 1 ? toUnit(pd) : null,
      desks,
      pd,
      apr: floor > 0 && pd > 0 && desks > 1 ? (pd / floor) * 365 * 100 : null,
      be: floor > 0 && pd > 0 && desks > 1 ? floor / pd : null,
    };
  });

  // 1D = the LAST CLOSED day (never the in-progress working day).
  const lastClosed = data.length ? data[data.length - 1] : null;
  const todayPerDeskSol = lastClosed?.pd;
  const trailing = data.slice(-7).filter((d) => d.pd > 0 && d.desks > 1);
  const trailingAvgSol = trailing.length
    ? trailing.reduce((a, d) => a + d.pd, 0) / trailing.length
    : null;
  const breakevenDays = trailingAvgSol && trailingAvgSol > 0 ? floorSol / trailingAvgSol : null;
  const breakeven1dDays = todayPerDeskSol && todayPerDeskSol > 0 ? floorSol / todayPerDeskSol : null;
  // APR = daily per-desk earning annualized against the desk's floor cost.
  const apr1dPct = todayPerDeskSol && floorSol > 0 ? (todayPerDeskSol / floorSol) * 365 * 100 : null;
  const aprAvgPct = trailingAvgSol && floorSol > 0 ? (trailingAvgSol / floorSol) * 365 * 100 : null;

  // Direction readout: the latest CLOSED day's per-desk earning vs the day
  // before it (D/D) and vs the trailing 7D average — makes the trend direction
  // readable at a glance without squinting at the chart slopes.
  const prevClosed = data.length > 1 ? data[data.length - 2] : null;
  const prevPd = prevClosed?.pd;
  const dodPct =
    todayPerDeskSol > 0 && prevPd > 0 ? ((todayPerDeskSol - prevPd) / prevPd) * 100 : null;
  const vs7dPct =
    todayPerDeskSol > 0 && trailingAvgSol > 0
      ? ((todayPerDeskSol - trailingAvgSol) / trailingAvgSol) * 100
      : null;
  const dir = dodPct == null ? "▬" : dodPct > 2 ? "▲" : dodPct < -2 ? "▼" : "▬";
  const dirCls =
    dir === "▲"
      ? "text-emerald-400 border-emerald-500/50"
      : dir === "▼"
      ? "text-red-400 border-red-500/50"
      : "text-green-500/60 border-green-500/30";

  return (
    <div className="border border-green-500/30 bg-black p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[12px] uppercase tracking-widest text-green-500/70">
            EARNINGS :: {unit} / DAY
          </div>
          <div className="mt-1 text-[11px] text-green-500/40">
            bars = total into desks · line = avg / desk · closed days only · bootstrap excluded from avg
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] font-mono">
            <span className="text-emerald-400/80">
              BREAKEVEN: 1D {breakeven1dDays != null ? `${breakeven1dDays.toFixed(1)}d` : "—"} · 7D_AVG {breakevenDays != null ? `${breakevenDays.toFixed(1)}d` : "—"} @ FLOOR {fmtSol(floorSol, 2)}
            </span>
            <span className="text-cyan-400/80">
              APR: 1D {apr1dPct != null ? `${apr1dPct.toFixed(0)}%` : "—"} · 7D_AVG {aprAvgPct != null ? `${aprAvgPct.toFixed(0)}%` : "—"}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-green-500/40">
            APR = per-desk daily earning annualized vs NFT floor · 1D = last CLOSED day · last {fmtSol(todayPerDeskSol, 4)} vs 7d {fmtSol(trailingAvgSol, 4)}
          </div>
        </div>
        <div className="flex gap-1">
          {["USD", "SOL"].map((u) => (
            <button
              key={u}
              onClick={() => setUnit(u)}
              className={`border px-2 py-0.5 font-mono text-[12px] ${
                unit === u ? "border-emerald-500/50 text-emerald-400" : "border-green-500/30 text-green-500/60"
              }`}
            >
              [{u}]
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 h-52 sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#0a3a1a" strokeDasharray="2 4" />
            <XAxis dataKey="label" stroke="#1a6b3a" fontSize={12} tick={{ fill: "#2a8b4a" }} />
            <YAxis yAxisId="sol" stroke="#1a6b3a" fontSize={12} tick={{ fill: "#2a8b4a" }} tickFormatter={(v) => `${+v.toFixed(1)}`} width={56} />
            <YAxis yAxisId="avg" orientation="right" stroke="#1a6b3a" fontSize={12} tick={{ fill: "#2a8b4a" }} tickFormatter={(v) => `${+v.toFixed(3)}`} width={48} />
            <Tooltip
              contentStyle={{ background: "#000", border: "1px solid #1a6b3a", borderRadius: 0, fontFamily: "monospace", fontSize: 13 }}
              labelStyle={{ color: "#22c55e" }}
              formatter={(v, n) => (n === "AVG_DESK" ? [v == null ? "bootstrap" : fmt(v), n] : [fmt(v), n])}
            />
            <Legend wrapperStyle={{ fontSize: 12, fontFamily: "monospace", color: "#2a8b4a" }} />
            <Bar yAxisId="sol" dataKey="total" name="TOTAL" fill="#0a3a1a" stroke="#1a6b3a" />
            <Line yAxisId="avg" type="monotone" dataKey="avg" name="AVG_DESK" stroke="#4ade80" dot={{ r: 2, fill: "#4ade80" }} strokeWidth={1.5} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* APR + breakeven trend — shows whether the yield is rising or fading */}
      <div className="mt-3 border-t border-green-500/20 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="text-[12px] uppercase tracking-widest text-green-500/70">
            APR &amp; BREAKEVEN :: TREND (PER DESK / DAY)
          </div>
          <span
            className={`border px-2 py-0.5 font-mono text-[12px] ${dirCls}`}
            title="Direction of the per-desk daily earning rate: D/D = latest closed day vs the day before · vs 7D = latest closed day vs the trailing 7-day average"
          >
            RATE_DIR {dir}{" "}
            {dodPct != null ? `${dodPct >= 0 ? "+" : ""}${dodPct.toFixed(1)}% D/D` : "—"}
            {vs7dPct != null
              ? ` · ${vs7dPct >= 0 ? "+" : ""}${vs7dPct.toFixed(1)}% vs 7D`
              : ""}
          </span>
        </div>
        <div className="mt-1 text-[11px] text-green-500/40">
          APR = daily per-desk earning annualized vs that day's NFT floor · BE = days to recoup
          the floor at that day's earning rate · closed days only · bootstrap days excluded
        </div>
        <div className="mt-1 h-40 sm:h-48">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 4, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#0a3a1a" strokeDasharray="2 4" />
              <XAxis dataKey="label" stroke="#1a6b3a" fontSize={12} tick={{ fill: "#2a8b4a" }} />
              <YAxis
                yAxisId="apr"
                stroke="#1a6b3a"
                fontSize={12}
                tick={{ fill: "#2a8b4a" }}
                tickFormatter={(v) => `${+v.toFixed(0)}%`}
                width={56}
              />
              <YAxis
                yAxisId="be"
                orientation="right"
                stroke="#1a6b3a"
                fontSize={12}
                tick={{ fill: "#2a8b4a" }}
                tickFormatter={(v) => `${+v.toFixed(0)}d`}
                width={48}
              />
              <Tooltip
                contentStyle={{ background: "#000", border: "1px solid #1a6b3a", borderRadius: 0, fontFamily: "monospace", fontSize: 13 }}
                labelStyle={{ color: "#22c55e" }}
                formatter={(v, n) =>
                  v == null ? ["—", n] : [n === "APR" ? `${Number(v).toFixed(1)}%` : `${Number(v).toFixed(1)} days`, n]
                }
              />
              <Legend wrapperStyle={{ fontSize: 12, fontFamily: "monospace", color: "#2a8b4a" }} />
              <Line yAxisId="apr" type="monotone" dataKey="apr" name="APR" stroke="#22d3ee" dot={{ r: 2, fill: "#22d3ee" }} strokeWidth={1.5} connectNulls />
              <Line yAxisId="be" type="monotone" dataKey="be" name="BREAKEVEN" stroke="#fbbf24" dot={{ r: 2, fill: "#fbbf24" }} strokeWidth={1.5} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}