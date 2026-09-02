import React from "react";
import {
  ComposedChart,
  Line,
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
            OTC circulating supply (left) · desks minted vs 5,000 cap (right) · burn: 1M OTC/desk early → 100k/desk now (on-chain anchored)
          </div>
        </div>
      </div>
      <div className="mt-3 h-52 sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 10, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="#0a3a1a" strokeDasharray="2 4" />
            <XAxis dataKey="label" stroke="#1a6b3a" fontSize={9} tick={{ fill: "#2a8b4a" }} minTickGap={24} />
            <YAxis
              yAxisId="supply"
              stroke="#1a6b3a"
              fontSize={9}
              tick={{ fill: "#2a8b4a" }}
              tickFormatter={(v) => fmtCompact(v)}
              width={46}
            />
            <YAxis
              yAxisId="desks"
              orientation="right"
              stroke="#1a6b3a"
              fontSize={9}
              tick={{ fill: "#2a8b4a" }}
              tickFormatter={(v) => `${v}`}
              width={36}
            />
            <Tooltip
              contentStyle={{ background: "#000", border: "1px solid #1a6b3a", borderRadius: 0, fontFamily: "monospace", fontSize: 11 }}
              labelStyle={{ color: "#22c55e" }}
              formatter={(v, n) => [fmtNum(v), n]}
            />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace", color: "#2a8b4a" }} />
            <ReferenceLine
              yAxisId="desks"
              y={DESK_CAP}
              stroke="#fbbf24"
              strokeDasharray="4 3"
              label={{ value: `CAP ${DESK_CAP}`, fill: "#fbbf24", fontSize: 9, position: "insideTopRight" }}
            />
            <Line yAxisId="supply" type="monotone" dataKey="supply" name="OTC_SUPPLY" stroke="#60a5fa" dot={false} strokeWidth={1.5} connectNulls />
            <Line yAxisId="desks" type="monotone" dataKey="desks" name="DESKS_MINTED" stroke="#4ade80" dot={false} strokeWidth={1.5} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}