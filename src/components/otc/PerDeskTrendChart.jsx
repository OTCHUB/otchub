import React, { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { fmtSol, fmtUsd } from "@/lib/format";

export default function PerDeskTrendChart({ latest }) {
  const [unit, setUnit] = useState("USD");
  const raw = latest?.per_desk?.items || [];
  const solUsd = latest?.sol_price_usd || 0;
  const toUnit = (sol) => (unit === "USD" ? sol * solUsd : sol);
  const fmt = (v) => (unit === "USD" ? fmtUsd(v, 3) : fmtSol(v, 4));

  const data = raw
    .slice()
    .reverse()
    .map((d) => ({ day: String(d.day), v: toUnit(d.per_desk_sol || 0) }));

  const sorted = [...raw].sort((a, b) =>
    String(b.day || "").localeCompare(String(a.day || ""))
  );
  const trailing = sorted.slice(0, 7).filter((d) => (d.per_desk_sol || 0) > 0);
  const avgSol = trailing.length
    ? trailing.reduce((a, d) => a + (d.per_desk_sol || 0), 0) / trailing.length
    : null;
  const avgVal = avgSol != null ? toUnit(avgSol) : null;

  return (
    <div className="border border-green-500/30 bg-black p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-green-500/70">
            PER_DESK_EARN :: {unit}/DAY
          </div>
          <div className="mt-1 text-[9px] text-green-500/40">
            daily earning per activated desk · dashed = 7d avg
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
      <div className="mt-3 h-48 sm:h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 10, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="#0a3a1a" strokeDasharray="2 4" />
            <XAxis dataKey="day" stroke="#1a6b3a" fontSize={10} tick={{ fill: "#2a8b4a" }} />
            <YAxis
              stroke="#1a6b3a"
              fontSize={10}
              tick={{ fill: "#2a8b4a" }}
              tickFormatter={(v) => (unit === "USD" ? `$${v}` : `${v}`)}
              width={50}
            />
            <Tooltip
              contentStyle={{ background: "#000", border: "1px solid #1a6b3a", borderRadius: 0, fontFamily: "monospace", fontSize: 11 }}
              labelStyle={{ color: "#22c55e" }}
              formatter={(v) => [fmt(v), "PER_DESK"]}
            />
            {avgVal != null && (
              <ReferenceLine
                y={avgVal}
                stroke="#fbbf24"
                strokeDasharray="4 3"
                label={{ value: `7d ${fmt(avgVal)}`, fill: "#fbbf24", fontSize: 9, position: "insideTopRight" }}
              />
            )}
            <Line type="monotone" dataKey="v" name="PER_DESK" stroke="#4ade80" dot={{ r: 2, fill: "#4ade80" }} strokeWidth={1.5} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}