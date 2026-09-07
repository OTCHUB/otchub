import React from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { fmtSol } from "@/lib/format";

export default function ByStockChart({ latest }) {
  const raw = (latest?.by_stock?.items || [])
    .filter((s) => (s.distributed_sol || 0) > 0)
    .sort((a, b) => (b.distributed_sol || 0) - (a.distributed_sol || 0))
    .slice(0, 12);
  const data = raw.map((s) => ({ symbol: s.symbol, dist: s.distributed_sol }));

  return (
    <div className="border border-green-500/30 bg-black p-3">
      <div className="text-[12px] uppercase tracking-widest text-green-500/70">
        BY_STOCK :: DESK DISTRIBUTIONS (SOL)
      </div>
      <div className="mt-1 text-[11px] text-green-500/40">
        13-stock desk rotation only · launchpad (launcher) payouts excluded · top 12
      </div>
      <div className="mt-3 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart layout="vertical" data={data} margin={{ top: 4, right: 16, bottom: 0, left: 10 }}>
            <CartesianGrid stroke="#0a3a1a" strokeDasharray="2 4" />
            <XAxis type="number" stroke="#1a6b3a" fontSize={12} tick={{ fill: "#2a8b4a" }} tickFormatter={(v) => `${v}`} />
            <YAxis type="category" dataKey="symbol" stroke="#1a6b3a" fontSize={12} tick={{ fill: "#2a8b4a" }} width={72} />
            <Tooltip
              contentStyle={{ background: "#000", border: "1px solid #1a6b3a", borderRadius: 0, fontFamily: "monospace", fontSize: 13 }}
              labelStyle={{ color: "#22c55e" }}
              formatter={(v) => [fmtSol(v, 3), "DIST_SOL"]}
            />
            <Bar dataKey="dist" name="DIST_SOL" fill="#0a3a1a" stroke="#1a6b3a" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}