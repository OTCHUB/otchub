import React, { useEffect, useState } from "react";

const BOOT_LINES = [
  "OTC_HUB BIOS v2.1.0  (c) 2026 COMMUNITY_TOOLING",
  "Performing power-on self test.................. OK",
  "CPU: Solana RPC node  ·  latency 400ms",
  "Memory: 640KB conventional / 65536KB extended",
  "Detecting connected wallets................... PHANTOM SOLFLARE BACKPACK JUPITER",
  "Mounting /dev/helius....................... OK",
  "Loading on-chain IDL: otcdesks.cash program...... OK",
  "Initializing DAS asset resolver................ OK",
  "Connecting DexScreener spot feed............... OK",
  "Connecting Magic Eden marketplace.............. OK",
  "Resolving OTC token mint 8d3L.................. OK",
  "Fetching pot treasury balance.................. OK",
  "Indexing 2125 OTC desk NFTs.................... OK",
  "Computing accrued stock holdings.............. OK",
  "Calculating mint vs secondary arbitrage....... OK",
  "Calibrating 2% taker fee + 5% royalty.......... OK",
  "Synchronizing 5-min snapshot workflow.......... OK",
  "Compiling holdings gallery (LISTED/STOCK/SNIPE) OK",
  "Warming wallet claim + swap signers........... OK",
  "Starting dashboard render services............ OK",
  "",
  "OTC_HUB ready. Loading interface...",
];

const HEADER = [
  "+---------------------------------------------+",
  "|  OTC_HUB :: SOLANA ANALYTICS TERMINAL        |",
  "|  COMMUNITY_TOOLING - NOT OFFICIAL            |",
  "+---------------------------------------------+",
];

export default function BootScreen({ onComplete }) {
  const [lines, setLines] = useState([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      if (i < BOOT_LINES.length) {
        setLines((prev) => [...prev, BOOT_LINES[i]]);
        i++;
      } else {
        clearInterval(id);
        setDone(true);
        setTimeout(() => onComplete?.(), 700);
      }
    }, 170);
    return () => clearInterval(id);
  }, [onComplete]);

  return (
    <div className="flex min-h-screen flex-col justify-center bg-black px-4 py-6 font-mono text-green-400 sm:px-8 sm:py-10">
      <div className="mx-auto w-full max-w-3xl">
        <div className="whitespace-pre text-[9px] leading-tight text-green-500/70 sm:text-[11px]">
          {HEADER.join("\n")}
        </div>
        <div className="mt-3 space-y-0 text-[10px] leading-relaxed sm:text-xs">
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
          {!done && <span className="animate-pulse text-green-400">▋</span>}
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