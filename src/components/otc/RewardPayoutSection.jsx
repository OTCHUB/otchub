import React from "react";
import { useTokenSymbols } from "@/lib/useTokenSymbols";

// Reward payout card for the launcher token details dialog: the source-
// reported primary reward and its mint, the rotating reward cycle and — for
// MemeStock baskets — the full basket composition, each member resolved to
// its community symbol (feed map first, DexScreener fallback second). All of
// it is an upstream setting, not a verified distribution — the in-card
// disclaimers stay.

const solscanUrl = (mint) => `https://solscan.io/token/${encodeURIComponent(mint)}`;
const shortMint = (mint) => `${mint.slice(0, 4)}…${mint.slice(-4)}`;

export default function RewardPayoutSection({ payout, symbols = {} }) {
  const basket = Array.isArray(payout?.rewardBasket) ? payout.rewardBasket : [];
  const dexSymbolOf = useTokenSymbols(basket);
  const nameOf = (mint) => (payout?.rewardMint === mint && payout?.rewardSymbol)
    || symbols[mint] || dexSymbolOf(mint) || null;

  return (
    <section aria-label="Stonk payout" className="min-w-0 space-y-2 border border-amber-400/30 bg-amber-400/5 p-3 text-xs">
      <h3 className="font-bold uppercase tracking-widest text-amber-300">Stonk payout</h3>
      {payout ? <>
        <p className="break-words text-green-300">
          Reported primary reward: {payout.rewardSymbol ? `$${payout.rewardSymbol}` : "symbol unavailable"}
        </p>
        {payout.rewardMint && (
          <a href={solscanUrl(payout.rewardMint)} target="_blank" rel="noopener noreferrer"
            className="block break-all font-mono text-cyan-300 underline">{payout.rewardMint} ↗</a>
        )}
        {basket.length > 1 && (
          <div>
            <p className="text-green-300">Rotating reward basket ({basket.length} tokens)</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {basket.map((mint) => (
                <li key={mint}>
                  <a href={solscanUrl(mint)} target="_blank" rel="noopener noreferrer"
                    title={`${mint} — source-reported basket member${payout.rewardMint === mint ? "; current reward" : ""}`}
                    className={`inline-flex max-w-full items-center gap-1 border px-2 py-1 hover:bg-green-500/10 ${payout.rewardMint === mint ? "border-amber-400/70 bg-amber-400/10 text-amber-200" : "border-green-500/30 text-green-300"}`}>
                    <span className="truncate font-mono">${nameOf(mint) || shortMint(mint)}</span>
                    {payout.rewardMint === mint && <span className="shrink-0 text-[10px] text-amber-300">· active</span>}
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-green-500/60">Rewards rotate through this basket; the highlighted member is the reported current reward.</p>
          </div>
        )}
        <p className="text-green-500/70">
          Reported rewardCycle: {Number.isSafeInteger(payout.rewardCycle) && payout.rewardCycle >= 0 ? payout.rewardCycle : "unavailable"} · units/meaning unverified
        </p>
      </> : <p className="text-green-500/70">Payout metadata unavailable; this does not mean no rewards.</p>}
      <p className="text-[13px] text-amber-200/70">Allocation, eligibility and payout timing are not provided by this feed. These are source-reported settings, not verified distributions or guaranteed returns.</p>
    </section>
  );
}