import React, { useEffect, useMemo, useState } from "react";
import { fmtUsd, fmtCompact } from "@/lib/format";
import {
  CANDLE_TFS,
  tfBucketMs,
  fetchOtcCandles,
  buildSnapshotCandles,
} from "@/lib/dexCandles";

// Mini $OTC candlestick chart for the swap panel. FULL SERIES: candles
// bootstrap from the GeckoTerminal OHLCV feed for the OTC/SOL pumpswap pool
// (the same pair as the DexScreener chart) — the entire history since pool
// inception arrives in one request. The DexScreener live tick keeps the
// forming candle current, and snapshot liquidity deltas still mark +/- events.
//
// `unit` + `onToggleUnit` are owned by the swap panel so the candles chart and
// the recent-trades price column share one USD/SOL toggle.
export default function PriceCandles({ latest, history, unit = "USD", onToggleUnit }) {
  const [tf, setTf] = useState("1H");
  const [series, setSeries] = useState(null); // full OHLCV from the feed
  const [src, setSrc] = useState("LOADING"); // LOADING | FULL | FAILED

  const fmt = (v) => (unit === "USD" ? fmtUsd(v, 5) : `${Number(v).toFixed(7)} ◎`);

  // Fetch the full series whenever the timeframe or unit changes (the unit is
  // a genuinely different series server-side: USD vs quote-token SOL).
  useEffect(() => {
    let dead = false;
    setSrc("LOADING");
    fetchOtcCandles(tf, unit)
      .then((c) => {
        if (!dead) {
          setSeries(c);
          setSrc("FULL");
        }
      })
      .catch(() => {
        if (!dead) setSrc("FAILED");
      });
    return () => {
      dead = true;
    };
  }, [tf, unit]);

  // Roll in freshly closed candles every 5 min; the live tick below keeps the
  // forming candle current in between (the feed's 60s cache absorbs spam).
  useEffect(() => {
    const id = setInterval(() => {
      fetchOtcCandles(tf, unit)
        .then((c) => setSeries(c))
        .catch(() => {});
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [tf, unit]);

  // Closing liquidity per candle bucket (drives the +/- liq markers).
  const liqByBucket = useMemo(() => {
    const ms = tfBucketMs(tf);
    const m = new Map();
    for (const h of history || []) {
      const liq = parseFloat(h?.token_liquidity_usd);
      const t = new Date(h?.t).getTime();
      if (!Number.isFinite(liq) || !Number.isFinite(t)) continue;
      const b = Math.floor(t / ms) * ms;
      const cur = m.get(b);
      if (!cur || t > cur.t) m.set(b, { t, liq });
    }
    return m;
  }, [history, tf]);

  const candles = useMemo(() => {
    const key = unit === "USD" ? "token_price_usd" : "token_price_sol";
    let base = null;
    if (src === "FULL" && series?.length) base = series;
    else if (src === "FAILED")
      base = buildSnapshotCandles(history, latest, key, tf); // feed offline -> old snapshot aggregation
    if (!base?.length) return [];

    const out = base.map((c) => ({ ...c, lc: liqByBucket.get(c.t)?.liq ?? null }));

    // Live DexScreener tick keeps the forming (right-most) candle current.
    const live = parseFloat(latest?.[key]);
    if (live > 0) {
      const ms = tfBucketMs(tf);
      const b = Math.floor(Date.now() / ms) * ms;
      const last = out[out.length - 1];
      if (last && b === last.t) {
        last.c = live;
        if (live > last.h) last.h = live;
        if (live < last.l) last.l = live;
      } else if (!last || b > last.t) {
        out.push({ t: b, o: live, h: live, l: live, c: live, lc: null });
      }
    }
    return out;
  }, [series, src, history, latest, tf, unit, liqByBucket]);

  const scale = useMemo(() => {
    if (candles.length < 2) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of candles) {
      if (c.l < lo) lo = c.l;
      if (c.h > hi) hi = c.h;
    }
    const pad = Math.max((hi - lo) * 0.1, hi * 0.005);
    lo -= pad;
    hi += pad;
    const span = hi - lo || 1;
    return {
      lo,
      hi,
      y: (p) => 100 - ((p - lo) / span) * 100,
    };
  }, [candles]);

  // Liquidity add/remove events: a candle whose closing liquidity moved more
  // than 0.5% vs the previous candle gets a marker (+ add / − remove).
  const liqMarkers = useMemo(() => {
    const out = [];
    const THRESH = 0.005;
    for (let i = 1; i < candles.length; i++) {
      const cur = candles[i];
      const prev = candles[i - 1];
      if (cur.lc == null || prev.lc == null || !prev.lc) continue;
      const d = cur.lc - prev.lc;
      if (Math.abs(d) / prev.lc < THRESH) continue;
      out.push({ i, add: d > 0, delta: d });
    }
    return out;
  }, [candles]);

  const last = candles[candles.length - 1] || null;
  const up = last ? last.c >= last.o : true;

  return (
    <div className="mt-2 border border-green-500/20">
      {/* Header: timeframe + unit controls */}
      <div className="flex flex-wrap items-center justify-between gap-1 border-b border-green-500/20 px-2 py-1">
        <span className="text-[9px] uppercase tracking-widest text-green-500/50">
          $OTC :: PRICE_CANDLES
        </span>
        <div className="flex items-center gap-1">
          {Object.keys(CANDLE_TFS).map((id) => (
            <button
              key={id}
              onClick={() => setTf(id)}
              className={`border px-1.5 py-0.5 font-mono text-[9px] ${
                tf === id
                  ? "border-emerald-500/60 text-emerald-400"
                  : "border-green-500/30 text-green-500/60 hover:border-emerald-500/40"
              }`}
            >
              [{id}]
            </button>
          ))}
          <button
            onClick={() => onToggleUnit && onToggleUnit()}
            className="border border-cyan-400/40 px-1.5 py-0.5 font-mono text-[9px] text-cyan-300 hover:border-cyan-400/70"
          >
            {unit === "USD" ? "$USD" : "◎SOL"}
          </button>
        </div>
      </div>

      {/* Plot */}
      <div className="relative h-24 w-full">
        {scale && candles.length >= 2 ? (
          <>
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              {/* Horizontal grid */}
              {[25, 50, 75].map((y) => (
                <line
                  key={y}
                  x1="0"
                  x2="100"
                  y1={y}
                  y2={y}
                  className="stroke-green-500/10"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {/* Candles */}
              {candles.map((c, i) => {
                const isUp = c.c >= c.o;
                const x = ((i + 0.5) / candles.length) * 100;
                const w = Math.max((100 / candles.length) * 0.6, 0.8);
                const yH = scale.y(c.h);
                const yL = scale.y(c.l);
                const yO = scale.y(c.o);
                const yC = scale.y(c.c);
                return (
                  <g key={c.t}>
                    <line
                      x1={x}
                      x2={x}
                      y1={yH}
                      y2={yL}
                      className={isUp ? "stroke-green-400/80" : "stroke-red-400/70"}
                      strokeWidth="1"
                      vectorEffect="non-scaling-stroke"
                    />
                    <rect
                      x={x - w / 2}
                      width={w}
                      y={Math.min(yO, yC)}
                      height={Math.max(0.6, Math.abs(yO - yC))}
                      className={isUp ? "fill-green-400/70" : "fill-red-400/70"}
                    />
                  </g>
                );
              })}
              {/* Last price line */}
              <line
                x1="0"
                x2="100"
                y1={scale.y(last.c)}
                y2={scale.y(last.c)}
                className={up ? "stroke-green-400/50" : "stroke-red-400/50"}
                strokeWidth="1"
                strokeDasharray="2 2"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {/* Price labels */}
            <div className="pointer-events-none absolute left-1 top-0.5 font-mono text-[8px] text-green-500/50">
              HI {fmt(scale.hi)}
            </div>
            <div className="pointer-events-none absolute bottom-0.5 left-1 font-mono text-[8px] text-green-500/50">
              LO {fmt(scale.lo)}
            </div>
            <div
              className={`pointer-events-none absolute right-1 border px-1 font-mono text-[8px] ${
                up
                  ? "border-green-500/40 bg-black/80 text-green-400"
                  : "border-red-400/40 bg-black/80 text-red-400"
              }`}
              style={{ top: `calc(${Math.min(94, Math.max(0, scale.y(last.c)))}% - 6px)` }}
            >
              {fmt(last.c)}
            </div>
            {/* Liquidity add/remove markers (from snapshot liquidity deltas) */}
            {liqMarkers.map((m) => (
              <div
                key={m.i}
                title={`LIQ ${m.add ? "ADD" : "REMOVE"} :: $${fmtCompact(Math.abs(m.delta))}`}
                className={`absolute top-0 -translate-x-1/2 border bg-black/80 px-0.5 font-mono text-[7px] font-bold ${
                  m.add
                    ? "border-cyan-400/60 text-cyan-300"
                    : "border-amber-400/60 text-amber-300"
                }`}
                style={{ left: `${((m.i + 0.5) / candles.length) * 100}%` }}
              >
                {m.add ? "+" : "−"}
              </div>
            ))}
          </>
        ) : (
          <div className="flex h-full items-center justify-center font-mono text-[9px] text-green-500/40">
            {src === "LOADING"
              ? "BOOTSTRAPPING :: FETCHING FULL OHLCV SERIES…"
              : "FEED OFFLINE :: WAITING FOR SNAPSHOT DATA…"}
          </div>
        )}
      </div>

      {/* Series + liq-marker note (single compact line) */}
      <div className="border-t border-green-500/10 px-2 py-0.5 font-mono text-[8px] text-green-500/40">
        {candles.length} {tf} CANDLE(S) ·{" "}
        {src === "FULL"
          ? "FULL HISTORY :: GECKOTERMINAL"
          : src === "FAILED"
          ? "FEED OFFLINE :: SNAPSHOT"
          : "FETCHING…"}
        {" · LIQ "}
        <span className="text-cyan-400">+ADD</span>/<span className="text-amber-400">−RMV</span>
        {liqMarkers.length > 0 && ` (${liqMarkers.length})`}
      </div>
    </div>
  );
}