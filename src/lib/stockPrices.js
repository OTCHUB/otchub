// Fetch USD spot prices for a set of Solana token mints via DexScreener's
// batched tokens endpoint (up to 30 mints per call). Used by the claim panel
// to value the accrued stock held in each desk vault. DexScreener is
// CORS-enabled so this runs client-side without a backend call.

export const SOL_MINT = "So11111111111111111111111111111111111111112";

export async function fetchTokenPricesUsd(mints) {
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