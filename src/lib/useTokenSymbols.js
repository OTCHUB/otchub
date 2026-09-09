import { useEffect, useState } from "react";

// Reward baskets ship as raw mints. The feed's rewardSymbols map already names
// the memestock pairings reported across the roster; anything still unnamed
// (established AMM tokens like WBTC / JitoSOL) is resolved once per mint from
// the visitor's browser via DexScreener's public tokens API — it permanently
// 429s the shared function-runtime egress IP — and cached for the session.
// A mint mapped to null was checked and has no known AMM listing.
const resolved = new Map();
const DEX_URL = "https://api.dexscreener.com/tokens/v1/solana/";
const MAX_MINTS = 30;

export function useTokenSymbols(mints = []) {
  const [, bump] = useState(0);
  const key = [...new Set(mints.filter(Boolean))].join(",");
  useEffect(() => {
    const missing = key ? key.split(",").filter((mint) => !resolved.has(mint)) : [];
    if (!missing.length) return;
    let stopped = false;
    for (const mint of missing) resolved.set(mint, null);
    fetch(DEX_URL + missing.slice(0, MAX_MINTS).join(","))
      .then((res) => (res.ok ? res.json() : []))
      .then((pairs) => {
        for (const pair of Array.isArray(pairs) ? pairs : []) {
          const mint = pair?.baseToken?.address;
          const symbol = pair?.baseToken?.symbol?.trim();
          if (mint && symbol) resolved.set(mint, symbol);
        }
        if (!stopped) bump((n) => n + 1);
      })
      .catch(() => { /* unresolved members keep their shortened mint label */ });
    return () => { stopped = true; };
  }, [key]);
  return (mint) => resolved.get(mint) || null;
}