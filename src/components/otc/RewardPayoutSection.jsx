import React, { useState } from "react";
import { useTokenSymbols } from "@/lib/useTokenSymbols";

// Reward payout card for the launcher token details dialog: the source-
// reported primary reward and its mint and — for MemeStock baskets — the full
// basket composition, each member resolved to its community symbol and token
// icon (feed map first, DexScreener fallback second). All of it is an
// upstream setting, not a verified distribution.

const solscanUrl = (mint) => `https://solscan.io/token/${encodeURIComponent(mint)}`;
const shortMint = (mint) => `${mint.slice(0, 4)}…${mint.slice(-4)}`;

// Official launcher payout icons live at otcdesks.cash/stocks/<SYMBOL>.png
// (the same stock icons the official launcher's reward picker uses); the
// DexScreener logo is the fallback, then the symbol's first letter.
const stockIconUrl = (symbol) => (typeof symbol === "string" && symbol
  ? `https://otcdesks.cash/stocks/${encodeURIComponent(symbol.toUpperCase())}.png`
  : "");

export function PayoutIcon({ mint, symbol, logo }) {
  const [failedUrl, setFailedUrl] = useState("");
  const label = symbol || shortMint(mint);
  const srcs = [stockIconUrl(symbol), logo].filter(Boolean);
  const src = srcs.find((u) => u !== failedUrl) || "";
  return (
    <span aria-hidden="true" className="inline-flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-[9px] font-bold leading-none text-slate-900">
      {src ? (
        <img src={src} alt="" width={16} height={16} loading="lazy" decoding="async" referrerPolicy="no-referrer"
          onError={() => setFailedUrl(src)} className="h-full w-full object-contain" />
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
              <span className="font-bold">${payout.rewardSymbol || nameOf(payout.rewardMint) || "?"}</span> · reported
            </span>
          </a>
        ) : (
          <p className="break-words text-green-300">
            {payout.rewardSymbol ? `$${payout.rewardSymbol} · reported` : "symbol unavailable"}
          </p>
        )}
        {basket.length > 1 && (
          <div>
            <p className="text-green-300">Basket · {basket.length} tokens</p>
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
            <p className="mt-1 text-green-500/60">Rotates through the basket; highlighted = current.</p>
          </div>
        )}
      </> : <p className="text-green-500/70">Payout metadata unavailable.</p>}
    </section>
  );
}