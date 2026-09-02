import React from "react";
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
import { fmtSol, fmtNum } from "@/lib/format";

export default function EarningsChart({ latest }) {
  const raw = latest?.per_desk?.items || [];
  const data = raw
    .slice()
    .reverse()
    .map((d) => {
      const desks = d.desks || 0;
      return {
        day: String(d.day),
        total: d.total_earned_sol ?? (d.per_desk_sol || 0) * desks,
        // Exclude the 1-desk bootstrap day from the avg line so its outlier
        // (one desk earning the whole daily distribution) doesn't dwarf the
        // post-launch per-desk trend. It still appears in the total bars.
        avg: desks > 1 ? d.per_desk_sol : null,
        desks,
      };
    });

  return (
    <div className="border border-green-500/30 bg-black p-3">
      <div className="text-[10px] uppercase tracking-widest text-green-500/70">
        EARNINGS :: SOL / DAY
      </div>
      <div className="mt-1 text-[9px] text-green-500/40">
        bars = total SOL into desks (left) · line = avg / desk (right) · bootstrap day excluded from avg
      </div>
      <div className="mt-3 h-52 sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 10, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="#0a3a1a" strokeDasharray="2 4" />
            <XAxis dataKey="day" stroke="#1a6b3a" fontSize={10} tick={{ fill: "#2a8b4a" }} />
            <YAxis
              yAxisId="sol"
              stroke="#1a6b3a"
              fontSize={10}
              tick={{ fill: "#2a8b4a" }}
              tickFormatter={(v) => `${v}`}
              width={50}
            />
            <YAxis
              yAxisId="avg"
              orientation="right"
              stroke="#1a6b3a"
              fontSize={10}
              tick={{ fill: "#2a8b4a" }}
              tickFormatter={(v) => `${v}`}
              width={40}
            />
            <Tooltip
              contentStyle={{ background: "#000", border: "1px solid #1a6b3a", borderRadius: 0, fontFamily: "monospace", fontSize: 11 }}
              labelStyle={{ color: "#22c55e" }}
              formatter={(v, n) =>
                n === "AVG_DESK_SOL"
                  ? [v == null ? "bootstrap" : fmtSol(v, 4), n]
                  : [fmtSol(v, 3), n]
              }
            />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace", color: "#2a8b4a" }} />
            <Bar yAxisId="sol" dataKey="total" name="TOTAL_SOL" fill="#0a3a1a" stroke="#1a6b3a" />
            <Line
              yAxisId="avg"
              type="monotone"
              dataKey="avg"
              name="AVG_DESK_SOL"
              stroke="#4ade80"
              dot={{ r: 2, fill: "#4ade80" }}
              strokeWidth={1.5}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}