import React, { useState } from "react";
import { useTokenSymbols } from "@/lib/useTokenSymbols";

// Reward payout card for the launcher token details dialog: the source-
// reported primary reward and its mint and — for MemeStock baskets — the full
// basket composition, each member resolved to its community symbol and token
// icon (feed map first, DexScreener fallback second). All of it is an
// upstream setting, not a verified distribution.

const solscanUrl = (mint) => `https://solscan.io/token/${encodeURIComponent(mint)}`;
const shortMint = (mint) => `${mint.slice(0, 4)}…${mint.slice(-4)}`;

// Per-payout stonk icon: the member token's own logo, falling back to its
// first letter when no image is available or it fails to load.
function PayoutIcon({ mint, symbol, logo }) {
  const [failedUrl, setFailedUrl] = useState("");
  const label = symbol || shortMint(mint);
  return (
    <span aria-hidden="true" className="inline-flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden border border-green-500/30 bg-green-500/10 text-[9px] leading-none text-green-300">
      {logo && logo !== failedUrl ? (
        <img src={logo} alt="" width={16} height={16} loading="lazy" decoding="async" referrerPolicy="no-referrer"
          onError={() => setFailedUrl(logo)} className="h-full w-full object-cover" />
      ) : label.slice(0, 1)}
    </span>
  );
}

export default function RewardPayoutSection({ payout, symbols = {} }) {
  const basket = Array.isArray(payout?.rewardBasket) ? payout.rewardBasket : [];
  const lookupMints = basket.length ? basket : payout?.rewardMint ? [payout.rewardMint] : [];
  const dexMetaOf = useTokenSymbols(lookupMints);
  const nameOf = (mint) => (payout?.rewardMint === mint && payout?.rewardSymbol)
    || symbols[mint] || dexMetaOf(mint)?.symbol || null;
  const logoOf = (mint) => dexMetaOf(mint)?.logo || null;

  return (
    <section aria-label="Stonk payout" className="min-w-0 space-y-2 border border-amber-400/30 bg-amber-400/5 p-3 text-xs">
      <h3 className="font-bold uppercase tracking-widest text-amber-300">Stonk payout</h3>
      {payout ? <>
        {payout.rewardMint ? (
          <a href={solscanUrl(payout.rewardMint)} target="_blank" rel="noopener noreferrer"
            title={`${payout.rewardMint} — source-reported primary reward`}
            className="flex max-w-full items-center gap-2 text-green-300 hover:text-emerald-300">
            <PayoutIcon mint={payout.rewardMint} symbol={nameOf(payout.rewardMint)} logo={logoOf(payout.rewardMint)} />
            <span className="min-w-0 break-words">
              Reported primary reward: <span className="font-bold">${payout.rewardSymbol || nameOf(payout.rewardMint) || "?"}</span>
            </span>
          </a>
        ) : (
          <p className="break-words text-green-300">
            Reported primary reward: {payout.rewardSymbol ? `$${payout.rewardSymbol}` : "symbol unavailable"}
          </p>
        )}
        {basket.length > 1 && (
          <div>
            <p className="text-green-300">Rotating reward basket ({basket.length} tokens)</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {basket.map((mint) => (
                <li key={mint}>
                  <a href={solscanUrl(mint)} target="_blank" rel="noopener noreferrer"
                    title={`${mint} — source-reported basket member${payout.rewardMint === mint ? "; current reward" : ""}`}
                    className={`inline-flex max-w-full items-center gap-1.5 border px-2 py-1 hover:bg-green-500/10 ${payout.rewardMint === mint ? "border-amber-400/70 bg-amber-400/10 text-amber-200" : "border-green-500/30 text-green-300"}`}>
                    <PayoutIcon mint={mint} symbol={nameOf(mint)} logo={logoOf(mint)} />
                    <span className="truncate font-mono">${nameOf(mint) || shortMint(mint)}</span>
                    {payout.rewardMint === mint && <span className="shrink-0 text-[10px] text-amber-300">· active</span>}
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-green-500/60">Rewards rotate through this basket; the highlighted member is the reported current reward.</p>
          </div>
        )}
      </> : <p className="text-green-500/70">Payout metadata unavailable; this does not mean no rewards.</p>}
    </section>
  );
}