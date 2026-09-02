import React, { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { fmtNum, fmtSol, fmtUsd, fmtPct } from "@/lib/format";

const HEADER = [
  "+---------------------------------------------+",
  "|  OTC_HUB :: SOLANA ANALYTICS TERMINAL        |",
  "|  COMMUNITY_TOOLING - NOT OFFICIAL            |",
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

  useEffect(() => {
    let cancelled = false;
    base44.functions
      .invoke("getOtcDashboard", {})
      .then((res) => {
        if (!cancelled) setData(res.data);
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

  // Clamp to exactly 0–100 so the bar can never overflow its frame and always
  // finishes at 100% when the boot sequence completes.
  const progress = built?.length
    ? Math.max(0, Math.min(100, Math.round((lines.length / built.length) * 100)))
    : 0;

  return (
    <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-black font-mono text-green-400">
      {/* Full-screen CRT treatment: scanlines + vignette fill any viewport */}
      <div className="pointer-events-none absolute inset-0 z-10 bg-[repeating-linear-gradient(to_bottom,transparent,transparent_2px,rgba(0,255,80,0.025)_3px)]" />
      <div className="pointer-events-none absolute inset-0 z-10 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.75))]" />

      {/* Status bar frames the top of the screen */}
      <div className="relative z-20 flex items-center justify-between border-b border-green-500/20 px-3 py-1.5 text-[9px] text-green-500/60 sm:px-6 sm:text-[10px]">
        <span>TTY1 :: OTC_HUB_BOOT_SEQUENCE</span>
        <span className="flex items-center gap-1.5 text-emerald-400">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          MAINNET_LINK_ACTIVE
        </span>
      </div>

      <div className="relative z-20 flex flex-1 items-center justify-center overflow-y-auto px-4 py-6 sm:px-8 sm:py-10">
        <div className="w-full max-w-3xl xl:max-w-4xl">
          <div className="whitespace-pre text-[8px] leading-tight text-green-500/70 sm:text-[11px] xl:text-[13px]">
            {HEADER.join("\n")}
          </div>
          <div className="mt-3 space-y-0 text-[10px] leading-relaxed sm:text-xs xl:text-sm">
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
          {/* Boot progress bar */}
          <div className="mt-3 border border-green-500/30 p-1.5">
            <div className="flex items-center justify-between text-[9px] text-green-500/60">
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
      </div>

      {/* Status bar frames the bottom of the screen */}
      <div className="relative z-20 border-t border-green-500/20 px-3 py-1.5 text-center text-[9px] text-green-500/40 sm:text-[10px]">
        COMMUNITY_TOOLING :: NOT AFFILIATED WITH OTCDESKS.CASH
      </div>
    </div>
  );
}