import { useCallback, useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { fetchTokenPricesUsd, SOL_MINT } from "@/lib/stockPrices";

// Sentinel wallet key so the claim scanner caches the LISTED desks' vault
// holdings separately from any real wallet's cache (shared across all users).
const LISTED_CACHE_WALLET = "__listed_holdings__";

// Live REAL on-chain vault stock for the given desks, priced in USD/SOL.
// The snapshot's accrued_value is a THEORETICAL estimate summed from the
// protocol's distribution history — a desk whose owner already claimed still
// shows a high estimate but holds ZERO real stock. This reads the true vault
// balances (reusing scanWalletClaims with a sentinel wallet so the result is
// cached server-side and shared across users) and prices them at spot.
// Shared by the holdings gallery and the arbitrage panel so both display
// identical real holding values.
export function useLiveVaultHoldings(assets) {
  const [realHold, setRealHold] = useState({}); // asset_id -> { hasStock, holdingUsd, holdingSol, loaded }
  const [scanning, setScanning] = useState(false);
  // Semantic key: rescan only when the desk set changes, not on re-render.
  const key = (assets || []).map((a) => a.asset_id).join(",");

  const scan = useCallback(
    async (force = false) => {
      const list = assets || [];
      if (!list.length) return;
      setScanning(true);
      try {
        const payload = list.map((h) => ({
          asset_id: h.asset_id,
          name: h.name,
          image_url: h.image_url,
        }));
        const res = await base44.functions.invoke("scanWalletClaims", {
          wallet: LISTED_CACHE_WALLET,
          force,
          assets: payload,
        });
        const desks = res?.data?.desks || [];
        const mints = new Set([SOL_MINT]);
        for (const d of desks) for (const t of d.tickers || []) mints.add(t.mint);
        const prices = await fetchTokenPricesUsd([...mints]);
        const solPrice = prices?.[SOL_MINT] ?? null;
        const map = {};
        for (const d of desks) {
          let usd = 0;
          let hasStock = false;
          for (const t of d.tickers || []) {
            if (t.exists && t.amount > 0) {
              hasStock = true;
              usd += (t.amount / 10 ** t.decimals) * (prices?.[t.mint] || 0);
            }
          }
          map[d.asset_id] = {
            hasStock,
            holdingUsd: usd,
            holdingSol: solPrice ? usd / solPrice : 0,
            loaded: true,
          };
        }
        setRealHold(map);
      } catch {
        /* ignore — fall back to estimate */
      } finally {
        setScanning(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  );

  useEffect(() => {
    scan(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { realHold, scanning, rescan: () => scan(true) };
}