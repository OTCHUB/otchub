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

  // Chronological left→right (oldest at left, newest at right): the feed
  // arrives oldest-first, so sort ascending explicitly — reversing it made
  // the chart read backwards in time.
  const data = raw
    .slice()
    .sort((a, b) => String(a.day).localeCompare(String(b.day)))
    .map((d) => {
      const desks = d.desks || 0;
      const totalSol = d.total_earned_sol ?? (d.per_desk_sol || 0) * desks;
      return {
        day: String(d.day),
        total: toUnit(totalSol),
        avg: desks > 1 ? toUnit(d.per_desk_sol) : null,
        desks,
        pd: d.per_desk_sol || 0,
      };
    });

  const sortedRaw = [...raw].sort((a, b) => String(b.day || "").localeCompare(String(a.day || "")));
  const todayPerDeskSol = sortedRaw[0]?.per_desk_sol;
  const window = 7;
  const trailing = sortedRaw.slice(0, window).filter((d) => (d.per_desk_sol || 0) > 0);
  const trailingAvgSol = trailing.length
    ? trailing.reduce((a, d) => a + (d.per_desk_sol || 0), 0) / trailing.length
    : null;
  const floorSol = latest?.nft_floor_sol || 0;
  const breakevenDays = trailingAvgSol && trailingAvgSol > 0 ? floorSol / trailingAvgSol : null;
  // 1D figures use the latest feed day (partial until that day closes).
  const breakeven1dDays = todayPerDeskSol && todayPerDeskSol > 0 ? floorSol / todayPerDeskSol : null;
  // APR = daily per-desk earning annualized against the desk's floor cost.
  const apr1dPct = todayPerDeskSol && floorSol > 0 ? (todayPerDeskSol / floorSol) * 365 * 100 : null;
  const aprAvgPct = trailingAvgSol && floorSol > 0 ? (trailingAvgSol / floorSol) * 365 * 100 : null;

  // Daily floor from snapshot history (last floor recorded per day) so the
  // trend uses each day's ACTUAL floor, not today's.
  const floorByDay = {};
  for (const h of history || []) {
    if (h?.nft_floor_sol != null && h?.t) {
      floorByDay[String(h.t).slice(0, 10)] = h.nft_floor_sol;
    }
  }
  // APR + breakeven per day (bootstrap single-desk days excluded, same as the
  // avg line) — runs up to the actual current day so the yield direction is
  // visible.
  const trend = data
    .filter((d) => d.desks > 1)
    .map((d) => {
      const floor = floorByDay[d.day] ?? floorSol;
      return {
        day: d.day.slice(5),
        apr: floor > 0 && d.pd > 0 ? (d.pd / floor) * 365 * 100 : null,
        be: floor > 0 && d.pd > 0 ? floor / d.pd : null,
      };
    });

  return (
    <div className="border border-green-500/30 bg-black p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-green-500/70">
            EARNINGS :: {unit} / DAY
          </div>
          <div className="mt-1 text-[9px] text-green-500/40">
            bars = total into desks · line = avg / desk · bootstrap excluded from avg
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] font-mono">
            <span className="text-emerald-400/80">
              BREAKEVEN: 1D {breakeven1dDays != null ? `${breakeven1dDays.toFixed(1)}d` : "—"} · 7D_AVG {breakevenDays != null ? `${breakevenDays.toFixed(1)}d` : "—"} @ FLOOR {fmtSol(floorSol, 2)}
            </span>
            <span className="text-cyan-400/80">
              APR: 1D {apr1dPct != null ? `${apr1dPct.toFixed(0)}%` : "—"} · 7D_AVG {aprAvgPct != null ? `${aprAvgPct.toFixed(0)}%` : "—"}
            </span>
          </div>
          <div className="mt-1 text-[9px] text-green-500/40">
            APR = per-desk daily earning annualized vs NFT floor · 1D = latest feed day (partial until it closes) · today {fmtSol(todayPerDeskSol, 4)} vs 7d {fmtSol(trailingAvgSol, 4)}
          </div>
        </div>
        <div className="flex gap-1">
          {["USD", "SOL"].map((u) => (
            <button
              key={u}
              onClick={() => setUnit(u)}
              className={`border px-2 py-0.5 font-mono text-[10px] ${
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
          <ComposedChart data={data} margin={{ top: 4, right: 10, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="#0a3a1a" strokeDasharray="2 4" />
            <XAxis dataKey="day" stroke="#1a6b3a" fontSize={10} tick={{ fill: "#2a8b4a" }} />
            <YAxis yAxisId="sol" stroke="#1a6b3a" fontSize={10} tick={{ fill: "#2a8b4a" }} tickFormatter={(v) => `${v}`} width={50} />
            <YAxis yAxisId="avg" orientation="right" stroke="#1a6b3a" fontSize={10} tick={{ fill: "#2a8b4a" }} tickFormatter={(v) => `${v}`} width={40} />
            <Tooltip
              contentStyle={{ background: "#000", border: "1px solid #1a6b3a", borderRadius: 0, fontFamily: "monospace", fontSize: 11 }}
              labelStyle={{ color: "#22c55e" }}
              formatter={(v, n) => (n === "AVG_DESK" ? [v == null ? "bootstrap" : fmt(v), n] : [fmt(v), n])}
            />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace", color: "#2a8b4a" }} />
            <Bar yAxisId="sol" dataKey="total" name="TOTAL" fill="#0a3a1a" stroke="#1a6b3a" />
            <Line yAxisId="avg" type="monotone" dataKey="avg" name="AVG_DESK" stroke="#4ade80" dot={{ r: 2, fill: "#4ade80" }} strokeWidth={1.5} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* APR + breakeven trend — shows whether the yield is rising or fading */}
      <div className="mt-3 border-t border-green-500/20 pt-2">
        <div className="text-[10px] uppercase tracking-widest text-green-500/70">
          APR &amp; BREAKEVEN :: TREND (PER DESK / DAY)
        </div>
        <div className="mt-1 text-[9px] text-green-500/40">
          APR = daily per-desk earning annualized vs that day's NFT floor · BE = days to recoup
          the floor at that day's earning rate · bootstrap days excluded
        </div>
        <div className="mt-1 h-40 sm:h-48">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={trend} margin={{ top: 4, right: 10, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="#0a3a1a" strokeDasharray="2 4" />
              <XAxis dataKey="day" stroke="#1a6b3a" fontSize={10} tick={{ fill: "#2a8b4a" }} />
              <YAxis
                yAxisId="apr"
                stroke="#1a6b3a"
                fontSize={10}
                tick={{ fill: "#2a8b4a" }}
                tickFormatter={(v) => `${v}%`}
                width={50}
              />
              <YAxis
                yAxisId="be"
                orientation="right"
                stroke="#1a6b3a"
                fontSize={10}
                tick={{ fill: "#2a8b4a" }}
                tickFormatter={(v) => `${v}d`}
                width={40}
              />
              <Tooltip
                contentStyle={{ background: "#000", border: "1px solid #1a6b3a", borderRadius: 0, fontFamily: "monospace", fontSize: 11 }}
                labelStyle={{ color: "#22c55e" }}
                formatter={(v, n) =>
                  v == null ? ["—", n] : [n === "APR" ? `${v.toFixed(1)}%` : `${v.toFixed(1)} days`, n]
                }
              />
              <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace", color: "#2a8b4a" }} />
              <Line yAxisId="apr" type="monotone" dataKey="apr" name="APR" stroke="#22d3ee" dot={{ r: 2, fill: "#22d3ee" }} strokeWidth={1.5} connectNulls />
              <Line yAxisId="be" type="monotone" dataKey="be" name="BREAKEVEN" stroke="#fbbf24" dot={{ r: 2, fill: "#fbbf24" }} strokeWidth={1.5} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}