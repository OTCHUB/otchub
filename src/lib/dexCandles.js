// Full $OTC candle series bootstrap.
//
// DexScreener's public API exposes spot pair data only — no OHLCV endpoint —
// so the chart's full history (every candle since pool inception, fetched in
// one request) comes from GeckoTerminal's public OHLCV feed instead. It
// indexes the exact same OTC/SOL pumpswap pool shown on the DexScreener
// chart. The forming candle stays current via DexScreener live ticks in the
// component, so both sources stay in play.

const POOL = "DA4pM4xSDY4M9V4CgAKKBVH1pw1yscTQQa5nEkGHuKpt"; // OTC/SOL on pumpswap
const BASE = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${POOL}/ohlcv`;

// Chart timeframe -> feed request shape.
export const CANDLE_TFS = {
  "15M": { timeframe: "minute", aggregate: 15, limit: 96 },
  "1H": { timeframe: "hour", aggregate: 1, limit: 168 },
  "4H": { timeframe: "hour", aggregate: 4, limit: 42 },
  "1D": { timeframe: "day", aggregate: 1, limit: 30 },
  ALL: { timeframe: "hour", aggregate: 1, limit: 1000 },
};

// Bucket size (ms) of each chart timeframe — used to place live ticks and
// snapshot liquidity markers on the correct candle. ALL is built from 1h
// candles, so its bucket is 1h.
export function tfBucketMs(tf) {
  if (tf === "15M") return 15 * 60 * 1000;
  if (tf === "4H") return 4 * 3600 * 1000;
  if (tf === "1D") return 24 * 3600 * 1000;
  return 3600 * 1000; // 1H and ALL
}

// Short-lived response cache: rapid timeframe/unit toggles don't re-hit the
// feed (public limit is 30 req/min per IP).
const cache = new Map(); // "tf|unit" -> { at, candles }
const TTL = 60 * 1000;

// Fetch the full OHLCV series for a chart timeframe.
// unit "USD" -> prices in USD; "SOL" -> prices in the quote token (SOL).
// Returns candles ascending: [{ t, o, h, l, c, v }].
export async function fetchOtcCandles(tf, unit) {
  const cfg = CANDLE_TFS[tf] || CANDLE_TFS["1H"];
  const key = `${tf}|${unit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.candles;

  const url =
    `${BASE}/${cfg.timeframe}` +
    `?aggregate=${cfg.aggregate}&limit=${cfg.limit}` +
    `&currency=${unit === "SOL" ? "token" : "usd"}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OHLCV feed ${res.status}`);
  const j = await res.json();
  // Rows are newest-first: [unixSec, open, high, low, close, volumeUsd]
  const rows = j?.data?.attributes?.ohlcv_list || [];
  const candles = rows
    .map((r) => ({ t: r[0] * 1000, o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }))
    .sort((a, b) => a.t - b.t);
  if (!candles.length) throw new Error("OHLCV empty");
  cache.set(key, { at: Date.now(), candles });
  return candles;
}

// Fallback when the feed is unreachable: aggregate OHLC from the stored
// 5-minute snapshot history (the pre-feed behavior).
export function buildSnapshotCandles(history, latest, key, tf) {
  const now = Date.now();
  const pts = [];
  for (const h of history || []) {
    const v = parseFloat(h?.[key]);
    const t = new Date(h?.t).getTime();
    if (v > 0 && Number.isFinite(t) && t <= now) pts.push({ t, v });
  }
  const live = parseFloat(latest?.[key]);
  if (live > 0) pts.push({ t: now, v: live });
  pts.sort((a, b) => a.t - b.t);

  let ms;
  let keep;
  if (tf === "ALL") {
    // Adaptive bucket: 15m doubling until the whole history fits in ~96 candles.
    const span = pts.length > 1 ? pts[pts.length - 1].t - pts[0].t : 0;
    ms = 15 * 60 * 1000;
    while (span / ms > 96) ms *= 2;
    keep = Infinity;
  } else {
    ms = tfBucketMs(tf);
    keep = { "15M": 96, "1H": 48, "4H": 42, "1D": 30 }[tf] || 96;
  }

  const map = new Map();
  for (const p of pts) {
    const b = Math.floor(p.t / ms) * ms;
    const c = map.get(b);
    if (!c) map.set(b, { t: b, o: p.v, h: p.v, l: p.v, c: p.v });
    else {
      if (p.v > c.h) c.h = p.v;
      if (p.v < c.l) c.l = p.v;
      c.c = p.v;
    }
  }
  return [...map.values()].sort((a, b) => a.t - b.t).slice(-keep);
}