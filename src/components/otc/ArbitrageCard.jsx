import React from "react";
import { ArrowRight } from "lucide-react";
import { fmtSol, fmtUsd, fmtPct } from "@/lib/format";

const REC = {
  buy_secondary: { label: "Buy Secondary", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  mint: { label: "Mint Now", cls: "bg-violet-500/15 text-violet-400 border-violet-500/30" },
  neutral: { label: "Neutral", cls: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
};

export default function ArbitrageCard({ latest }) {
  const rec = REC[latest?.recommendation] || REC.neutral;
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">Mint vs. Secondary</h3>
        <span className={`rounded-full border px-3 py-1 text-xs font-medium ${rec.cls}`}>{rec.label}</span>
      </div>
      <div className="mt-4 grid grid-cols-3 items-center gap-3">
        <div className="text-center">
          <div className="text-xs text-slate-500">Mint Cost</div>
          <div className="mt-1 text-lg font-semibold text-slate-100">{fmtSol(latest?.mint_cost_sol)}</div>
          <div className="text-xs text-slate-500">{fmtUsd(latest?.mint_cost_usd)}</div>
        </div>
        <div className="flex justify-center"><ArrowRight className="h-5 w-5 text-slate-600" /></div>
        <div className="text-center">
          <div className="text-xs text-slate-500">Secondary Floor</div>
          <div className="mt-1 text-lg font-semibold text-slate-100">{fmtSol(latest?.secondary_cost_sol)}</div>
          <div className="text-xs text-slate-500">{fmtUsd(latest?.secondary_cost_usd)}</div>
        </div>
      </div>
      <div className="mt-4 flex justify-between border-t border-slate-800 pt-3 text-sm">
        <span className="text-slate-400">Spread (mint − secondary)</span>
        <span className="font-medium text-slate-100">
          {fmtUsd(latest?.spread_usd)} · {fmtPct(latest?.spread_pct)}
        </span>
      </div>
    </div>
  );
}