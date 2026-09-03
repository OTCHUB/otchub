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
import HelpNote from "@/components/otc/HelpNote";

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

  // The feed's newest UTC day may still be RUNNING (partial). Closed days
  // drive the trend lines, the trailing average and the headline
  // APR/breakeven, so a half-finished day can't drag the yield picture down.
  const todayKey = new Date().toISOString().slice(0, 10);
  const floorSol = latest?.nft_floor_sol || 0;

  // Daily floor from snapshot history (last floor recorded per day) so each
  // day's APR/breakeven uses that day's ACTUAL floor, not today's.
  const floorByDay = {};
  for (const h of history || []) {
    if (h?.nft_floor_sol != null && h?.t) {
      floorByDay[String(h.t).slice(0, 10)] = h.nft_floor_sol;
    }
  }

  const data = raw
    .slice()
    .sort((a, b) => String(a.day).localeCompare(String(b.day)))
    .map((d) => {
      const dayStr = String(d.day);
      const desks = d.desks || 0;
      const pd = d.per_desk_sol || 0;
      const totalSol = d.total_earned_sol ?? pd * desks;
      // Trend lines only on closed, non-bootstrap days; today's bar still
      // renders so live accrual stays visible.
      const eligible = dayStr !== todayKey && desks > 1;
      const floor = floorByDay[dayStr] ?? floorSol;
      return {
        day: dayStr.slice(5),
        total: toUnit(totalSol),
        avg: eligible ? toUnit(pd) : null,
        apr: eligible && floor > 0 && pd > 0 ? (pd / floor) * 365 * 100 : null,
        be: eligible && floor > 0 && pd > 0 ? floor / pd : null,
      };
    });

  // Closed-day trailing stats for the header metric cards.
  const sortedRaw = [...raw].sort((a, b) => String(b.day || "").localeCompare(String(a.day || "")));
  const latestIsRunning = String(sortedRaw[0]?.day || "") === todayKey;
  const todayPerDeskSol = sortedRaw[0]?.per_desk_sol;
  const closedDays = latestIsRunning ? sortedRaw.slice(1) : sortedRaw;
  const trailing = closedDays.slice(0, 7).filter((d) => (d.per_desk_sol || 0) > 0);
  const trailingAvgSol = trailing.length
    ? trailing.reduce((a, d) => a + (d.per_desk_sol || 0), 0) / trailing.length
    : null;
  const breakevenDays = trailingAvgSol && trailingAvgSol > 0 ? floorSol / trailingAvgSol : null;
  const breakeven1dDays = todayPerDeskSol && todayPerDeskSol > 0 ? floorSol / todayPerDeskSol : null;
  const apr1dPct = todayPerDeskSol && floorSol > 0 ? (todayPerDeskSol / floorSol) * 365 * 100 : null;
  const aprAvgPct = trailingAvgSol && floorSol > 0 ? (trailingAvgSol / floorSol) * 365 * 100 : null;

  return (
    <div className="border border-green-500/30 bg-black p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-green-500/70">
            EARNINGS :: {unit} / DAY
          </div>
          <div className="mt-1 text-[9px] text-green-500/40">
            bars = total into desks · lines = avg/desk · APR · breakeven
          </div>
        </div>
        <div className="inline-flex overflow-hidden border border-green-500/30">
          {["USD", "SOL"].map((u) => (
            <button
              key={u}
              onClick={() => setUnit(u)}
              className={`px-2 py-1 font-mono text-[10px] ${
                u === "SOL" ? "border-l border-green-500/30" : ""
              } ${
                unit === u
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "text-green-500/60 hover:text-green-400"
              }`}
            >
              [{u}]
            </button>
          ))}
        </div>
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

      <HelpNote label="[?] METHODOLOGY">
        Bars show TOTAL earnings pushed into desk vaults per day — today's bar is still growing.
        The AVG_DESK line (green) is that day's per-desk earning; APR_% (cyan) is that earning
        annualized vs that day's NFT floor; BREAKEVEN_D (amber) is days to recoup the floor at
        that day's rate. Lines use CLOSED days only: today's running day and the single-desk
        bootstrap days are excluded so the trend reflects finished days. The 1D RUNNING cards
        track today's partial day until it closes.
      </HelpNote>

      <div className="mt-2 h-52 sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#0a3a1a" strokeDasharray="2 4" />
            <XAxis dataKey="day" stroke="#1a6b3a" fontSize={10} tick={{ fill: "#2a8b4a" }} />
            <YAxis
              yAxisId="unit"
              stroke="#1a6b3a"
              fontSize={10}
              tick={{ fill: "#2a8b4a" }}
              tickFormatter={(v) => (unit === "USD" ? `$${+v.toFixed(1)}` : `${+v.toFixed(0)}`)}
              width={56}
            />
            <YAxis
              yAxisId="avg"
              orientation="right"
              stroke="#4ade80"
              fontSize={9}
              tick={{ fill: "#4ade80" }}
              tickFormatter={(v) => (unit === "USD" ? `$${+v.toFixed(2)}` : `${+v.toFixed(3)}`)}
              width={46}
            />
            <YAxis
              yAxisId="apr"
              orientation="right"
              stroke="#22d3ee"
              fontSize={9}
              tick={{ fill: "#22d3ee" }}
              tickFormatter={(v) => `${+v.toFixed(0)}%`}
              width={40}
            />
            <YAxis
              yAxisId="be"
              orientation="right"
              stroke="#fbbf24"
              fontSize={9}
              tick={{ fill: "#fbbf24" }}
              tickFormatter={(v) => `${+v.toFixed(0)}d`}
              width={40}
            />
            <Tooltip
              contentStyle={{ background: "#000", border: "1px solid #1a6b3a", borderRadius: 0, fontFamily: "monospace", fontSize: 11 }}
              labelStyle={{ color: "#22c55e" }}
              formatter={(v, n) => {
                if (v == null) return [n === "AVG_DESK" ? "— excluded (running)" : "—", n];
                if (n === "TOTAL") return [fmt(v), n];
                if (n === "APR_%") return [`${v.toFixed(1)}%`, n];
                if (n === "BREAKEVEN_D") return [`${v.toFixed(1)} days`, n];
                return [fmt(v), n];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace", color: "#2a8b4a" }} />
            <Bar yAxisId="unit" dataKey="total" name="TOTAL" fill="#0a3a1a" stroke="#1a6b3a" />
            <Line
              yAxisId="avg"
              type="monotone"
              dataKey="avg"
              name="AVG_DESK"
              stroke="#4ade80"
              dot={{ r: 2, fill: "#4ade80" }}
              strokeWidth={1.5}
              connectNulls
            />
            <Line
              yAxisId="apr"
              type="monotone"
              dataKey="apr"
              name="APR_%"
              stroke="#22d3ee"
              dot={false}
              strokeWidth={1.5}
              connectNulls
            />
            <Line
              yAxisId="be"
              type="monotone"
              dataKey="be"
              name="BREAKEVEN_D"
              stroke="#fbbf24"
              dot={false}
              strokeWidth={1.5}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}