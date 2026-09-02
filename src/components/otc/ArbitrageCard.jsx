import React from "react";
import { fmtSol, fmtUsd, fmtPct } from "@/lib/format";

const REC = {
  buy_secondary: { label: "BUY_SECONDARY", cls: "text-emerald-400 border-emerald-500/50" },
  mint: { label: "MINT_NOW", cls: "text-amber-400 border-amber-500/50" },
  neutral: { label: "NEUTRAL", cls: "text-green-500/70 border-green-500/30" },
};

function Field({ label, value, valueClass = "text-green-300" }) {
  return (
    <div className="border border-green-500/20 bg-black/40 p-2 text-center">
      <div className="text-[9px] uppercase tracking-widest text-green-500/50">{label}</div>
      <div className={`mt-1 font-mono text-sm font-bold sm:text-base ${valueClass}`}>{value}</div>
    </div>
  );
}

export default function ArbitrageCard({ latest }) {
  const rec = REC[latest?.recommendation] || REC.neutral;
  const spreadUsd = latest?.spread_usd;
  const positive = typeof spreadUsd === "number" && spreadUsd > 0.0001;
  const negative = typeof spreadUsd === "number" && spreadUsd < -0.0001;

  return (
    <div className="border border-green-500/30 bg-black p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-green-500/70">
          ARBITRAGE :: MINT vs SECONDARY
        </span>
        <span className={`border px-2 py-0.5 font-mono text-[10px] ${rec.cls}`}>
          {rec.label}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Field
          label="MINT_COST"
          value={fmtSol(latest?.mint_cost_sol)}
          valueClass="text-amber-400"
        />
        <Field
          label="SECONDARY_FLOOR"
          value={fmtSol(latest?.secondary_cost_sol)}
          valueClass="text-cyan-400"
        />
        <Field
          label="SPREAD_USD"
          value={fmtUsd(spreadUsd)}
          valueClass={positive ? "text-emerald-400" : negative ? "text-red-400" : "text-green-300"}
        />
      </div>

      <div className="mt-2 space-y-1 font-mono text-[11px] sm:text-xs">
        <div className="flex justify-between">
          <span className="text-green-500/50">&gt; MINT = 100,000 OTC burned + 0.5 SOL surcharge</span>
        </div>
        <div className="flex justify-between">
          <span className="text-green-500/50">&gt; SECONDARY = lowest Magic Eden listing</span>
          <span className="text-green-300">{fmtUsd(latest?.secondary_cost_usd)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-green-500/50">&gt; SPREAD_PCT</span>
          <span className={positive ? "text-emerald-400" : negative ? "text-red-400" : "text-green-300"}>
            {fmtPct(latest?.spread_pct)}
          </span>
        </div>
      </div>
    </div>
  );
}