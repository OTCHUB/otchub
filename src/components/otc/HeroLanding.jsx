import React, { useState } from "react";
import { ArrowDown, ArrowLeftRight, Check, Coins, Copy, DollarSign, Flame, Gem, HandCoins, LineChart } from "lucide-react";
import MascotLogo from "@/components/otc/MascotLogo";
import HeroRewardStats from "@/components/otc/HeroRewardStats";
import { fmtNum, fmtSol, fmtUsd } from "@/lib/format";

const OTC_MINT = "MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump";
const DEX_URL = `https://dexscreener.com/solana/${OTC_MINT}`;
const DESK_CAP = 5000;

// Headline + feature stats read live from the latest snapshot. $HUB twins
// for these cards can be added next to the $OTC ones once the HUB mint
// launches.
// Latest CLOSED-day per-desk earning — today's row is still in progress.
const perDesk24hSolOf = (s) => {
  const items = s?.per_desk?.items || [];
  const today = new Date().toISOString().slice(0, 10);
  const closed = items
    .filter((d) => String(d.day || "") < today)
    .sort((a, b) => String(b.day).localeCompare(String(a.day)));
  return closed[0]?.per_desk_sol ?? null;
};
// Every card is a shortcut: `href` names the panel it jumps to (the page
// opens the target card and scrolls to it — see Home's goPanel).
const mintVsFloorDesc = (s) => {
  const mint = s?.mint_cost_sol, floor = s?.nft_floor_sol;
  if (mint == null || !floor) return "—";
  const pct = ((mint - floor) / floor) * 100;
  return pct <= 0
    ? `Verdict · MINT — ${Math.abs(pct).toFixed(0)}% under the ${fmtSol(floor)} SOL floor`
    : `Verdict · SECONDARY — ${fmtSol(floor)} SOL floor saves ${pct.toFixed(0)}%`;
};
const FEATURES = [
  { icon: Coins, label: "$OTC MCAP", value: (s) => fmtUsd(s?.token_market_cap), desc: () => "Live market cap", href: "otc-swap" },
  { icon: DollarSign, label: "$OTC PRICE", value: (s) => (s?.token_price_usd != null ? `$${s.token_price_usd.toFixed(4)}` : "—"), desc: () => "Live price per token", href: "otc-swap" },
  {
    icon: Flame,
    label: "SUPPLY BURNT",
    value: (s) => (s?.token_burnt != null ? `${(s.token_burnt / 1e6).toFixed(2)}M` : "—"),
    desc: (s) => (s?.token_burnt != null ? `${((s.token_burnt / (s?.token_tge_supply || 1e9)) * 100).toFixed(1)}% of TGE max burnt` : "—"),
    href: "otc-protocol",
  },
  { icon: Gem, label: "DESK SUPPLY", value: (s) => fmtNum(s?.nft_total_supply), desc: () => "OTC Desks NFT live supply", href: "otc-nft-trade" },
  {
    icon: HandCoins,
    label: "EARN / DESK",
    value: (s) => `${fmtSol(perDesk24hSolOf(s))} SOL`,
    desc: (s) => `≈ ${fmtUsd((perDesk24hSolOf(s) ?? 0) * (s?.sol_price_usd ?? 0))} per desk · 24h`,
    href: "otc-per-desk",
  },
  {
    icon: ArrowLeftRight,
    label: "MINT VS SECONDARY",
    value: (s) => `${fmtSol(s?.mint_cost_sol)} SOL`,
    desc: mintVsFloorDesc,
    href: "otc-arbitrage",
  },
];

export default function HeroLanding({ latest, onGoPanel }) {
  const [copied, setCopied] = useState(false);
  const desks = latest?.desks_minted ?? 0;
  const desksPct = Math.max(0, Math.min(100, (desks / DESK_CAP) * 100));

  const copyCa = async () => {
    try {
      await navigator.clipboard.writeText(OTC_MINT);
    } catch {
      /* clipboard unavailable — selection copy still works */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section className="term-window mt-3 border border-green-500/30 bg-black p-4 sm:p-6">
      <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        {/* Left: headline, CA copy bar, CTAs, live feature cards */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="border border-green-500/60 px-2.5 py-1 text-[10px] font-bold tracking-widest text-green-400">
              SOLANA OTC DESKS
            </span>
            <span className="border border-amber-400/60 px-2.5 py-1 text-[10px] font-bold tracking-widest text-amber-400">
              LIVE ON-CHAIN DATA
            </span>
          </div>

          <h2 className="mt-3 font-display text-2xl font-bold leading-tight tracking-wide text-green-200 sm:text-3xl xl:text-4xl">
            MINT A DESK. EARN THE POT. FOREVER.
          </h2>
          <p className="mt-2 max-w-xl text-[12px] leading-relaxed text-green-300/70 sm:text-[13px]">
            Live community analytics for the OTC Desks protocol on Solana — $OTC market data, desk NFT
            arbitrage, pot revenue attribution and on-chain claims.
          </p>

          {/* CA copy bar */}
          <div className="mt-4 flex max-w-xl items-center gap-2">
            <span className="flex min-w-0 flex-1 items-center gap-2 border border-green-500/30 bg-green-500/5 px-3 py-2 text-[11px] text-green-300">
              <span className="shrink-0 font-bold tracking-wider text-green-400">$OTC</span>
              <span className="shrink-0 text-green-500/50">CA</span>
              <span className="min-w-0 truncate sm:hidden" title={OTC_MINT}>{OTC_MINT.slice(0, 8)}…{OTC_MINT.slice(-8)}</span>
              <span className="hidden break-all sm:inline">{OTC_MINT}</span>
            </span>
            <button
              onClick={copyCa}
              title={copied ? "Copied" : "Copy contract address"}
              aria-label="Copy contract address"
              className="inline-flex shrink-0 items-center border border-emerald-500/60 bg-emerald-500/10 px-3 py-2 text-emerald-400 hover:bg-emerald-500/20"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>

          {/* CTA row */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <a
              href={DEX_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 border border-amber-400/70 bg-amber-400/15 px-4 py-2 text-[12px] font-bold tracking-wider text-amber-400 hover:bg-amber-400/25"
            >
              <LineChart className="h-4 w-4" /> DEXSCREENER
            </a>
            <a
              href="#otc-wallet"
              className="inline-flex items-center gap-2 border border-green-500/50 px-4 py-2 text-[12px] tracking-wider text-green-400 hover:bg-green-500/10"
            >
              CONNECT WALLET <ArrowDown className="h-3.5 w-3.5" />
            </a>
          </div>

          {/* Lifetime reward totals: desk NFT holders + launch holders */}
          <HeroRewardStats latest={latest} />

          {/* Live feature cards */}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {FEATURES.map(({ icon: Icon, label, value, desc, href }) => (
              <button
                key={label}
                type="button"
                onClick={() => onGoPanel?.(href)}
                title={`Open the ${label.toLowerCase()} panel`}
                className="border border-green-500/20 bg-green-500/5 p-2 text-left transition-colors hover:border-green-400/50 hover:bg-green-500/10"
              >
                <div className="flex items-center gap-1.5 text-[10px] tracking-widest text-green-500/60">
                  <Icon className="h-3.5 w-3.5 shrink-0" /> {label}
                </div>
                <div className="mt-1.5 text-[15px] font-bold text-green-300">{value(latest)}</div>
                <div className="mt-0.5 text-[10px] leading-snug text-green-500/50">{desc(latest)}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Right: glowing mascot badge + desks minted progress */}
        <div className="mx-auto flex w-full max-w-[220px] flex-col items-center gap-3 sm:max-w-[260px] lg:w-auto">
          <span className="inline-flex items-center gap-1.5 border border-emerald-500/50 px-2 py-0.5 text-[10px] font-bold tracking-widest text-emerald-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> LIVE
          </span>
          {/* Ring via box-shadow (not a border class) so the glass-zone rule
              keeps its circle in the MODERN skin. */}
          <div className="rounded-full p-1.5 shadow-[0_0_0_2px_rgb(74_222_128/0.5),0_0_60px_-6px_rgb(74_222_128/0.45)]">
            <MascotLogo className="h-40 w-40 object-contain sm:h-48 sm:w-48" />
          </div>
          <div className="w-full">
            <div className="flex items-center justify-between text-[10px] tracking-widest text-green-500/60">
              <span>DESKS MINTED</span>
              <span className="text-green-300">{fmtNum(desks)} / {fmtNum(DESK_CAP)}</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden bg-green-500/10">
              <div className="h-full bg-emerald-400/80 transition-all duration-500" style={{ width: `${desksPct}%` }} />
            </div>
            <a
              href="https://otcdesks.cash/mint"
              target="_blank"
              rel="noopener noreferrer"
              title="Mint an OTC Desk on the official site"
              className="mt-2 inline-flex w-full items-center justify-center gap-2 border border-emerald-500/60 bg-emerald-500/10 px-3 py-2 text-[12px] font-bold tracking-wider text-emerald-400 hover:bg-emerald-500/20"
            >
              <Gem className="h-3.5 w-3.5" /> MINT A DESK ↗
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}