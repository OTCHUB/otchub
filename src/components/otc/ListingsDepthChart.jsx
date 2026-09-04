import React from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { fmtSol, fmtNum } from "@/lib/format";

// BLUR-style listing depth for the desk NFTs: cumulative count of listed desks
// at or below each SOL price — stepped area shows where the sell-side supply
// actually bunches above the floor. Styled in the OTC_HUB terminal palette.
export default function ListingsDepthChart({ holdings }) {
  const listed = (holdings || [])
    .filter((h) => h.is_listed && h.listing_price_sol != null)
    .sort((a, b) => a.listing_price_sol - b.listing_price_sol);

  let cum = 0;
  const data = listed.map((h) => {
    cum += 1;
    return { p: +(+h.listing_price_sol).toFixed(3), count: cum };
  });

  const floor = data.length ? data[0].p : null;
  const top = data.length ? data[data.length - 1].p : null;

  return (
    <div className="border border-green-500/30 bg-black p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-[10px] uppercase tracking-widest text-green-500/70">
          DEPTH :: CUMULATIVE LISTINGS (SOL)
        </span>
        <span className="font-mono text-[10px] text-green-500/50">
          {fmtNum(data.length)} LISTED · FLOOR {fmtSol(floor, 2)} · TOP {fmtSol(top, 2)}
        </span>
      </div>
      <div className="mt-1 text-[9px] text-green-500/40">
        desks listed at or below each price · steps bunch where the sell-side supply is dense
      </div>
      {data.length < 2 ? (
        <div className="py-6 text-center text-[11px] text-green-500/40">
          NO_DEPTH — appears once desks are listed for sale
        </div>
      ) : (
        <div className="mt-2 h-40 sm:h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="depthFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#0a3a1a" strokeDasharray="2 4" />
              <XAxis
                dataKey="p"
                type="number"
                domain={["dataMin", "dataMax"]}
                stroke="#1a6b3a"
                fontSize={10}
                tick={{ fill: "#2a8b4a" }}
                tickFormatter={(v) => (+v).toFixed(2)}
              />
              <YAxis
                stroke="#1a6b3a"
                fontSize={10}
                tick={{ fill: "#2a8b4a" }}
                allowDecimals={false}
                width={40}
              />
              <Tooltip
                contentStyle={{ background: "#000", border: "1px solid #1a6b3a", borderRadius: 0, fontFamily: "monospace", fontSize: 11 }}
                labelStyle={{ color: "#22c55e" }}
                labelFormatter={(v) => `≤ ${fmtSol(v, 3)}`}
                formatter={(v) => [`${fmtNum(v)} desks`, "DEPTH"]}
              />
              <Area
                type="stepAfter"
                dataKey="count"
                stroke="#22c55e"
                strokeWidth={1.5}
                fill="url(#depthFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}