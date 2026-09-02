// Live OTC + SOL spot prices for the dashboard, polled from the app's GLOBAL
// backend price cache: ONE shared upstream DexScreener fetch per TTL window
// serves every connected user, so aggregate API usage stays flat no matter
// how many users are online, while the displayed price stays fresh (cache TTL
// ~20s, poll 15s). On a failed poll the previous values are kept.
//
// Given the latest stored snapshot (for the NFT floor + buyback OTC balance,
// which the client cannot re-derive cheaply), this returns live overrides for
// all price-derived fields, recomputing mint cost, secondary cost, spread and
// recommendation exactly as the backend does.

import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";

const WRAPPED_SOL = "So11111111111111111111111111111111111111112";

const OTC_DEPOSIT = 100000; // OTC burned per mint
const SURCHARGE_SOL = 0.5; // SOL surcharge per mint (0.45 pot + 0.05 protocol)
const ME_TOTAL_MARKUP = 1.07; // 2% taker + 5% creator royalty on secondary

const POLL_MS = 15000;

export function useLiveOtcPrice(snapshot) {
  const [live, setLive] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      let d = null;
      try {
        const res = await base44.functions.invoke("getSpotPrices", {});
        d = res?.data;
      } catch {
        return; // keep previous values; retry next poll
      }
      if (cancelled || !d?.prices) return;

      const otc = d.otc_pair || {};
      let tokenPriceUsd = otc.price_usd ?? null;
      let tokenPriceSol = otc.price_native ?? null;
      let solPriceUsd = d.prices[WRAPPED_SOL] ?? null;

      // Cross-derive any missing value so a single missing price doesn't blank the UI.
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
        token_market_cap: otc.market_cap ?? null,
        token_volume_24h: otc.volume_24h ?? null,
        token_liquidity_usd: otc.liquidity_usd ?? null,
        token_price_change_24h: otc.change_24h ?? null,
        token_price_change_1h: otc.change_1h ?? null,
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