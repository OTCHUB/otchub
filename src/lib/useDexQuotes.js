import { useEffect, useState } from "react";

const DEX_URL = "https://api.dexscreener.com/tokens/v1/solana/";
const QUOTE_POLL_MS = 15_000;
const MAX_MINTS = 30; // DexScreener tokens/v1 batch limit

const num = (v) => Number.isFinite(v) ? v : null;

function pickPair(pairs, mint) {
  const matching = (pairs || []).filter((p) => p?.chainId === "solana" && p.baseToken?.address === mint);
  if (!matching.length) return null;
  return matching.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
}

// Best pair by liquidity → the same quote fields the tape displays.
export function extractDexQuote(pairs, mint) {
  const pair = pickPair(pairs, mint);
  if (!pair) return null;
  return {
    mcap: num(pair.marketCap),
    vol24: num(pair.volume?.h24),
    liquidity: num(pair.liquidity?.usd),
    change24h: num(pair.priceChange?.h24),
    priceUsd: num(Number(pair.priceUsd)),
  };
}

// Browser-side live DEX quotes for the mints currently visible in the
// launcher tape. Upstream otcdesks.cash snapshots lag minutes behind
// DexScreener, and DexScreener 429s the shared function-runtime egress IP —
// so the visitor's browser re-quotes market metrics (mcap/vol/liquidity/24h
// change) every ~15s for the visible page only. Keys on the joined mint
// list, so page/filter flips restart the poller but renders do not.
export function useDexQuotes(mints = []) {
  const [quotes, setQuotes] = useState({});
  const [at, setAt] = useState(null);
  const key = [...new Set(mints.filter(Boolean))].slice(0, MAX_MINTS).join(",");
  useEffect(() => {
    if (!key) { setQuotes({}); setAt(null); return; }
    let stopped = false, pending = false, timer = null;
    const list = key.split(",");
    const refresh = async () => {
      if (stopped || pending || document.hidden) return;
      pending = true;
      try {
        const res = await fetch(DEX_URL + list.join(","));
        if (!res.ok) throw new Error("DEX_UNAVAILABLE");
        const pairs = await res.json();
        if (stopped || !Array.isArray(pairs)) return;
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