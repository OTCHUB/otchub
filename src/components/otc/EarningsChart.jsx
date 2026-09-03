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

function Metric({ label, value, sub, accent = "text-green-300" }) {
  return (
    <div className="border border-green-500/20 px-2 py-1.5">
      <div className="text-[8px] uppercase tracking-widest text-green-500/50">{label}</div>
      <div className={`mt-0.5 font-mono text-base font-bold leading-none ${accent}`}>{value}</div>
      {sub && <div className="mt-0.5 font-mono text-[8px] text-green-500/50">{sub}</div>}
    </div>
  );
}

export default function EarningsChart({ latest, history }) {
  const [unit, setUnit] = useState("USD");
  const raw = latest?.per_desk?.items || [];
  const solUsd = latest?.sol_price_usd || 0;
  const toUnit = (sol) => (unit === "USD" ? sol * solUsd : sol);
  const fmt = (v) => (unit === "USD" ? fmtUsd(v, 2) : fmtSol(v, 3));

  // Chronological left→right (oldest at left, newest at right): the feed
  // arrives oldest-first, so sort ascending explicitly — reversing it made
  // the chart read backwards in time.
  // The feed's newest UTC day may still be RUNNING (partial). Closed days
  // drive the trend, the trailing average and the headline APR/breakeven,
  // so a half-finished day can't drag the yield picture down.
  const todayKey = new Date().toISOString().slice(0, 10);

  const data = raw
    .slice()
    .sort((a, b) => String(a.day).localeCompare(String(b.day)))
    .map((d) => {
      const desks = d.desks || 0;
      const totalSol = d.total_earned_sol ?? (d.per_desk_sol || 0) * desks;
      const isClosedDay = String(d.day) !== todayKey;
      return {
        day: String(d.day),
        total: toUnit(totalSol),
        avg: desks > 1 && isClosedDay ? toUnit(d.per_desk_sol) : null,
        desks,
        pd: d.per_desk_sol || 0,
      };
    });

  const sortedRaw = [...raw].sort((a, b) => String(b.day || "").localeCompare(String(a.day || "")));
  const latestIsRunning = String(sortedRaw[0]?.day || "") === todayKey;
  const todayPerDeskSol = sortedRaw[0]?.per_desk_sol;
  const closedDays = latestIsRunning ? sortedRaw.slice(1) : sortedRaw;
  const window = 7;
  const trailing = closedDays.slice(0, window).filter((d) => (d.per_desk_sol || 0) > 0);
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
    .filter((d) => d.desks > 1 && d.day !== todayKey)
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
            bars = total into desks (today's bar still growing) · line = avg / desk · closed days only
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            <Metric
              label="APR :: 7D_AVG"
              value={aprAvgPct != null ? `${aprAvgPct.toFixed(0)}%` : "—"}
              sub="closed days only"
              accent="text-cyan-400"
            />
            <Metric
              label="BREAKEVEN :: 7D_AVG"
              value={breakevenDays != null ? `${breakevenDays.toFixed(1)}d` : "—"}
              sub={`@ FLOOR ${fmtSol(floorSol, 2)}`}
              accent="text-amber-400"
            />
            <Metric
              label={latestIsRunning ? "APR :: 1D RUNNING" : "APR :: 1D"}
              value={apr1dPct != null ? `${apr1dPct.toFixed(0)}%` : "—"}
              sub={`today so far ${fmtSol(todayPerDeskSol, 4)}`}
              accent="text-emerald-400"
            />
            <Metric
              label={latestIsRunning ? "BREAKEVEN :: 1D RUNNING" : "BREAKEVEN :: 1D"}
              value={breakeven1dDays != null ? `${breakeven1dDays.toFixed(1)}d` : "—"}
              sub={latestIsRunning ? "partial until UTC close" : "last closed day"}
              accent="text-emerald-400"
            />
          </div>
          <div className="mt-1 text-[9px] text-green-500/40">
            APR = per-desk daily earning annualized vs NFT floor · 7D averages and the trend use
            CLOSED days only — today's running day is excluded · today {fmtSol(todayPerDeskSol, 4)} vs
            7d {fmtSol(trailingAvgSol, 4)}
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
          <ComposedChart data={data} margin={{ top: 4, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#0a3a1a" strokeDasharray="2 4" />
            <XAxis dataKey="day" stroke="#1a6b3a" fontSize={10} tick={{ fill: "#2a8b4a" }} />
            <YAxis yAxisId="sol" stroke="#1a6b3a" fontSize={10} tick={{ fill: "#2a8b4a" }} tickFormatter={(v) => `${+v.toFixed(1)}`} width={56} />
            <YAxis yAxisId="avg" orientation="right" stroke="#1a6b3a" fontSize={10} tick={{ fill: "#2a8b4a" }} tickFormatter={(v) => `${+v.toFixed(3)}`} width={48} />
            <Tooltip
              contentStyle={{ background: "#000", border: "1px solid #1a6b3a", borderRadius: 0, fontFamily: "monospace", fontSize: 11 }}
              labelStyle={{ color: "#22c55e" }}
              formatter={(v, n) => (n === "AVG_DESK" ? [v == null ? "— excluded (running)" : fmt(v), n] : [fmt(v), n])}
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
          the floor at that day's earning rate · closed days only (bootstrap + today's running day
          excluded)
        </div>
        <div className="mt-1 h-40 sm:h-48">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={trend} margin={{ top: 4, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#0a3a1a" strokeDasharray="2 4" />
              <XAxis dataKey="day" stroke="#1a6b3a" fontSize={10} tick={{ fill: "#2a8b4a" }} />
              <YAxis
                yAxisId="apr"
                stroke="#1a6b3a"
                fontSize={10}
                tick={{ fill: "#2a8b4a" }}
                tickFormatter={(v) => `${+v.toFixed(0)}%`}
                width={56}
              />
              <YAxis
                yAxisId="be"
                orientation="right"
                stroke="#1a6b3a"
                fontSize={10}
                tick={{ fill: "#2a8b4a" }}
                tickFormatter={(v) => `${+v.toFixed(0)}d`}
                width={48}
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