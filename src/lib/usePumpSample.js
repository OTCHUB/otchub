// Client-side native pump.fun market sample for the PUMP.FUN SAMPLE box.
// GeckoTerminal permanently 429s the backend's shared function-runtime egress
// IP, but every visitor has their own ~30-req/min budget — so the BROWSER
// fetches the pool pages (pump-fun pools = BONDING launches, pumpswap pools =
// GRADUATED ones, top by 24h volume), merges them, and caches the result in
// localStorage for 15 min. On any failure the panel silently falls back to the
// server-side DexScreener search sample shipped in the analytics payload.
import { useEffect, useState } from "react";

const GT_POOLS = "https://api.geckoterminal.com/api/v2/networks/solana/dexes";
const PAGES_PER_DEX = 5; // × 20 pools × 2 dexes → up to ~200-pair sample
const STORAGE_KEY = "otc_pump_sample_v1";
const TTL_MS = 15 * 60_000;

const readCache = () => {
  try {
    const s = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
    return s && Date.now() - s.at < TTL_MS ? s : null;
  } catch {
    return null;
  }
};

export function usePumpSample() {
  const [sample, setSample] = useState(readCache);

  useEffect(() => {
    if (readCache()) return; // fresh cache already in state
    let cancelled = false;
    (async () => {
      try {
        const seen = new Set();
        const rows = [];
        for (const dex of ["pump-fun", "pumpswap"]) {
          for (let page = 1; page <= PAGES_PER_DEX; page++) {
            const res = await fetch(`${GT_POOLS}/${dex}/pools?page=${page}&sort=h24_volume_usd_desc`);
            if (!res.ok) throw new Error(`gecko ${res.status}`);
            const data = (await res.json()).data || [];
            for (const p of data) {
              const token = p.relationships?.base_token?.data?.id || p.attributes?.address || p.id;
              if (seen.has(token)) continue;
              seen.add(token);
              rows.push({ dex, vol: Number(p.attributes?.volume_usd?.h24 || 0) });
            }
            if (data.length < 20) break; // last page — no more pools
          }
        }
        if (cancelled || rows.length < 5) return;
        const vols = rows.map((r) => r.vol).filter(Number.isFinite).sort((a, b) => a - b);
        const s = {
          at: Date.now(),
          n: rows.length,
          graduatedShare: +(rows.filter((r) => r.dex === "pumpswap").length / rows.length).toFixed(3),
          medianVol24: vols[Math.floor(vols.length / 2)],
          source: "browser",
        };
        try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
        setSample(s);
      } catch { /* keep the server-side sample */ }
    })();
    return () => { cancelled = true; };
  }, []);

  return sample;
}