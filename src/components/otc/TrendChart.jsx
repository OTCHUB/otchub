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
  const data = (history || []).map((h) => {
    const token = h.token_price_usd;
    const floor = h.nft_floor_usd;
    return {
      t: new Date(h.t).getTime(),
      token,
      floor,
      diff: token != null && floor != null ? floor - token : null,
    };
  });

  return (
    <div className="border border-green-500/30 bg-black p-3">
      <div className="text-[10px] uppercase tracking-widest text-green-500/70">
        PRICE_TRENDS :: USD
      </div>
      <div className="mt-3 h-52 sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#0a3a1a" strokeDasharray="2 4" />
            <XAxis
              dataKey="t"
              tickFormatter={(t) => new Date(t).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}
              stroke="#1a6b3a"
              fontSize={10}
              tick={{ fill: "#2a8b4a" }}
            />
            <YAxis
              yAxisId="usd"
              stroke="#1a6b3a"
              fontSize={10}
              tick={{ fill: "#2a8b4a" }}
              tickFormatter={(v) => `$${+v.toFixed(2)}`}
              width={56}
            />
            {/* The token trades at ~1/100th of the NFT floor: on a shared
                scale its line is flat against the baseline. Give it its own
                auto-scaled right axis so both series stay readable. */}
            <YAxis
              yAxisId="token"
              orientation="right"
              domain={["auto", "auto"]}
              stroke="#22d3ee"
              fontSize={10}
              tick={{ fill: "#22d3ee" }}
              tickFormatter={(v) => `$${+v.toFixed(4)}`}
              width={52}
            />
            <Tooltip
              labelFormatter={(t) => new Date(t).toLocaleString()}
              formatter={(v) => fmtUsd(v)}
              contentStyle={{ background: "#000", border: "1px solid #1a6b3a", borderRadius: 0, color: "#4ade80", fontFamily: "monospace", fontSize: 11 }}
              labelStyle={{ color: "#22c55e" }}
              itemStyle={{ color: "#4ade80" }}
            />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace", color: "#2a8b4a" }} />
            <Line yAxisId="token" type="monotone" dataKey="token" name="OTC_USD" stroke="#4ade80" dot={false} strokeWidth={1.5} />
            <Line yAxisId="usd" type="monotone" dataKey="floor" name="FLOOR_USD" stroke="#fbbf24" dot={false} strokeWidth={1.5} />
            <Line yAxisId="usd" type="monotone" dataKey="diff" name="DIFF_USD" stroke="#22d3ee" dot={false} strokeWidth={1.5} strokeDasharray="4 3" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}