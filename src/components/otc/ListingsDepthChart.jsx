import React, { useState } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { fmtSol, fmtNum } from "@/lib/format";

// BLUR-style listing depth for the desk NFTs: cumulative count of listed desks
// at or below each SOL price, plus the cumulative SOL needed to SWEEP the book
// up to that price (how much buy pressure lifts the floor to the next level).
// X-range toggle keeps the near-floor region readable when a long tail of
// expensive listings would otherwise flatten the interesting part.
export default function ListingsDepthChart({ holdings }) {
  const [range, setRange] = useState("NEAR");

  const listed = (holdings || [])
    .filter((h) => h.is_listed && h.listing_price_sol != null)
    .sort((a, b) => a.listing_price_sol - b.listing_price_sol);

  let cum = 0;
  let sol = 0;
  const full = listed.map((h) => {
    cum += 1;
    sol += +h.listing_price_sol;
    return { p: +(+h.listing_price_sol).toFixed(3), count: cum, sweep: +sol.toFixed(3) };
  });

  // NEAR view: only the listings covering the bottom 50% of the sell-side supply
  // (but at least the two cheapest, so the chart never collapses).
  const half = Math.max(2, Math.ceil((full.length * 0.5) / 1));
  const data = range === "NEAR" ? full.slice(0, half) : full;

  const floor = full.length ? full[0].p : null;
  const top = full.length ? full[full.length - 1].p : null;
  const totalSol = full.length ? full[full.length - 1].sweep : null;
  const halfSol = full.length ? full[half - 1]?.sweep : null;
  const shownTop = data.length ? data[data.length - 1].p : null;

  return (
    <div className="border border-green-500/30 bg-black p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-[10px] uppercase tracking-widest text-green-500/70">
          DEPTH :: LISTINGS &amp; SWEEP COST (SOL)
        </span>
        <span className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-green-500/50">
            {fmtNum(full.length)} LISTED · FLOOR {fmtSol(floor, 2)} · SWEEP_ALL {fmtSol(totalSol, 1)}
          </span>
          {full.length > 2 && (
            <span className="flex gap-1">
              {[
                { k: "NEAR", label: "[NEAR_50%]" },
                { k: "FULL", label: "[FULL]" },
              ].map((r) => (
                <button
                  key={r.k}
                  onClick={() => setRange(r.k)}
                  className={`border px-1.5 py-0.5 font-mono text-[9px] ${
                    range === r.k
                      ? "border-emerald-500/50 text-emerald-400"
                      : "border-green-500/30 text-green-500/60 hover:bg-green-500/10"
                  }`}
                  title={
                    r.k === "NEAR"
                      ? "Zoom to the cheapest listings covering the bottom 50% of supply"
                      : "Full listing range, floor to most expensive"
                  }
                >
                  {r.label}
                </button>
              ))}
            </span>
          )}
        </span>
      </div>
      <div className="mt-1 text-[9px] text-green-500/40">
        DEPTH = desks listed at or below each price · SWEEP = SOL needed to buy them all and lift
        the floor past that level{range === "NEAR" && shownTop != null ? ` · view ≤ ${fmtSol(shownTop, 2)} (${fmtSol(halfSol, 1)} sweeps 50% of supply)` : ""}
      </div>
      {data.length < 2 ? (
        <div className="py-6 text-center text-[11px] text-green-500/40">
          NO_DEPTH — appears once desks are listed for sale
        </div>
      ) : (
        <div className="mt-2 h-44 sm:h-52">
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
                yAxisId="count"
                stroke="#1a6b3a"
                fontSize={10}
                tick={{ fill: "#2a8b4a" }}
                allowDecimals={false}
                width={40}
              />
              <YAxis
                yAxisId="sweep"
                orientation="right"
                stroke="#1a6b3a"
                fontSize={10}
                tick={{ fill: "#b45309" }}
                tickFormatter={(v) => `${+v.toFixed(1)}`}
                width={44}
              />
              <Tooltip
                cursor={{ stroke: "#22c55e", strokeDasharray: "3 3" }}
                contentStyle={{ background: "#000", border: "1px solid #1a6b3a", borderRadius: 0, fontFamily: "monospace", fontSize: 11 }}
                labelStyle={{ color: "#22c55e" }}
                labelFormatter={(v) => `≤ ${fmtSol(v, 3)} SOL`}
                formatter={(v, n) =>
                  n === "SWEEP_SOL" ? [`${fmtSol(v, 2)} SOL to sweep`, n] : [`${fmtNum(v)} desks`, n]
                }
              />
              <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace", color: "#2a8b4a" }} />
              <Area
                yAxisId="count"
                type="stepAfter"
                dataKey="count"
                name="DEPTH"
                stroke="#22c55e"
                strokeWidth={1.5}
                fill="url(#depthFill)"
              />
              <Area
                yAxisId="sweep"
                type="stepAfter"
                dataKey="sweep"
                name="SWEEP_SOL"
                stroke="#fbbf24"
                strokeWidth={1.5}
                fill="#fbbf24"
                fillOpacity={0.08}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}