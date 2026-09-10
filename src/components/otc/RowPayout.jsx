import React from "react";
import { PayoutIcon } from "@/components/otc/RewardPayoutSection";

// Tape-row payout badge: only the reward token icon — stacked, slightly
// overlapped when the payout rotates through a MemeStock basket — keeping
// launcher rows dense. Full payout details live in the token profile dialog.
export default function RowPayout({ payout, symbols = {}, resolve }) {
  const basket = Array.isArray(payout?.rewardBasket) && payout.rewardBasket.length > 1 ? payout.rewardBasket : [];
  const mints = basket.length ? basket : payout?.rewardMint ? [payout.rewardMint] : [];
  if (!mints.length && !payout?.rewardSymbol) return null;
  const symOf = (mint) => symbols[mint] || resolve?.(mint)?.symbol
    || (payout.rewardMint === mint ? payout.rewardSymbol : null) || "?";
  const logoOf = (mint) => resolve?.(mint)?.logo || null;
  const title = `Rewards holders in ${mints.length
    ? mints.map((m) => `$${symOf(m)}`).join(", ")
    : `$${payout.rewardSymbol}`} · source-reported, unverified`;
  return (
    <span className="inline-flex shrink-0 items-center" title={title}>
      {mints.length ? mints.map((mint, i) => (
        <span key={mint} className={i ? "-ml-1.5" : ""}>
          <PayoutIcon mint={mint} symbol={symOf(mint)} logo={logoOf(mint)} />
        </span>
      )) : payout?.rewardSymbol ? (
        <PayoutIcon mint={payout.rewardMint || payout.rewardSymbol} symbol={payout.rewardSymbol} />
      ) : null}
    </span>
  );
}