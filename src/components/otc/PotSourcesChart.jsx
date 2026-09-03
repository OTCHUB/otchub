import React from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { fmtSol } from "@/lib/format";

// Stacked daily bars of the desk pot's on-chain SOL inflow by revenue source:
// desk mint surcharge (90% of the 0.5 SOL per-mint surcharge), launchpad fees
// (~10% of launcher creator fees funnel to the pot), and unattributed
// ($OTC trading-tax sweeps and misc — no per-swap pot deposit pattern exists).
const SEGMENTS = [
  { key: "mint", name: "MINT", fill: "#166534" },
  { key: "royalty", name: "ME_ROYALTY", fill: "#0e7490" },
  { key: "launchpad", name: "LAUNCHPAD", fill: "#22c55e" },
  { key: "other", name: "UNATTRIB", fill: "#b45309" },
];

export default function PotSourcesChart({ latest }) {
  const ps = latest?.pot_sources;
  const days = ps?.days || {};
  const rows = Object.entries(days)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14)
    .map(([day, d]) => ({
      day: day.slice(5),
      mint: +(d.mint || 0).toFixed(4),
      royalty: +(d.royalty || 0).toFixed(4),
      launchpad: +(d.launchpad || 0).toFixed(4),
      other: +(d.other || 0).toFixed(4),
    }));
  const totals = SEGMENTS.map((s) => ({
    ...s,
    sol: rows.reduce((a, r) => a + (r[s.key] || 0), 0),
  }));
  const grandTotal = totals.reduce((a, t) => a + t.sol, 0);

  return (
    <div className="border border-green-500/30 bg-black p-3">
      <div className="text-[10px] uppercase tracking-widest text-green-500/70">
        POT_REVENUE :: BY SOURCE (SOL/DAY · STACKED)
      </div>
      <div className="mt-1 text-[9px] leading-snug text-green-500/40">
        desk pot SOL inflow, measured on-chain · MINT surcharge (90% of 0.5 SOL/mint) · ME_ROYALTY (5%
        creator fee on desk sales → pot) · LAUNCHPAD fees (10% of launcher fees → pot) · UNATTRIB
        ($OTC tax sweeps &amp; misc)
        {ps?.since ? ` · tracking since ${ps.since}` : ""}
      </div>
      {rows.length === 0 ? (
        <div className="py-6 text-center text-[11px] text-green-500/40">
          NO_DATA — source tracking begins with the next snapshot ingest
        </div>
      ) : (
        <>
          <div className="mt-2 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#0a3a1a" strokeDasharray="2 4" />
                <XAxis dataKey="day" stroke="#1a6b3a" fontSize={10} tick={{ fill: "#2a8b4a" }} />
                <YAxis
                  stroke="#1a6b3a"
                  fontSize={10}
                  tick={{ fill: "#2a8b4a" }}
                  tickFormatter={(v) => `${v}`}
                  width={44}
                />
                <Tooltip
                  contentStyle={{
                    background: "#000",
                    border: "1px solid #1a6b3a",
                    borderRadius: 0,
                    fontFamily: "monospace",
                    fontSize: 11,
                  }}
                  labelStyle={{ color: "#22c55e" }}
                  formatter={(v, name) => [fmtSol(v, 3), name]}
                />
                <Legend
                  wrapperStyle={{ fontFamily: "monospace", fontSize: 10, color: "#2a8b4a" }}
                />
                {SEGMENTS.map((s) => (
                  <Bar key={s.key} dataKey={s.key} name={s.name} stackId="pot" fill={s.fill} stroke="#1a6b3a" />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[9px] text-green-500/60">
            {totals.map((t) => (
              <span key={t.key}>
                <span style={{ color: t.fill }} className="font-bold">
                  {t.name}
                </span>{" "}
                {fmtSol(t.sol, 3)}
                {grandTotal > 0 && (
                  <span className="text-green-500/40"> ({((t.sol / grandTotal) * 100).toFixed(0)}%)</span>
                )}
              </span>
            ))}
            <span className="text-emerald-400/80">TOTAL {fmtSol(grandTotal, 3)} · last {rows.length}d</span>
          </div>
        </>
      )}
    </div>
  );
}