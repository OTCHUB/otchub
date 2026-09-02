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

  return (
    <div className="flex min-h-screen flex-col justify-center bg-black px-4 py-6 font-mono text-green-400 sm:px-8 sm:py-10">
      <div className="mx-auto w-full max-w-3xl">
        <div className="whitespace-pre text-[9px] leading-tight text-green-500/70 sm:text-[11px]">
          {HEADER.join("\n")}
        </div>
        <div className="mt-3 space-y-0 text-[10px] leading-relaxed sm:text-xs">
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
  );
}