import React from "react";
import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
  Legend,
} from "recharts";
import { fmtNum, fmtCompact } from "@/lib/format";

const DESK_CAP = 5000;

export default function SupplyChart({ history }) {
  const data = (history || []).map((h) => ({
    label: h.t ? new Date(h.t).toLocaleDateString() : "",
    supply: h.token_total_supply ?? null,
    desks: h.desks_minted ?? null,
  }));

  return (
    <div className="border border-green-500/30 bg-black p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-green-500/70">
            SUPPLY vs DESKS MINTED
          </div>
          <div className="mt-1 text-[9px] text-green-500/40">
            OTC circulating supply (↓ left) · desks minted (↑ right, 5,000 cap) · on-chain anchored
          </div>
        </div>
      </div>
      <div className="mt-3 h-56 sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: -4 }}>
            <defs>
              <linearGradient id="supplyGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.55} />
                <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="desksGrad" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="#4ade80" stopOpacity={0.05} />
                <stop offset="100%" stopColor="#4ade80" stopOpacity={0.55} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#0a3a1a" strokeDasharray="2 4" />
            <XAxis dataKey="label" stroke="#1a6b3a" fontSize={9} tick={{ fill: "#2a8b4a" }} minTickGap={24} />
            <YAxis
              yAxisId="supply"
              orientation="left"
              domain={[0, 1_000_000_000]}
              allowDataOverflow
              stroke="#1a6b3a"
              fontSize={9}
              tick={{ fill: "#2a8b4a" }}
              tickFormatter={(v) => fmtCompact(v)}
              width={48}
            />
            <YAxis
              yAxisId="desks"
              orientation="right"
              domain={[0, DESK_CAP]}
              stroke="#1a6b3a"
              fontSize={9}
              tick={{ fill: "#2a8b4a" }}
              tickFormatter={(v) => `${v}`}
              width={36}
            />
            <Tooltip
              contentStyle={{ background: "#000", border: "1px solid #1a6b3a", borderRadius: 0, fontFamily: "monospace", fontSize: 11 }}
              labelStyle={{ color: "#22c55e" }}
              formatter={(v, n) =>
                [n === "OTC_SUPPLY" ? `${fmtNum(v)} OTC` : n === "DESKS_MINTED" ? `${fmtNum(v)} desks` : v, n]
              }
            />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace", color: "#2a8b4a" }} />
            <ReferenceLine
              yAxisId="desks"
              y={DESK_CAP}
              stroke="#fbbf24"
              strokeDasharray="4 3"
              label={{ value: `CAP ${DESK_CAP}`, fill: "#fbbf24", fontSize: 9, position: "insideTopRight" }}
            />
            <Area yAxisId="supply" type="monotone" dataKey="supply" name="OTC_SUPPLY" stroke="#60a5fa" strokeWidth={2} fill="url(#supplyGrad)" connectNulls />
            <Area yAxisId="desks" type="monotone" dataKey="desks" name="DESKS_MINTED" stroke="#4ade80" strokeWidth={2} fill="url(#desksGrad)" connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}