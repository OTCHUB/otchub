import React, { useEffect, useMemo, useRef, useState } from "react";
import { fmtUsd } from "@/lib/format";
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
// forming candle current.
//
// INTERACTIVE VIEWPORT: pinch (touch) / wheel (desktop) zoom, one-finger or
// mouse drag to pan back through history, hover/tap crosshair with an
// OHLC readout, and [−]/[+] zoom buttons with [FIT] to reset. The price
// scale always fits the visible window, so zooming in also resolves detail.
//
// `unit` + `onToggleUnit` are owned by the swap panel so the candles chart and
// the recent-trades price column share one USD/SOL toggle.
export default function PriceCandles({ latest, history, unit = "USD", onToggleUnit }) {
  const [tf, setTf] = useState("1H");
  const [series, setSeries] = useState(null); // full OHLCV from the feed
  const [src, setSrc] = useState("LOADING"); // LOADING | FULL | FAILED
  // Zoom/pan window: `visible` = candles shown (null = all), `offR` = how far
  // the window is scrolled back from the newest candle (0 = right-aligned).
  const [visible, setVisible] = useState(null);
  const [offR, setOffR] = useState(0);
  const [inspect, setInspect] = useState(null); // candle index under crosshair
  const plotRef = useRef(null);
  const pointers = useRef(new Map());
  const gesture = useRef(null);

  const fmt = (v) => (unit === "USD" ? fmtUsd(v, 5) : `${Number(v).toFixed(7)} ◎`);

  // Fetch the full series whenever the timeframe or unit changes (the unit is
  // a genuinely different series server-side: USD vs quote-token SOL). A new
  // series resets the zoom window to the full fit.
  useEffect(() => {
    let dead = false;
    setSrc("LOADING");
    setVisible(null);
    setOffR(0);
    setInspect(null);
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

  const candles = useMemo(() => {
    const key = unit === "USD" ? "token_price_usd" : "token_price_sol";
    let base = null;
    if (src === "FULL" && series?.length) base = series;
    else if (src === "FAILED")
      base = buildSnapshotCandles(history, latest, key, tf); // feed offline -> old snapshot aggregation
    if (!base?.length) return [];

    // Copy before the live tick so the fetched series state is never mutated.
    const out = base.map((c) => ({ ...c }));
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
        out.push({ t: b, o: live, h: live, l: live, c: live });
      }
    }
    return out;
  }, [series, src, history, latest, tf, unit]);

  // ---- Viewport math (clamped on every render so data refreshes stay sane)
  const total = candles.length;
  const vis = visible == null ? total : Math.min(Math.max(2, Math.round(visible)), total);
  const maxOff = Math.max(0, total - vis);
  const effOffR = Math.min(Math.max(0, Math.round(offR)), maxOff);
  const start = total - vis - effOffR;
  const view = candles.slice(start, start + vis);

  const zoomBy = (factor) => {
    if (total < 2) return;
    const newVis = Math.min(Math.max(2, Math.round(vis * factor)), total);
    setVisible(newVis >= total ? null : newVis);
    setOffR((o) => Math.min(Math.max(0, Math.round(o)), Math.max(0, total - newVis)));
    setInspect(null);
  };
  const resetView = () => {
    setVisible(null);
    setOffR(0);
    setInspect(null);
  };

  // ---- Pointer gestures: 1 finger / mouse = pan (tap or hover = inspect),
  // 2 fingers = pinch zoom. touch-none keeps the browser out of the gesture.
  const idxAtX = (clientX) => {
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.min(Math.max(0, (clientX - rect.left) / rect.width), 0.999);
  };

  const onPointerDown = (e) => {
    plotRef.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 1) {
      gesture.current = { mode: "pan", x: e.clientX, startOffR: effOffR, moved: false, type: e.pointerType };
    } else if (pts.length === 2) {
      setInspect(null);
      gesture.current = {
        mode: "pinch",
        dist: Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
        startVis: vis,
      };
    }
  };

  const onPointerMove = (e) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) {
      if (e.pointerType === "mouse") setInspect(start + Math.floor(idxAtX(e.clientX) * vis));
      return;
    }
    if (g.mode === "pan" && pointers.current.size === 1) {
      const rect = plotRef.current?.getBoundingClientRect();
      if (!rect) return;
      const shift = Math.round(((e.clientX - g.x) / rect.width) * vis);
      if (shift !== 0) {
        g.moved = true;
        setInspect(null);
      }
      setOffR(Math.min(Math.max(0, g.startOffR + shift), Math.max(0, total - vis)));
    } else if (g.mode === "pinch" && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const newVis = Math.min(Math.max(2, Math.round(g.startVis * (g.dist / dist))), total);
      setVisible(newVis >= total ? null : newVis);
      setOffR((o) => Math.min(Math.max(0, Math.round(o)), Math.max(0, total - newVis)));
    }
  };

  const onPointerUp = (e) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      gesture.current = null;
      // A tap (no drag) toggles the crosshair on the touched candle.
      if (g?.mode === "pan" && !g.moved && g.type !== "mouse") {
        const i = start + Math.floor(idxAtX(e.clientX) * vis);
        setInspect(inspect === i ? null : i);
      }
    } else if (pointers.current.size === 1) {
      // Pinch ended with one finger still down: restart as a pan from here.
      const [p] = [...pointers.current.values()];
      gesture.current = { mode: "pan", x: p.x, startOffR: effOffR, moved: true, type: e.pointerType };
    }
  };

  // Wheel zoom anchored at the cursor's candle (desktop). Native listener so
  // preventDefault works (React's onWheel is passive).
  useEffect(() => {
    const el = plotRef.current;
    if (!el || total < 2) return;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const r = Math.min(Math.max(0, (e.clientX - rect.left) / rect.width), 0.999);
      const idx = start + r * vis;
      const factor = e.deltaY > 0 ? 1.25 : 0.8;
      const newVis = Math.min(Math.max(2, Math.round(vis * factor)), total);
      const newOffR = Math.min(
        Math.max(0, Math.round(total - newVis - (idx - r * newVis))),
        Math.max(0, total - newVis)
      );
      setVisible(newVis >= total ? null : newVis);
      setOffR(newOffR);
      setInspect(null);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const scale = useMemo(() => {
    if (view.length < 2) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of view) {
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
  }, [view]);

  const last = candles[total - 1] || null;
  const up = last ? last.c >= last.o : true;
  const atRightEdge = effOffR === 0;
  const inspectCandle = inspect != null && inspect >= start && inspect < start + vis ? candles[inspect] : null;
  const inspectVi = inspectCandle ? inspect - start : 0;
  const inspectX = ((inspectVi + 0.5) / vis) * 100;

  return (
    <div className="mt-2 border border-green-500/20">
      {/* Header: timeframe + zoom + unit controls */}
      <div className="flex flex-wrap items-center justify-between gap-1 border-b border-green-500/20 px-2 py-1">
        <span className="text-[11px] uppercase tracking-widest text-green-500/50">
          $OTC :: PRICE_CANDLES
        </span>
        <div className="flex items-center gap-1">
          {Object.keys(CANDLE_TFS).map((id) => (
            <button
              key={id}
              onClick={() => setTf(id)}
              className={`border px-1.5 py-0.5 font-mono text-[11px] ${
                tf === id
                  ? "border-emerald-500/60 text-emerald-400"
                  : "border-green-500/30 text-green-500/60 hover:border-emerald-500/40"
              }`}
            >
              [{id}]
            </button>
          ))}
          <button
            onClick={() => zoomBy(1.6)}
            disabled={total < 3 || vis <= 2}
            title="Zoom out (show more candles)"
            className="border border-green-500/30 px-1.5 py-0.5 font-mono text-[11px] text-green-500/60 hover:border-emerald-500/40 disabled:opacity-30"
          >
            [−]
          </button>
          <button
            onClick={() => zoomBy(1 / 1.6)}
            disabled={total < 3 || vis >= total}
            title="Zoom in (show fewer candles)"
            className="border border-green-500/30 px-1.5 py-0.5 font-mono text-[11px] text-green-500/60 hover:border-emerald-500/40 disabled:opacity-30"
          >
            [+]
          </button>
          <button
            onClick={resetView}
            disabled={visible == null && effOffR === 0}
            title="Fit full history"
            className="border border-green-500/30 px-1.5 py-0.5 font-mono text-[11px] text-green-500/60 hover:border-emerald-500/40 disabled:opacity-30"
          >
            [FIT]
          </button>
          <button
            onClick={() => onToggleUnit && onToggleUnit()}
            className="border border-cyan-400/40 px-1.5 py-0.5 font-mono text-[11px] text-cyan-300 hover:border-cyan-400/70"
          >
            {unit === "USD" ? "$USD" : "◎SOL"}
          </button>
        </div>
      </div>

      {/* Plot: interactive viewport (pinch zoom · drag pan · hover/tap inspect) */}
      <div
        ref={plotRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse" && !gesture.current) setInspect(null);
        }}
        // touch-pan-y: vertical swipes still scroll the page (the chart never
        // traps scroll on mobile); horizontal drag pans and two-finger pinch
        // stays ours to zoom.
        className="relative h-32 w-full touch-pan-y select-none cursor-crosshair"
      >
        {scale && view.length >= 2 ? (
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
              {/* Candles (visible window only) */}
              {view.map((c, i) => {
                const isUp = c.c >= c.o;
                const x = ((i + 0.5) / vis) * 100;
                const w = Math.max((100 / vis) * 0.6, 0.8);
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
              {/* Last price line (only while the newest candle is in view) */}
              {atRightEdge && last && (
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
              )}
              {/* Crosshair */}
              {inspectCandle && (
                <line
                  x1={inspectX}
                  x2={inspectX}
                  y1="0"
                  y2="100"
                  className="stroke-cyan-400/50"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>
            {/* Price labels */}
            <div className="pointer-events-none absolute left-1 top-0.5 font-mono text-[10px] text-green-500/50">
              HI {fmt(scale.hi)}
            </div>
            <div className="pointer-events-none absolute bottom-0.5 left-1 font-mono text-[10px] text-green-500/50">
              LO {fmt(scale.lo)}
            </div>
            {atRightEdge && last && (
              <div
                className={`pointer-events-none absolute right-1 border px-1 font-mono text-[10px] ${
                  up
                    ? "border-green-500/40 bg-black/80 text-green-400"
                    : "border-red-400/40 bg-black/80 text-red-400"
                }`}
                style={{ top: `calc(${Math.min(94, Math.max(0, scale.y(last.c)))}% - 6px)` }}
              >
                {fmt(last.c)}
              </div>
            )}
            {/* Inspected candle readout */}
            {inspectCandle && (
              <div className="pointer-events-none absolute left-1 bottom-4 border border-cyan-400/40 bg-black/90 px-1.5 py-0.5 font-mono text-[10px] leading-tight text-cyan-300">
                <div className="text-green-500/50">{new Date(inspectCandle.t).toLocaleString()}</div>
                <div>
                  O {fmt(inspectCandle.o)} · H {fmt(inspectCandle.h)}
                </div>
                <div>
                  L {fmt(inspectCandle.l)} · C {fmt(inspectCandle.c)}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center font-mono text-[11px] text-green-500/40">
            {src === "LOADING"
              ? "BOOTSTRAPPING :: FETCHING FULL OHLCV SERIES…"
              : "FEED OFFLINE :: WAITING FOR SNAPSHOT DATA…"}
          </div>
        )}
      </div>

      {/* Series + interaction note (single compact line) */}
      <div className="border-t border-green-500/10 px-2 py-0.5 font-mono text-[10px] text-green-500/40">
        {view.length}/{total} {tf} CANDLE(S) IN VIEW ·{" "}
        {src === "FULL"
          ? "FULL HISTORY :: GECKOTERMINAL"
          : src === "FAILED"
          ? "FEED OFFLINE :: SNAPSHOT"
          : "FETCHING…"}
        {" · PINCH/WHEEL ZOOM · DRAG PAN · TAP/HOVER OHLC"}
      </div>
    </div>
  );
}