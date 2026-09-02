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

export default function EarningsChart({ latest }) {
  const [unit, setUnit] = useState("USD");
  const raw = latest?.per_desk?.items || [];
  const solUsd = latest?.sol_price_usd || 0;
  const toUnit = (sol) => (unit === "USD" ? sol * solUsd : sol);
  const fmt = (v) => (unit === "USD" ? fmtUsd(v, 2) : fmtSol(v, 3));

  const data = raw
    .slice()
    .reverse()
    .map((d) => {
      const desks = d.desks || 0;
      const totalSol = d.total_earned_sol ?? (d.per_desk_sol || 0) * desks;
      return {
        day: String(d.day),
        total: toUnit(totalSol),
        avg: desks > 1 ? toUnit(d.per_desk_sol) : null,
      };
    });

  const latestDailySol = raw.length
    ? [...raw].sort((a, b) => String(b.day || "").localeCompare(String(a.day || "")))[0]?.per_desk_sol
    : null;
  const floorSol = latest?.nft_floor_sol || 0;
  const breakevenDays = latestDailySol && latestDailySol > 0 ? floorSol / latestDailySol : null;

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
          <div className="mt-1 text-[10px] text-emerald-400/80">
            BREAKEVEN: {breakevenDays != null ? `${breakevenDays.toFixed(1)} days` : "—"} @ floor {fmtSol(floorSol, 2)}
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
    </div>
  );
}