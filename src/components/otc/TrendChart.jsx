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
} from "recharts";
import { fmtUsd } from "@/lib/format";

export default function TrendChart({ history }) {
  const data = (history || []).map((h) => ({
    t: new Date(h.t).getTime(),
    token: h.token_price_usd,
    floor: h.nft_floor_usd,
  }));

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <h3 className="text-sm font-semibold text-slate-200">Price Trends</h3>
      <div className="mt-4 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
            <XAxis
              dataKey="t"
              tickFormatter={(t) => new Date(t).toLocaleDateString()}
              stroke="#64748b"
              fontSize={11}
            />
            <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => `$${v}`} />
            <Tooltip
              labelFormatter={(t) => new Date(t).toLocaleString()}
              formatter={(v) => fmtUsd(v)}
              contentStyle={{ background: "#0f172a", border: "#1e293b", borderRadius: 8 }}
            />
            <Legend />
            <Line type="monotone" dataKey="token" name="OTC (USD)" stroke="#34d399" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="floor" name="NFT Floor (USD)" stroke="#a78bfa" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}