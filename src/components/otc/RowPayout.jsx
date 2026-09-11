import React from "react";
import { PayoutIcon } from "@/components/otc/RewardPayoutSection";

// Tape-row payout badge: only the reward token icon — stacked, slightly
// overlapped when the payout rotates through a MemeStock basket — keeping
// launcher rows dense. Full payout details live in the token profile dialog.
// Icons come from the feed's rewardCatalog (the exact 1:1 site resolution);
// the legacy symbols map only names otherwise-unknown basket members.
/**
 * @param {{
 *   payout?: any,
 *   symbols?: Record<string, string>,
 *   catalog?: { byMint?: Record<string, any>, bySymbol?: Record<string, any> },
 * }} props
 */
export default function RowPayout({ payout, symbols = {}, catalog = {} }) {
  const byMint = catalog?.byMint || {}, bySymbol = catalog?.bySymbol || {};
  const basket = Array.isArray(payout?.rewardBasket) && payout.rewardBasket.length > 1 ? payout.rewardBasket : [];
  const mints = basket.length ? basket : payout?.rewardMint ? [payout.rewardMint] : [];
  if (!mints.length && !payout?.rewardSymbol) return null;
  const symOf = (mint) => byMint[mint]?.symbol || symbols[mint]
    || (payout.rewardMint === mint ? payout.rewardSymbol : null) || "?";
  const iconOf = (mint) => byMint[mint]?.icon || null;
  // Mint-less rewards (pending token) resolve through the symbol catalog.
  const symbolMeta = !mints.length && payout?.rewardSymbol ? bySymbol[payout.rewardSymbol] : null;
  const title = `Rewards holders in ${mints.length
    ? mints.map((m) => `$${symOf(m)}`).join(", ")
    : `$${payout.rewardSymbol}`} · source-reported, unverified`;
  return (
    <span className="inline-flex shrink-0 items-center" title={title}>
      {mints.length ? <>
        {mints.slice(0, 4).map((mint, i) => (
          <span key={mint} className={i ? "-ml-1.5" : ""}>
            <PayoutIcon mint={mint} symbol={symOf(mint)} icon={iconOf(mint)} />
          </span>
        ))}
        {mints.length > 4 && (
          <span className="ml-0.5 font-mono text-[10px] font-bold text-amber-300">+{mints.length - 4}</span>
        )}
      </> : payout?.rewardSymbol ? (
        <PayoutIcon mint={payout.rewardMint || payout.rewardSymbol} symbol={payout.rewardSymbol} icon={symbolMeta?.icon || null} />
      ) : null}
    </span>
  );
}