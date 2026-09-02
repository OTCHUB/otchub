// USD spot prices for the protocol's stock mints + SOL, served from the app's
// GLOBAL backend price cache: ONE shared DexScreener fetch per TTL window
// serves every user and every panel (claim valuations, gallery, portfolio)
// instead of each browser making its own API calls. Falls back to a direct
// client-side DexScreener fetch only when the backend feed is unreachable.

import { base44 } from "@/api/base44Client";

export const SOL_MINT = "So11111111111111111111111111111111111111112";

export async function fetchTokenPricesUsd(mints) {
  // Global shared feed (returns the full cached mint->USD map — a superset of
  // the requested mints, all from one upstream fetch).
  try {
    const res = await base44.functions.invoke("getSpotPrices", {});
    const d = res?.data || {};
    if (d?.prices && Object.keys(d.prices).length) return d.prices;
  } catch {
    /* fall back to a direct client-side fetch below */
  }
  const out = {};
  const unique = [...new Set(mints)].filter(Boolean);
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    try {
      const res = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`
      );
      if (!res.ok) continue;
      const json = await res.json();
      for (const p of json.pairs || []) {
        const addr = p.baseToken?.address;
        const px = p.priceUsd != null ? parseFloat(p.priceUsd) : null;
        if (!addr || px == null) continue;
        // Prefer a Solana pair when one exists; otherwise keep the first seen.
        if (p.chainId === "solana" || out[addr] == null) out[addr] = px;
      }
    } catch {
      /* ignore chunk */
    }
  }
  return out;
}