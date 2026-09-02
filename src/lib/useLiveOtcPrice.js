// Client-side live OTC price polling from DexScreener.
// DexScreener's public API is CORS-enabled, so the browser can poll it
// directly far more often than the 5-min backend snapshot (which is rate-
// limited by Helius / Magic Eden / otcdesks). This keeps the displayed OTC
// price, SOL conversion, and arbitrage estimate fresh (~15s) while the heavy
// on-chain/floor/protocol data continues to refresh every 5 min server-side.
//
// Given the latest stored snapshot (for the NFT floor + buyback OTC balance,
// which the client cannot re-derive cheaply), this returns live overrides for
// all price-derived fields, recomputing mint cost, secondary cost, spread and
// recommendation exactly as the backend does.

import { useEffect, useState } from "react";

const OTC_TOKEN_MINT = "MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump";
const DEXSCREENER_PAIR = "da4pm4xsdy4m9v4cgakkbvh1pw1ysctqqa5nekghukpt";
const WRAPPED_SOL = "So11111111111111111111111111111111111111112";

const OTC_DEPOSIT = 100000; // OTC burned per mint
const SURCHARGE_SOL = 0.5; // SOL surcharge per mint (0.45 pot + 0.05 protocol)
const ME_TOTAL_MARKUP = 1.07; // 2% taker + 5% creator royalty on secondary

const POLL_MS = 15000;

async function getJson(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function pickPair(json, preferAddr) {
  const pairs = json?.pairs || [];
  let p = pairs.find((x) => x.pairAddress === preferAddr);
  if (!p) p = pairs.find((x) => x.chainId === "solana") || pairs[0];
  return p || null;
}

function pickSolUsd(json) {
  const pairs = json?.pairs || [];
  const p =
    pairs.find(
      (x) => x.chainId === "solana" && (x.quoteToken?.symbol === "USDC" || x.quoteToken?.symbol === "USDT")
    ) || pairs.find((x) => x.chainId === "solana");
  return p ? parseFloat(p.priceUsd) : null;
}

export function useLiveOtcPrice(snapshot) {
  const [live, setLive] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      const [otcJson, solJson] = await Promise.all([
        getJson(`https://api.dexscreener.com/latest/dex/tokens/${OTC_TOKEN_MINT}`),
        getJson(`https://api.dexscreener.com/latest/dex/tokens/${WRAPPED_SOL}`),
      ]);
      if (cancelled) return;

      const pair = pickPair(otcJson, DEXSCREENER_PAIR);
      let tokenPriceUsd = pair ? parseFloat(pair.priceUsd) : null;
      let tokenPriceSol = pair ? parseFloat(pair.priceNative) : null;
      let solPriceUsd = pickSolUsd(solJson);

      // Cross-derive any missing value so a single rate-limit doesn't blank the UI.
      if (solPriceUsd == null && tokenPriceUsd != null && tokenPriceSol != null && tokenPriceSol > 0) {
        solPriceUsd = tokenPriceUsd / tokenPriceSol;
      }
      if (tokenPriceSol == null && tokenPriceUsd != null && solPriceUsd != null) {
        tokenPriceSol = tokenPriceUsd / solPriceUsd;
      }
      if (tokenPriceUsd == null && tokenPriceSol != null && solPriceUsd != null) {
        tokenPriceUsd = tokenPriceSol * solPriceUsd;
      }

      if (tokenPriceUsd == null && solPriceUsd == null) return; // nothing usable

      const floorSol = snapshot?.nft_floor_sol ?? null;
      const buybackOtc = snapshot?.protocol_buyback_otc ?? null;
      const floorUsd = floorSol != null && solPriceUsd != null ? floorSol * solPriceUsd : null;
      const mintCostSol = tokenPriceSol != null ? OTC_DEPOSIT * tokenPriceSol + SURCHARGE_SOL : null;
      const mintCostUsd =
        tokenPriceUsd != null && solPriceUsd != null
          ? OTC_DEPOSIT * tokenPriceUsd + SURCHARGE_SOL * solPriceUsd
          : null;
      const secondaryCostSol = floorSol != null ? floorSol * ME_TOTAL_MARKUP : null;
      const secondaryCostUsd = floorUsd != null ? floorUsd * ME_TOTAL_MARKUP : null;
      let spreadSol = null;
      let spreadUsd = null;
      let spreadPct = null;
      let recommendation = "neutral";
      if (mintCostUsd != null && secondaryCostUsd != null) {
        spreadUsd = mintCostUsd - secondaryCostUsd;
        spreadSol = mintCostSol != null && secondaryCostSol != null ? mintCostSol - secondaryCostSol : null;
        spreadPct = mintCostUsd > 0 ? (spreadUsd / mintCostUsd) * 100 : null;
        recommendation =
          spreadUsd > 0.0001 ? "buy_secondary" : spreadUsd < -0.0001 ? "mint" : "neutral";
      }

      setLive({
        sol_price_usd: solPriceUsd,
        token_price_usd: tokenPriceUsd,
        token_price_sol: tokenPriceSol,
        token_market_cap: pair?.marketCap ? parseFloat(pair.marketCap) : null,
        token_volume_24h: pair?.volume?.h24 ? parseFloat(pair.volume.h24) : null,
        token_liquidity_usd: pair?.liquidity?.usd ? parseFloat(pair.liquidity.usd) : null,
        token_price_change_24h: pair?.priceChange?.h24 ? parseFloat(pair.priceChange.h24) : null,
        token_price_change_1h: pair?.priceChange?.h1 ? parseFloat(pair.priceChange.h1) : null,
        nft_floor_usd: floorUsd,
        mint_cost_sol: mintCostSol,
        mint_cost_usd: mintCostUsd,
        secondary_cost_sol: secondaryCostSol,
        secondary_cost_usd: secondaryCostUsd,
        spread_sol: spreadSol,
        spread_usd: spreadUsd,
        spread_pct: spreadPct,
        recommendation,
        protocol_buyback_otc_value_sol:
          buybackOtc != null && tokenPriceSol != null ? buybackOtc * tokenPriceSol : null,
        protocol_buyback_otc_value_usd:
          buybackOtc != null && tokenPriceUsd != null ? buybackOtc * tokenPriceUsd : null,
        _live_ts: Date.now(),
      });
    };

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // Re-subscribe when the stored floor / buyback balance changes (new 5-min
    // snapshot) so the recomputed arbitrage uses the fresh floor.
  }, [snapshot?.nft_floor_sol, snapshot?.protocol_buyback_otc]);

  return live;
}