import React from "react";
import { fmtSol } from "@/lib/format";

// Launcher creator-fee split, per otcdesks.cash/docs: every coin launched from
// the launcher assigns its pump.fun creator fees to the protocol permanently
// at launch (pump.fun gives up its own ability to change the split). Every
// minute the protocol claims what the coin earned and splits it inside the
// SAME transaction — nothing is ever parked waiting to be divided. Verified
// on-chain 2026-09-09: pot inflows land at ~1/min in txs bundling the
// pump.fun claim, the pump-AMM stock buy and the 4-way split.
const SHARES = [
  { pct: "70%", to: "HOLDERS", tone: "text-emerald-300", note: "BUYS THE COIN'S CHOSEN STOCK · SENT PRO-RATA TO HOLDERS · NOTHING TO CLAIM" },
  { pct: "10%", to: "DESK_POT", tone: "text-cyan-300", note: "BUYS STOCK FOR DESKS · LANDS IN THE POT EVERY MIN" },
  { pct: "15%", to: "PROTOCOL", tone: "text-green-300", note: "PROTOCOL SHARE" },
  { pct: "5%", to: "OTC_BUYBACK", tone: "text-amber-300", note: "COLLECTS IN A WALLET · BOUGHT BACK BY HAND, NO SCHEDULE" },
];

export default function PotLauncherSplit({ launchpadSol = 0 }) {
  return (
    <div className="border border-emerald-500/30 bg-emerald-500/5 px-2 py-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 font-mono text-[11px]">
        <span className="font-bold uppercase tracking-widest text-emerald-400">
          LAUNCHER_CREATOR_FEES :: CLAIMED EVERY MIN · SPLIT IN SAME TX
        </span>
        <span className="shrink-0 text-emerald-300">
          POT_SHARE TODAY +{fmtSol(launchpadSol, 2)} SOL
        </span>
      </div>
      <div className="mt-1 space-y-0.5">
        {SHARES.map((s) => (
          <div key={s.pct} className="flex min-w-0 flex-wrap items-center gap-x-2 font-mono text-[11px]">
            <span className={`w-8 shrink-0 font-bold ${s.tone}`}>{s.pct}</span>
            <span className={`w-24 shrink-0 font-bold ${s.tone}`}>{s.to}</span>
            <span className="min-w-0 flex-1 uppercase text-green-500/60">{s.note}</span>
          </div>
        ))}
      </div>
      <div className="mt-1 font-mono text-[10px] leading-snug text-green-500/50">
        Fee assignment is set at launch and permanent — nobody, including the protocol, can redirect it
        later. Holder payouts are pro-rata at the moment of paying; shares worth less than the
        ~0.002 SOL account-open cost roll over to the next round. Verified on-chain: per-minute claim
        txs bundle the pump.fun claim, the stock buy and the 4-way split.
      </div>
    </div>
  );
}