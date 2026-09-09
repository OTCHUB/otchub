import React from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { fmtSol } from "@/lib/format";
import { useChartTheme, tipStyle, labelStyle } from "@/lib/chartTheme";

export default function ByStockChart({ latest }) {
  const T = useChartTheme();
  const raw = (latest?.by_stock?.items || [])
    .filter((s) => (s.distributed_sol || 0) > 0)
    .sort((a, b) => (b.distributed_sol || 0) - (a.distributed_sol || 0))
    .slice(0, 12);
  const data = raw.map((s) => ({ symbol: s.symbol, dist: s.distributed_sol }));

  return (
    <div className="flex h-full flex-col border border-green-500/30 bg-black p-3">
      <div className="shrink-0 text-[12px] uppercase tracking-widest text-green-500/70">
        BY_STOCK :: DESK DISTRIBUTIONS (SOL)
      </div>
      <div className="mt-1 shrink-0 text-[11px] text-green-500/40">
        13-stock desk rotation only · launchpad (launcher) payouts excluded · top 12
      </div>
      <div className="mt-3 h-72 shrink-0 lg:h-auto lg:min-h-0 lg:flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart layout="vertical" data={data} margin={{ top: 4, right: 16, bottom: 0, left: 10 }}>
            <CartesianGrid stroke={T.grid} strokeDasharray="2 4" />
            <XAxis type="number" stroke={T.axis} fontSize={12} tick={{ fill: T.tick }} tickFormatter={(v) => `${v}`} />
            <YAxis type="category" dataKey="symbol" stroke={T.axis} fontSize={12} tick={{ fill: T.tick }} width={72} />
            <Tooltip
              contentStyle={tipStyle(T)}
              labelStyle={labelStyle(T)}
              formatter={(v) => [fmtSol(v, 3), "DIST_SOL"]}
            />
            <Bar dataKey="dist" name="DIST_SOL" fill={T.barFill} stroke={T.barEdge} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}