import { useEffect, useState } from "react";

// Reward baskets ship as raw mints. The feed's rewardSymbols map already names
// the memestock pairings reported across the roster; anything still unnamed
// (established AMM tokens like WBTC / JitoSOL) is resolved once per mint from
// the visitor's browser via DexScreener's public tokens API — it permanently
// 429s the shared function-runtime egress IP — and cached for the session.
// Each entry resolves to { symbol, logo } (either may be null); a mint mapped
// to a null entry was checked and has no known AMM listing.
const resolved = new Map();
const DEX_URL = "https://api.dexscreener.com/tokens/v1/solana/";
const MAX_MINTS = 30;

const httpUrl = (value) => {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value.trim());
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
};

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
          if (!mint || !resolved.has(mint)) continue;
          const current = resolved.get(mint) || {};
          const symbol = typeof pair?.baseToken?.symbol === "string" ? pair.baseToken.symbol.trim() : "";
          const logo = httpUrl(pair?.info?.imageUrl);
          if (current.symbol || current.logo || symbol || logo) {
            resolved.set(mint, {
              symbol: current.symbol || symbol || null,
              logo: current.logo || logo || null,
            });
          }
        }
        if (!stopped) bump((n) => n + 1);
      })
      .catch(() => { /* unresolved members keep their shortened mint label */ });
    return () => { stopped = true; };
  }, [key]);
  return (mint) => resolved.get(mint) || null;
}