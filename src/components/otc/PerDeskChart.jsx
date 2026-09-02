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

export default function PerDeskChart({ latest }) {
  // per_desk items are oldest→newest; keep order, reverse for display newest last
  const raw = latest?.per_desk?.items || [];
  const data = raw
    .slice()
    .reverse()
    .map((d) => ({
      day: String(d.day),
      per_desk: d.per_desk_sol,
      desks: d.desks,
    }));

  return (
    <div className="border border-green-500/30 bg-black p-3">
      <div className="text-[10px] uppercase tracking-widest text-green-500/70">
        EARNINGS :: PER_DESK / DAY
      </div>
      <div className="mt-1 text-[9px] text-green-500/40">
        SOL distributed to each desk, per day · bars = active desks
      </div>
      <div className="mt-3 h-52 sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
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
              yAxisId="desks"
              orientation="right"
              stroke="#1a6b3a"
              fontSize={10}
              tick={{ fill: "#2a8b4a" }}
              width={36}
            />
            <Tooltip
              contentStyle={{ background: "#000", border: "1px solid #1a6b3a", borderRadius: 0, fontFamily: "monospace", fontSize: 11 }}
              labelStyle={{ color: "#22c55e" }}
              formatter={(v, name) =>
                name === "PER_DESK_SOL" ? [fmtSol(v, 4), name] : [fmtNum(v), name]
              }
            />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace", color: "#2a8b4a" }} />
            <Bar yAxisId="desks" dataKey="desks" name="DESKS" fill="#0a3a1a" stroke="#1a6b3a" />
            <Line yAxisId="sol" type="monotone" dataKey="per_desk" name="PER_DESK_SOL" stroke="#4ade80" dot={{ r: 2, fill: "#4ade80" }} strokeWidth={1.5} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}