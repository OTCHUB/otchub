// GLOBAL spot-price cache: ONE shared upstream fetch per TTL window serves
// every user and every backend function that needs prices (claim valuations,
// portfolio, swap panel, live dashboard ticker), instead of each browser or
// each function call hitting DexScreener on its own. Persisted in a single
// PriceCache row so all app instances share it, with a short TTL to keep the
// data fresh.
//
// Upstream shape: TWO requests per refresh —
//   1. one batched request for the protocol's fixed 13-stock lineup (few
//      pairs per token, no truncation risk),
//   2. one SEPARATE request for wrapped SOL (it has 30+ pairs and
//      DexScreener truncates responses at 30 pairs per token — batching SOL
//      with stocks silently dropped prices).
// Gaps from a rate-limited run fall back to the previously cached values.

import { STOCKS } from "./otcIdl.ts";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
const OTC_PAIR_ADDR = "DA4pM4xSDY4M9V4CgAKKBVH1pw1yscTQQa5nEkGHuKpt";
const CACHE_KEY = "spot";
const TTL_MS = 20 * 1000;

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

// Mint -> USD price from a DexScreener pairs list, preferring solana-chain
// pairs (falling back to the first seen pair for a mint).
function pricesFromPairs(pairs) {
  const out = {};
  for (const p of pairs || []) {
    const addr = p.baseToken?.address;
    const px = p.priceUsd != null ? parseFloat(p.priceUsd) : null;
    if (!addr || px == null || !Number.isFinite(px)) continue;
    if (p.chainId === "solana" || out[addr] == null) out[addr] = px;
  }
  return out;
}

// Compact $OTC pair summary (the OTC/SOL pool) for the live ticker + swap
// panel: price, mcap, volume, liquidity, and 1h/24h changes.
function pairSummary(p) {
  if (!p) return null;
  return {
    price_usd: p.priceUsd != null ? parseFloat(p.priceUsd) : null,
    price_native: p.priceNative != null ? parseFloat(p.priceNative) : null,
    market_cap: p.marketCap != null ? parseFloat(p.marketCap) : null,
    volume_24h: p.volume?.h24 != null ? parseFloat(p.volume.h24) : null,
    liquidity_usd: p.liquidity?.usd != null ? parseFloat(p.liquidity.usd) : null,
    change_1h: p.priceChange?.h1 != null ? parseFloat(p.priceChange.h1) : null,
    change_2h: p.priceChange?.h2 != null ? parseFloat(p.priceChange.h2) : null,
    change_24h: p.priceChange?.h24 != null ? parseFloat(p.priceChange.h24) : null,
  };
}

// Returns { prices: { mint -> usd }, otc_pair, sol_price_usd, cached }.
// `cached: true` means the row was fresh and NO upstream call was made.
export async function getSpotPrices(base44) {
  const existing = await base44.asServiceRole.entities.PriceCache.filter({
    key: CACHE_KEY,
  });
  const row = existing?.[0] || null;
  const rowFresh =
    row?.updated_date &&
    Date.now() - new Date(row.updated_date).getTime() < TTL_MS &&
    row.prices;
  if (rowFresh) {
    return {
      prices: row.prices,
      otc_pair: row.otc_pair || null,
      sol_price_usd: row.prices[SOL_MINT] ?? null,
      cached: true,
    };
  }

  const stockMints = STOCKS.map((s) => s.mint);
  const [stocksR, solR] = await Promise.allSettled([
    fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${stockMints.join(",")}`),
    fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${SOL_MINT}`),
  ]);

  const prices = {};
  let otcPair = null;
  if (stocksR.status === "fulfilled") {
    const pairs = stocksR.value?.pairs || [];
    Object.assign(prices, pricesFromPairs(pairs));
    otcPair =
      pairs.find(
        (x) => String(x.pairAddress).toLowerCase() === OTC_PAIR_ADDR.toLowerCase()
      ) ||
      pairs.find((x) => x.chainId === "solana") ||
      null;
  }
  if (solR.status === "fulfilled") {
    const solPairs = solR.value?.pairs || [];
    const sp =
      solPairs.find(
        (x) =>
          x.chainId === "solana" &&
          (x.quoteToken?.symbol === "USDC" || x.quoteToken?.symbol === "USDT")
      ) ||
      solPairs.find((x) => x.chainId === "solana") ||
      null;
    const px = sp?.priceUsd != null ? parseFloat(sp.priceUsd) : null;
    if (px != null && Number.isFinite(px)) prices[SOL_MINT] = px;
  }
  // Fill any gap (upstream rate-limited this run) from the previous cache.
  if (row?.prices) {
    for (const k of Object.keys(row.prices)) {
      if (prices[k] == null) prices[k] = row.prices[k];
    }
    if (!otcPair && row.otc_pair) otcPair = row.otc_pair;
  }

  const payload = { prices, otc_pair: pairSummary(otcPair) };
  if (row?.id) {
    await base44.asServiceRole.entities.PriceCache.update(row.id, payload);
  } else {
    await base44.asServiceRole.entities.PriceCache.create({
      key: CACHE_KEY,
      ...payload,
    });
  }
  return { ...payload, sol_price_usd: prices[SOL_MINT] ?? null, cached: false };
}