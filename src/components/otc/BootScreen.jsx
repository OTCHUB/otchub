import React, { useEffect, useMemo, useState } from "react";
import { fetchDashboardBody } from "@/lib/dashboardFeed";
import { fmtNum, fmtSol, fmtUsd, fmtPct } from "@/lib/format";
import { TerminalTopBar, TerminalBottomBar } from "@/components/otc/TerminalBars";
import { getStoredSkin } from "@/lib/theme";

const HEADER = [
  "+---------------------------------------------+",
  "|  OTC_ECOSYSTEM_TOOLING :: SOLANA TERMINAL   |",
  "|  CREATED BY HUB_YIELD_OPTIMIZER_PROTOCOL     |",
  "+---------------------------------------------+",
];

function buildLines(data) {
  const snap = data?.latest;
  const tge = snap?.token_tge_supply ?? 1_000_000_000;
  const supply = snap?.token_total_supply;
  const burnt = snap?.token_burnt ?? (supply != null ? tge - supply : null);
  const burntPct = burnt != null ? (burnt / tge) * 100 : null;
  return [
    "OTC_HUB BIOS v2.1.0  (c) 2026 COMMUNITY_TOOLING",
    "Performing power-on self test.................. OK",
    "Mounting /dev/helius....................... OK",
    "Loading on-chain IDL: otcdesks.cash program...... OK",
    "Initializing DAS asset resolver................ OK",
    "Connecting DexScreener spot feed............... OK",
    "Connecting Magic Eden marketplace.............. OK",
    "Resolving OTC token mint MukLDtJ8...udpump..... OK",
    `Fetching pot treasury balance.................. ${snap ? "OK" : "WAIT"}`,
    `Querying snapshot database..................... ${data?.snapshot_count ?? 0} rows`,
    `Indexing ${fmtNum(snap?.nft_total_supply ?? snap?.desks_minted ?? 0)} OTC desk NFTs.............. OK`,
    `OTC supply ${fmtNum(supply)} · burnt ${fmtNum(burnt)} (${fmtPct(burntPct)})`,
    `Desks minted ${fmtNum(snap?.desks_minted)} / 5000 · listed ${fmtNum(snap?.nft_listed_count)}`,
    `SOL ${fmtUsd(snap?.sol_price_usd)} · OTC ${fmtUsd(snap?.token_price_usd, 5)}`,
    `Pot balance ${fmtSol(snap?.pot_sol_balance)} SOL`,
    "Computing accrued stock holdings.............. OK",
    "Calculating mint vs secondary arbitrage....... OK",
    "Calibrating 2% taker fee + 5% royalty.......... OK",
    "Synchronizing 5-min snapshot workflow.......... OK",
    "Starting dashboard render services............ OK",
    "",
    "OTC_HUB ready. Loading interface...",
  ];
}

export default function BootScreen({ onComplete }) {
  const [lines, setLines] = useState([]);
  const [done, setDone] = useState(false);
  const [data, setData] = useState(null);
  // Boot-time skin: the modern skin renders a sans hero instead of the
  // ASCII banner, so the boot sequence is fully converted too.
  const [skin] = useState(getStoredSkin);

  useEffect(() => {
    let cancelled = false;
    fetchDashboardBody()
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch(() => {
        if (!cancelled) setData({ offline: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const built = useMemo(() => (data ? buildLines(data) : null), [data]);

  useEffect(() => {
    if (!built) return;
    let i = 0;
    const id = setInterval(() => {
      if (i < built.length) {
        setLines((prev) => [...prev, built[i]]);
        i++;
      } else {
        clearInterval(id);
        setDone(true);
        setTimeout(() => onComplete?.(), 250);
      }
    }, 45);
    return () => clearInterval(id);
  }, [built, onComplete]);

  // The bar tracks EXACTLY how many of the milestone lines have printed —
  // one line = one step of the sequence, 100% only when the last line is up.
  const progress = built?.length
    ? Math.max(0, Math.min(100, Math.round((lines.length / built.length) * 100)))
    : 0;

  return (
    <div className="skin-stage relative flex h-[100dvh] w-full flex-col overflow-hidden bg-black pt-[34px] pb-[34px] font-mono text-green-400">
      <TerminalTopBar label="OTC hub boot sequence" />

      {/* Full-screen CRT treatment: scanlines + vignette fill any viewport. */}
      <div className="boot-crt pointer-events-none absolute inset-0 z-10 bg-[repeating-linear-gradient(to_bottom,transparent,transparent_2px,rgba(0,255,80,0.025)_3px)]" />
      <div className="boot-crt pointer-events-none absolute inset-0 z-10 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.75))]" />

      {/* Scrollable terminal body: stays inside the viewport on every screen */}
      <div className="relative z-20 flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-3 sm:px-8 sm:py-5">
        <div className="w-full max-w-3xl xl:max-w-4xl">
          {skin === "modern" ? (
            <div className="text-left sm:text-center">
              <div className="font-display text-2xl font-bold uppercase tracking-[0.22em] text-green-300 sm:text-4xl">
                OTC_HUB
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-[0.3em] text-green-500/60 sm:text-[12px]">
                OTC ecosystem tooling · created by Hub Yield Optimizer Protocol
              </div>
            </div>
          ) : (
            <div className="whitespace-pre text-[9px] leading-tight text-green-500/70 sm:text-[11px]">
              {HEADER.join("\n")}
            </div>
          )}
          <div className="mt-3 space-y-0 text-[11px] leading-relaxed sm:text-[12px]">
            {!data && (
              <div>
                <span className="text-green-500/50">&gt; </span>
                <span className="animate-pulse">Querying OTC_HUB database...</span>
              </div>
            )}
            {lines.map((l, idx) =>
              l === "" ? (
                <div key={idx} className="h-2" />
              ) : (
                <div key={idx}>
                  <span className="text-green-500/50">&gt; </span>
                  {l}
                </div>
              )
            )}
            {!done && data && <span className="animate-pulse text-green-400">▋</span>}
          </div>
          {done && (
            <div className="mt-2 text-emerald-400">
              <span className="animate-pulse">▋</span> BOOT_COMPLETE
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
              className="h-full max-w-full bg-green-500/60 transition-all duration-100"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      <TerminalBottomBar>Community tooling · not affiliated with otcdesks.cash</TerminalBottomBar>
    </div>
  );
}