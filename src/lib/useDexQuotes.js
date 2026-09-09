import { useEffect, useState } from "react";

const DEX_URL = "https://api.dexscreener.com/tokens/v1/solana/";
const QUOTE_POLL_MS = 15_000;
const MAX_MINTS = 30; // DexScreener tokens/v1 batch limit per request

const num = (v) => Number.isFinite(v) ? v : null;

// graduated = the mint trades on any AMM pair beyond pump.fun (e.g. pumpswap).
export function extractDexQuote(pairs, mint) {
  const matching = (pairs || []).filter((p) => p?.chainId === "solana" && p.baseToken?.address === mint);
  if (!matching.length) return null;
  const pair = [...matching].sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
  return {
    mcap: num(pair.marketCap),
    vol24: num(pair.volume?.h24),
    liquidity: num(pair.liquidity?.usd),
    change24h: num(pair.priceChange?.h24),
    priceUsd: num(Number(pair.priceUsd)),
    graduated: matching.some((p) => p.dexId !== "pumpfun"),
  };
}

// Browser-side live DEX quotes for the given mints (the visible launcher
// page and/or the analytics cohort). Upstream otcdesks.cash snapshots lag
// minutes behind DexScreener, and DexScreener 429s the shared
// function-runtime egress IP — so the visitor's browser re-quotes market
// metrics (mcap/vol/liquidity/24h change) every ~15s, batched 30 mints per
// request. Keys on the joined mint list, so page/filter flips restart the
// poller but renders do not.
export function useDexQuotes(mints = []) {
  const [quotes, setQuotes] = useState({});
  const [at, setAt] = useState(null);
  const key = [...new Set(mints.filter(Boolean))].join(",");
  useEffect(() => {
    if (!key) { setQuotes({}); setAt(null); return; }
    let stopped = false, pending = false, timer = null;
    const list = key.split(",");
    const chunks = [];
    for (let i = 0; i < list.length; i += MAX_MINTS) chunks.push(list.slice(i, i + MAX_MINTS));
    const refresh = async () => {
      if (stopped || pending || document.hidden) return;
      pending = true;
      try {
        const results = await Promise.all(chunks.map((chunk) =>
          fetch(DEX_URL + chunk.join(","))
            .then((res) => (res.ok ? res.json() : null))
            .catch(() => null)
        ));
        if (stopped) return;
        const pairs = results.filter(Array.isArray).flat();
        if (!pairs.length) throw new Error("DEX_UNAVAILABLE");
        const next = {};
        for (const mint of list) {
          const quote = extractDexQuote(pairs, mint);
          if (quote) next[mint] = quote;
        }
        setQuotes(next);
        setAt(Date.now());
      } catch {
        /* keep previous quotes; rows keep their upstream snapshot values */
      } finally {
        pending = false;
        if (!stopped) timer = setTimeout(refresh, QUOTE_POLL_MS);
      }
    };
    refresh();
    const onVisible = () => { if (!document.hidden) { clearTimeout(timer); refresh(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key]);
  return { quotes, at };
}