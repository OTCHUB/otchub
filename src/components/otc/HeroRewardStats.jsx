import React from "react";
import { HandCoins, Rocket } from "lucide-react";
import { fmtSol, fmtUsd } from "@/lib/format";

// Hero lifetime reward totals, both derived from the live snapshot:
// - DESK NFT HOLDERS: the desk-only distribution channel — the sum of the
//   per-desk daily history (the otcdesks.cash "distributed" headline mixes
//   launchpad-holder payouts into its global total, so the desk figure is
//   taken from the validated desk-only history instead).
// - LAUNCH HOLDERS: the launchpad-holder payout share — the global
//   distributed total minus the desk channel above.
export default function HeroRewardStats({ latest }) {
  const perDesk = latest?.per_desk?.items || [];
  const deskSol = perDesk.reduce((a, d) => a + (d.total_earned_sol || 0), 0);
  const totalSol = latest?.protocol_distributed_sol ?? null;
  const launchSol = totalSol != null ? Math.max(0, totalSol - deskSol) : null;
  const solUsd = latest?.sol_price_usd ?? null;

  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-2">
      <div className="border border-emerald-500/30 bg-emerald-500/5 p-3">
        <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-emerald-400">
          <HandCoins className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Total rewards → OTC Desks NFT holders
        </div>
        <div className="mt-1.5 font-display text-xl font-bold leading-tight text-green-200">
          {fmtSol(deskSol)}
          {solUsd ? (
            <span className="ml-2 text-[11px] font-normal text-green-500/60">
              {fmtUsd(deskSol * solUsd)}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 text-[10px] leading-snug text-green-500/50">
          Lifetime SOL distributed through the desk channel
        </div>
      </div>
      <div className="border border-amber-400/30 bg-amber-400/5 p-3">
        <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-amber-400">
          <Rocket className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Total rewards → OTC launch holders
        </div>
        <div className="mt-1.5 font-display text-xl font-bold leading-tight text-amber-200">
          {fmtSol(launchSol)}
          {solUsd && launchSol != null ? (
            <span className="ml-2 text-[11px] font-normal text-amber-500/60">
              {fmtUsd(launchSol * solUsd)}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 text-[10px] leading-snug text-amber-500/50">
          Lifetime launchpad-holder payouts from launch fees
        </div>
      </div>
    </div>
  );
}