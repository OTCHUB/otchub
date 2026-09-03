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

const oppColor = (v) =>
  v == null ? "#1a6b3a" : v > 0 ? "#22c55e" : v < 0 ? "#fbbf24" : "#1a6b3a";

export default function ArbitrageChart({ history }) {
  const data = (history || []).map((h) => ({
    t: new Date(h.t).getTime(),
    mint: h.mint_cost_usd,
    secondary: h.secondary_cost_usd,
    spread: h.spread_usd,
  }));

  const axisFmt = (t) =>
    new Date(t).toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
  const tip = {
    contentStyle: { background: "#000", border: "1px solid #1a6b3a", borderRadius: 0, color: "#4ade80", fontFamily: "monospace", fontSize: 11 },
    labelStyle: { color: "#22c55e" },
    itemStyle: { color: "#4ade80" },
  };

  return (
    <div className="border border-green-500/30 bg-black p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-green-500/70">
          ARBITRAGE :: MINT vs SECONDARY (USD)
        </span>
        <span className="font-mono text-[9px] text-green-500/50">
          spread&gt;0 ⇒ secondary cheaper
        </span>
      </div>

      <div className="mt-3 h-44 sm:h-52">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#0a3a1a" strokeDasharray="2 4" />
            <XAxis dataKey="t" tickFormatter={axisFmt} stroke="#1a6b3a" fontSize={10} tick={{ fill: "#2a8b4a" }} />
            <YAxis stroke="#1a6b3a" fontSize={10} tick={{ fill: "#2a8b4a" }} tickFormatter={(v) => `$${+v.toFixed(2)}`} width={56} />
            <Tooltip labelFormatter={(t) => new Date(t).toLocaleString()} formatter={(v) => fmtUsd(v)} {...tip} />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace", color: "#2a8b4a" }} />
            <Line type="monotone" dataKey="mint" name="MINT_COST" stroke="#fbbf24" dot={false} strokeWidth={1.5} />
            <Line type="monotone" dataKey="secondary" name="SECONDARY_COST" stroke="#22d3ee" dot={false} strokeWidth={1.5} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 text-[9px] uppercase tracking-widest text-green-500/50">
        SPREAD (MINT − SECONDARY) :: OPPORTUNITY
      </div>
      <div className="mt-1 h-24">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#0a3a1a" strokeDasharray="2 4" />
            <XAxis dataKey="t" tickFormatter={axisFmt} stroke="#1a6b3a" fontSize={9} tick={{ fill: "#2a8b4a" }} />
            <YAxis stroke="#1a6b3a" fontSize={9} tick={{ fill: "#2a8b4a" }} tickFormatter={(v) => `$${+v.toFixed(2)}`} width={56} />
            <ReferenceLine y={0} stroke="#4ade80" />
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