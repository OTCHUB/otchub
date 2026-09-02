import React, { useMemo, useState } from "react";
import { fmtUsd, fmtCompact } from "@/lib/format";

// Mini $OTC candlestick chart for the swap panel. BOOTSTRAP PHASE: candles
// are aggregated (open/high/low/close) from the stored 5-minute snapshot
// history — no OHLC feed exists yet, so depth grows as snapshots accumulate
// (~288/day). The latest live price tick keeps the forming candle current.
const TFS = [
  { id: "15M", ms: 15 * 60 * 1000, keep: 96 },
  { id: "1H", ms: 3600 * 1000, keep: 48 },
  { id: "4H", ms: 4 * 3600 * 1000, keep: 42 },
  { id: "1D", ms: 24 * 3600 * 1000, keep: 30 },
  { id: "ALL", ms: 0, keep: Infinity }, // adaptive bucket, keeps the full history
];

// `unit` + `onToggleUnit` are owned by the swap panel so the candles chart and
// the recent-trades price column share one USD/SOL toggle.
export default function PriceCandles({ latest, history, unit = "USD", onToggleUnit }) {
  const [tf, setTf] = useState("1H");

  const fmt = (v) => (unit === "USD" ? fmtUsd(v, 5) : `${Number(v).toFixed(7)} ◎`);

  const { candles, snapCount } = useMemo(() => {
    const key = unit === "USD" ? "token_price_usd" : "token_price_sol";
    const now = Date.now();
    const pts = [];
    let snapCount = 0;
    for (const h of history || []) {
      const v = parseFloat(h?.[key]);
      const t = new Date(h?.t).getTime();
      const liq = parseFloat(h?.token_liquidity_usd);
      if (v > 0 && Number.isFinite(t) && t <= now) {
        pts.push({ t, v, liq: Number.isFinite(liq) ? liq : null });
        snapCount++;
      }
    }
    // Live tick keeps the forming (right-most) candle current between snapshots
    const live = parseFloat(latest?.[key]);
    if (live > 0) {
      const liveLiq = parseFloat(latest?.token_liquidity_usd);
      pts.push({ t: now, v: live, liq: Number.isFinite(liveLiq) ? liveLiq : null });
    }
    pts.sort((a, b) => a.t - b.t);

    // ALL: adaptive bucket — start at 15m and double until the whole history
    // fits in ~96 candles, so every snapshot since inception stays visible.
    let ms;
    let keep;
    if (tf === "ALL") {
      const span = pts.length > 1 ? pts[pts.length - 1].t - pts[0].t : 0;
      ms = 15 * 60 * 1000;
      while (span / ms > 96) ms *= 2;
      keep = Infinity;
    } else {
      ({ ms, keep } = TFS.find((o) => o.id === tf) || TFS[0]);
    }
    const map = new Map();
    for (const p of pts) {
      const b = Math.floor(p.t / ms) * ms;
      const c = map.get(b);
      if (!c) map.set(b, { t: b, o: p.v, h: p.v, l: p.v, c: p.v, lo: p.liq, lc: p.liq });
      else {
        if (p.v > c.h) c.h = p.v;
        if (p.v < c.l) c.l = p.v;
        c.c = p.v;
        if (p.liq != null) c.lc = p.liq;
      }
    }
    const candles = [...map.values()].sort((a, b) => a.t - b.t).slice(-keep);
    return { candles, snapCount };
  }, [history, latest, tf, unit]);

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
          {TFS.map((o) => (
            <button
              key={o.id}
              onClick={() => setTf(o.id)}
              className={`border px-1.5 py-0.5 font-mono text-[9px] ${
                tf === o.id
                  ? "border-emerald-500/60 text-emerald-400"
                  : "border-green-500/30 text-green-500/60 hover:border-emerald-500/40"
              }`}
            >
              [{o.id}]
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
      <div className="relative h-32 w-full">
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
                      className={isUp ? "stroke-emerald-400/70" : "stroke-red-400/70"}
                      strokeWidth="1"
                      vectorEffect="non-scaling-stroke"
                    />
                    <rect
                      x={x - w / 2}
                      width={w}
                      y={Math.min(yO, yC)}
                      height={Math.max(0.6, Math.abs(yO - yC))}
                      className={isUp ? "fill-emerald-500/80" : "fill-red-500/80"}
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
                className={up ? "stroke-emerald-400/50" : "stroke-red-400/50"}
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
                  ? "border-emerald-500/40 bg-black/80 text-emerald-400"
                  : "border-red-500/40 bg-black/80 text-red-400"
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
            BUILDING CANDLES :: WAITING FOR SNAPSHOT DATA…
          </div>
        )}
      </div>

      {/* Bootstrap note */}
      <div className="border-t border-green-500/10 px-2 py-1 font-mono text-[8px] text-green-500/40">
        BOOTSTRAP :: {candles.length} {tf} CANDLE(S) · {snapCount} SNAPSHOTS · DEPTH GROWS OVER TIME
      </div>
      <div className="border-t border-green-500/10 px-2 pb-1 font-mono text-[8px] text-green-500/40">
        LIQ_MARKERS :: <span className="text-cyan-400">+ ADD</span> /{" "}
        <span className="text-amber-400">− REMOVE</span> · SNAPSHOT LIQ Δ &gt; 0.5%
        {liqMarkers.length > 0 && ` · ${liqMarkers.length} EVENT(S)`}
      </div>
    </div>
  );
}