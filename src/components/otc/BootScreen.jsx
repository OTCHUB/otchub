import React, { useEffect, useRef, useState } from "react";
import { TerminalTopBar, TerminalBottomBar } from "@/components/otc/TerminalBars";

// Session-scoped flag: the boot sequence plays ONCE per browser session —
// reloads and same-session navigation skip straight to the dashboard with a
// quiet spinner, so users never sit through the boot animation twice.
const BOOT_SEEN_KEY = "otc_boot_seen";

export const hasSeenBoot = () => {
  try {
    return window.sessionStorage.getItem(BOOT_SEEN_KEY) === "1";
  } catch {
    return false;
  }
};

// Minimal fixed boot script: a handful of quick lines, no dependency on
// network data — the sequence runs at full speed even while the dashboard
// fetch is still in flight.
const LINES = [
  "OTC_HUB BIOS v2.1.0  (c) 2026 COMMUNITY_TOOLING",
  "Mounting /dev/helius....................... OK",
  "Loading on-chain IDL: otcdesks.cash...... OK",
  "Connecting live market feeds............... OK",
  "Starting dashboard render services........ OK",
  "OTC_HUB ready. Loading interface...",
];

// Block-letter ASCII wordmark (OTC_HUB), 3 rows — pure text, no images.
const WORDMARK = [
  "▄████▄ ██████ ▄█████ ██  ██ ██  ██ █████▄ ",
  "██  ██   ██   ██     ██████ ██  ██ ██▄▄██ ",
  "▀████▀   ██   ▀█████ ██  ██ ▀████▀ ██▄▄█▀ ",
].join("\n");
// Box-drawing banner — same for every screen size, mono-spaced.
const BANNER = [
  "+---------------------------------------------+",
  "|  OTC_ECOSYSTEM_TOOLING :: SOLANA TERMINAL   |",
  "|  CREATED BY HUB_YIELD_OPTIMIZER_PROTOCOL     |",
  "+---------------------------------------------+",
].join("\n");

// ASCII art fitter: the block-letter glyphs (█ ▄ ▀) are NOT guaranteed to be
// exactly one cell wide in every monospace font, so the wordmark/banner can
// measure wider than expected and get clipped off the panel edge. This
// wrapper measures the natural width (scrollWidth ignores transforms) and
// scales the art down to always fit — desktop stays at 1:1.
function FitAscii({ children, className }) {
  const wrapRef = useRef(null);
  const innerRef = useRef(null);
  const [fit, setFit] = useState({ transform: "none", height: undefined });

  useEffect(() => {
    const wrap = wrapRef.current, inner = innerRef.current;
    if (!wrap || !inner) return;
    const measure = () => {
      const natural = inner.scrollWidth;
      const avail = wrap.clientWidth;
      if (!natural || !avail) return;
      const scale = Math.min(1, avail / natural);
      setFit({ transform: `scale(${scale})`, height: `${Math.ceil(inner.offsetHeight * scale)}px` });
    };
    measure();
    if ("ResizeObserver" in window) {
      const ro = new ResizeObserver(measure);
      ro.observe(wrap);
      return () => ro.disconnect();
    }
  }, [children]);

  return (
    <div ref={wrapRef} className="w-full overflow-hidden" style={{ height: fit.height }}>
      <div ref={innerRef} className="origin-left" style={{ transform: fit.transform }}>
        <div className={className}>{children}</div>
      </div>
    </div>
  );
}

export default function BootScreen({ onComplete, ready = true }) {
  const [lines, setLines] = useState([]);
  const [done, setDone] = useState(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      if (i < LINES.length) {
        setLines((prev) => [...prev, LINES[i]]);
        i++;
      } else {
        clearInterval(id);
        setDone(true);
        try {
          window.sessionStorage.setItem(BOOT_SEEN_KEY, "1");
        } catch {
          /* storage unavailable — boot replays next visit */
        }
      }
    }, 25);
    return () => clearInterval(id);
  }, []);

  // Reveal only when the boot script is done AND the caller's data is ready:
  // the dashboard mounts behind the boot screen, so it appears instantly
  // instead of swapping to a blank spinner while the fetch finishes.
  useEffect(() => {
    if (!done || !ready) return;
    const t = setTimeout(() => onCompleteRef.current?.(), 150);
    return () => clearTimeout(t);
  }, [done, ready]);

  // The bar tracks EXACTLY how many of the milestone lines have printed —
  // one line = one step of the sequence, 100% only when the last line is up.
  const progress = Math.max(
    0,
    Math.min(100, Math.round((lines.length / LINES.length) * 100))
  );

  return (
    <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-black pt-[34px] pb-[34px] font-mono text-green-400">
      <TerminalTopBar label="OTC hub boot sequence" />

      {/* Full-screen CRT treatment: scanlines + vignette fill any viewport.
          Dark mode only — index.css (html.light .boot-crt) hides these so the
          phosphor-paper light mode keeps a flat paper background. */}
      <div className="boot-crt pointer-events-none absolute inset-0 z-10 bg-[repeating-linear-gradient(to_bottom,transparent,transparent_2px,rgba(0,255,80,0.025)_3px)]" />
      <div className="boot-crt pointer-events-none absolute inset-0 z-10 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.75))]" />

      {/* Scrollable terminal body: auto margins (not align/justify-center)
          center the block when it fits and collapse to 0 when it overflows,
          so a tall stack scrolls from the very top instead of being clipped
          off-screen. */}
      <div className="relative z-20 flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3 sm:px-8 sm:py-5">
        <div className="mx-auto my-auto w-full max-w-3xl xl:max-w-4xl">
          {/* Strictly text/ASCII/typography — no images, pure CRT boot look. */}
          <FitAscii className="whitespace-pre text-[9px] leading-tight text-green-300 sm:text-[11px]">
            {WORDMARK}
          </FitAscii>
          <div className="mt-2">
            <FitAscii className="whitespace-pre text-[9px] leading-tight text-green-500/70 sm:text-[11px]">
              {BANNER}
            </FitAscii>
          </div>
          <div className="mt-3 space-y-0 text-[11px] leading-relaxed sm:text-[12px]">
            {lines.map((l, idx) => (
              <div key={idx}>
                <span className="text-green-500/50">&gt; </span>
                {l}
              </div>
            ))}
            {!done && <span className="animate-pulse text-green-400">▋</span>}
          </div>
          {done && (
            <div className={`mt-2 ${ready ? "text-emerald-400" : "text-cyan-400"}`}>
              <span className="animate-pulse">▋</span> {ready ? "BOOT_COMPLETE" : "SYNCING_MARKET_DATA"}
            </div>
          )}
        </div>
      </div>

      {/* Boot progress bar: pinned above the fixed footer, always visible and
          in lockstep with the milestone text scrolling above it */}
      <div className="relative z-20 mx-auto w-full max-w-3xl shrink-0 px-4 pb-2 sm:px-8 xl:max-w-4xl">
        <div className="term-window border border-green-500/30 p-1.5">
          <div className="flex items-center justify-between text-[10px] text-green-500/60 sm:text-[11px]">
            <span>BOOT_SEQ</span>
            <span>{progress}%</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden bg-green-500/10">
            <div
              className="h-full max-w-full bg-emerald-400/80 transition-all duration-100"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      <TerminalBottomBar>© 2026 otchub.dev</TerminalBottomBar>
    </div>
  );
}