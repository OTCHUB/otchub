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
//
// CHUNKED + FAILURE-VISIBLE: one invoke per ~12 desks, 3 in flight. A single
// 60+ desk invoke coupled every listing to one RPC burst and one function
// timeout, and the silent catch used to turn ANY failure (Base44 entity
// quota, Helius rate limit) into an empty map — which the arbitrage panel
// rendered as a false NO_LIVE_LISTINGS. Now: per-chunk failures degrade only
// their own desks (which keep last-good values), a total failure surfaces
// `error` (+ one auto-retry, then a manual RETRY affordance in the UI), and
// a partial failure sets `partial` while still showing what verified.
const CHUNK_SIZE = 12;
const CONCURRENCY = 3;

export function useLiveVaultHoldings(assets) {
  const [realHold, setRealHold] = useState({}); // asset_id -> { hasStock, holdingUsd, holdingSol, loaded }
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(false);     // every chunk failed
  const [partial, setPartial] = useState(false); // some chunks failed — panel shows verified subset + last-good
  // Semantic key: rescan only when the desk set changes, not on re-render.
  const key = (assets || []).map((a) => a.asset_id).join(",");

  const scan = useCallback(
    async (force = false) => {
      const list = assets || [];
      if (!list.length) return;
      setScanning(true);
      setError(false);
      setPartial(false);
      try {
        const chunks = [];
        for (let i = 0; i < list.length; i += CHUNK_SIZE) chunks.push(list.slice(i, i + CHUNK_SIZE));
        const desks = [];
        let failed = 0;
        let next = 0;
        await Promise.all(
          Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, async () => {
            while (next < chunks.length) {
              const mine = next++;
              try {
                const res = await base44.functions.invoke("scanWalletClaims", {
                  wallet: LISTED_CACHE_WALLET,
                  force,
                  assets: chunks[mine].map((h) => ({
                    asset_id: h.asset_id,
                    name: h.name,
                    image_url: h.image_url,
                  })),
                });
                if (res?.data?.error) throw new Error(res.data.error);
                desks.push(...(res?.data?.desks || []));
              } catch {
                failed++;   // this chunk's desks keep their last-good values below
              }
            }
          })
        );
        if (!desks.length) throw new Error(`vault scan failed (${failed}/${chunks.length} chunks)`);
        setPartial(failed > 0);

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
        // stale-while-revalidate per asset: failed chunks carry forward
        // their last-good values instead of vanishing from the panel
        setRealHold((prev) => {
          const merged = { ...map };
          for (const a of list) {
            if (!(a.asset_id in merged) && prev[a.asset_id]) merged[a.asset_id] = prev[a.asset_id];
          }
          return merged;
        });
      } catch {
        setError(true);
        if (!force) setTimeout(() => scan(true), 8000);   // one auto-retry; after that the UI offers RETRY
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

  return { realHold, scanning, error, partial, rescan: () => scan(true) };
}