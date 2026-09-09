import React from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  BarChart,
  Bar,
  Cell,
  ReferenceLine,
} from "recharts";
import { fmtUsd } from "@/lib/format";
import { useChartTheme, tipStyle, labelStyle, itemStyle, legendStyle } from "@/lib/chartTheme";

export default function ArbitrageChart({ history }) {
  const T = useChartTheme();
  const oppColor = (v) =>
    v == null ? T.axis : v > 0 ? T.pos : v < 0 ? T.secondary : T.axis;
  const data = (history || []).map((h) => ({
    t: new Date(h.t).getTime(),
    mint: h.mint_cost_usd,
    secondary: h.secondary_cost_usd,
    spread: h.spread_usd,
  }));

  const axisFmt = (t) =>
    new Date(t).toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
  const tip = {
    contentStyle: tipStyle(T),
    labelStyle: labelStyle(T),
    itemStyle: itemStyle(T),
  };

  return (
    <div className="flex h-full flex-col border border-green-500/30 bg-black p-3">
      <div className="flex shrink-0 items-center justify-between">
        <span className="text-[12px] uppercase tracking-widest text-green-500/70">
          ARBITRAGE :: MINT vs SECONDARY (USD)
        </span>
        <span className="font-mono text-[11px] text-green-500/50">
          spread&gt;0 ⇒ secondary cheaper
        </span>
      </div>

      {/* fills the card height on desktop so the panel matches EARNINGS;
          fixed heights below lg keep the mobile stacked layout compact */}
      <div className="mt-3 h-44 shrink-0 sm:h-52 lg:h-auto lg:min-h-0 lg:flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={T.grid} strokeDasharray="2 4" />
            <XAxis dataKey="t" tickFormatter={axisFmt} stroke={T.axis} fontSize={12} tick={{ fill: T.tick }} />
            <YAxis stroke={T.axis} fontSize={12} tick={{ fill: T.tick }} tickFormatter={(v) => `$${+v.toFixed(2)}`} width={56} />
            <Tooltip labelFormatter={(t) => new Date(t).toLocaleString()} formatter={(v) => fmtUsd(v)} {...tip} />
            <Legend wrapperStyle={legendStyle(T)} />
            <Line type="monotone" dataKey="mint" name="MINT_COST" stroke={T.secondary} dot={false} strokeWidth={1.5} />
            <Line type="monotone" dataKey="secondary" name="SECONDARY_COST" stroke={T.tertiary} dot={false} strokeWidth={1.5} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 shrink-0 text-[11px] uppercase tracking-widest text-green-500/50">
        SPREAD (MINT − SECONDARY) :: OPPORTUNITY
      </div>
      <div className="mt-1 h-24 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={T.grid} strokeDasharray="2 4" />
            <XAxis dataKey="t" tickFormatter={axisFmt} stroke={T.axis} fontSize={11} tick={{ fill: T.tick }} />
            <YAxis stroke={T.axis} fontSize={11} tick={{ fill: T.tick }} tickFormatter={(v) => `$${+v.toFixed(2)}`} width={56} />
            <ReferenceLine y={0} stroke={T.primary} />
            <Tooltip labelFormatter={(t) => new Date(t).toLocaleString()} formatter={(v) => fmtUsd(v)} {...tip} />
            <Bar dataKey="spread" name="SPREAD">
              {data.map((d, i) => (
                <Cell key={i} fill={oppColor(d.spread)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}