import React from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { fmtNum } from "@/lib/format";

export default function RoundsChart({ latest }) {
  const raw = latest?.per_desk?.items || [];
  const data = raw
    .slice()
    .reverse()
    .map((d) => ({ day: String(d.day), rounds: d.rounds || 0, desks: d.desks || 0 }));

  return (
    <div className="border border-green-500/30 bg-black p-3">
      <div className="text-[10px] uppercase tracking-widest text-green-500/70">
        ROUND_VELOCITY :: ROUNDS / DAY
      </div>
      <div className="mt-1 text-[9px] text-green-500/40">
        distribution rounds executed per day · tooltip also shows desk count
      </div>
      <div className="mt-3 h-52 sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="#0a3a1a" strokeDasharray="2 4" />
            <XAxis dataKey="day" stroke="#1a6b3a" fontSize={10} tick={{ fill: "#2a8b4a" }} />
            <YAxis
              stroke="#1a6b3a"
              fontSize={10}
              tick={{ fill: "#2a8b4a" }}
              tickFormatter={(v) => `${v}`}
              width={50}
            />
            <Tooltip
              contentStyle={{ background: "#000", border: "1px solid #1a6b3a", borderRadius: 0, fontFamily: "monospace", fontSize: 11 }}
              labelStyle={{ color: "#22c55e" }}
              formatter={(v, n) => [fmtNum(v), n]}
            />
            <Bar dataKey="rounds" name="ROUNDS" fill="#0a3a1a" stroke="#1a6b3a" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}