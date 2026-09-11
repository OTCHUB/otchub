import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy } from "lucide-react";
import type { ProtocolState } from "@hub-sdk";
import { useDexQuotes } from "@/lib/useDexQuotes";
import { fmtUsdCompact } from "@/lib/format";
import { fmtHub, fmtNum } from "../lib/format";
import { useHub } from "../HubProvider";
import { useProtocolState } from "../hooks/useProtocolState";
import { ProgressBar } from "./ui/ProgressBar";
import { RewardFlow } from "./ui/RewardFlow";
import { StockIcon } from "./ui/StockIcon";

const PILLARS = [
  {
    id: "mim",
    k: "M.I.M ETF",
    v: "$HUB holders earn a payout basket of $OTC · CRCLx · NVDAx · SPCXx",
  },
  {
    id: "l3",
    k: "3rd layer",
    v: "extra yield on the OTC Desks flywheel — keeps fresh mints affordable as $OTC grows",
  },
  {
    id: "stake",
    k: "Non-custodial",
    v: "desks stake in the owner wallet — HUB-ACTIVATED desks earn boosted payouts",
  },
];

const scrollTo = (id: string) =>
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

/**
 * $HUB protocol landing hero — the same shape as the main app's hero on "/"
 * (src/components/otc/HeroLanding.jsx): identity badges, headline, live CA
 * copy bar with DEX quote, CTA row, the three pillars, and on the right the
 * live reward flow + M.I.M basket + supply-burn progress. Sits above
 * ProtocolGate and reads chain state through the same shared-cache query the
 * gate uses (useProtocolState is keyed identically, so no extra fetch) —
 * placeholders render while the first read is in flight.
 */
export function HubHero() {
  const { cluster } = useHub();
  const { status } = useProtocolState();
  const [copied, setCopied] = useState(false);

  const state: ProtocolState | null = status.kind === "ready" ? status.state : null;
  const hubMint = state?.config.hubMint ?? null;
  const isMainnet = cluster === "mainnet-beta";
  // Live DEX quote — mainnet only (a devnet mint has no market to quote).
  const { quotes } = useDexQuotes(state && isMainnet && hubMint ? [hubMint] : []);
  const quote = hubMint ? quotes[hubMint] : undefined;
  const priceLabel =
    quote?.priceUsd != null
      ? `$${quote.priceUsd < 0.01 ? quote.priceUsd.toFixed(6) : quote.priceUsd.toFixed(4)}`
      : null;

  const d = state?.supply.decimals ?? 6;
  const burned = state ? fmtHub(state.supply.burnedUnits, d, 0) : "—";
  const burnFrac = state ? state.supply.burnPctOfMaxBp / 10_000 : 0;
  const roundLabel = state ? `ROUND #${fmtNum(state.currentEpoch.index)} LIVE` : "SYNCING…";

  const copyCa = async () => {
    if (!hubMint) return;
    try {
      await navigator.clipboard.writeText(hubMint);
    } catch {
      /* clipboard unavailable — selection copy still works */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section className="term-window border border-green-500/30 p-4 font-mono sm:p-6">
      <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        {/* Left: headline, CA copy bar, CTAs, pillars */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="border border-emerald-500/60 px-2.5 py-1 text-[10px] font-bold tracking-widest text-emerald-400">
              $HUB PROTOCOL
            </span>
            <span className="border border-amber-400/60 px-2.5 py-1 text-[10px] font-bold tracking-widest text-amber-400">
              {roundLabel}
            </span>
          </div>

          <h2 className="mt-3 font-display text-2xl font-bold leading-tight tracking-wide text-green-200 sm:text-3xl xl:text-4xl">
            ACTIVATE YOUR DESK. EARN THE BASKET. FOREVER.
          </h2>
          <p className="mt-2 max-w-xl text-[12px] leading-relaxed text-green-300/70 sm:text-[13px]">
            The stake-to-earn layer over the OTC Desks flywheel — burn $HUB into a tier without ever
            moving your desk NFT, and every closed round pays activated desks the M.I.M basket on
            top of their native desk-pot yield.
          </p>

          {/* $HUB CA copy bar — the mint straight from the live protocol config
              (dynamically verified, never hardcoded), with the live DEX quote
              on mainnet and the M.I.M basket tag underneath. */}
          <div className="mt-4 flex max-w-xl items-center gap-2">
            <span className="flex min-w-0 flex-1 flex-col border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-300">
              <span className="flex min-w-0 items-center gap-2">
                <StockIcon symbol="HUB" className="h-5 w-5 shrink-0" />
                <span className="shrink-0 font-bold tracking-wider text-emerald-400">$HUB</span>
                <span className="shrink-0 text-emerald-500/50">CA</span>
                <span className="min-w-0 break-all" title={hubMint ?? ""}>
                  {hubMint ?? "reading protocol config…"}
                </span>
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-emerald-400/80">
                <span title="$HUB live DEX price">{priceLabel ?? (isMainnet ? "—" : "DEVNET")}</span>
                <span title="$HUB live market cap">
                  mc {isMainnet ? (quote ? fmtUsdCompact(quote.mcap) : "—") : "DEVNET"}
                </span>
                {quote?.change24h != null && (
                  <span className={quote.change24h >= 0 ? "text-emerald-300" : "text-red-400"}>
                    {quote.change24h >= 0 ? "+" : ""}
                    {quote.change24h.toFixed(1)}%
                  </span>
                )}
                <span
                  className="min-w-0 truncate text-emerald-500/50"
                  title="Magic Internet Money — rotating payout basket paid to activated desks"
                >
                  M.I.M · OTC · CRCLx · NVDAx · SPCXx
                </span>
              </span>
            </span>
            <button
              onClick={copyCa}
              disabled={!hubMint}
              title={copied ? "Copied" : "Copy contract address"}
              aria-label="Copy contract address"
              className="inline-flex shrink-0 items-center border border-emerald-500/60 bg-emerald-500/10 px-3 py-2 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>

          {/* CTA row — the first two jump to the dashboard's own surfaces. */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => scrollTo("hub-wallet")}
              title="Connect a wallet and activate your desks into $HUB tiers"
              className="inline-flex items-center gap-2 border border-emerald-500/60 bg-emerald-500/10 px-4 py-2 text-[12px] font-bold tracking-wider text-emerald-400 hover:bg-emerald-500/20"
            >
              <StockIcon symbol="HUB" className="h-4 w-4" /> ACTIVATE A DESK ↓
            </button>
            <button
              type="button"
              onClick={() => scrollTo("hub-yield")}
              title="Simulated per-tier earnings against the live round"
              className="inline-flex items-center gap-2 border border-green-500/50 px-4 py-2 text-[12px] tracking-wider text-green-400 hover:bg-green-500/10"
            >
              EARNING PREVIEW ↓
            </button>
            <Link
              to="mechanics"
              title="How rounds, tiers, burns and claims work"
              className="inline-flex items-center gap-2 border border-amber-400/70 bg-amber-400/15 px-4 py-2 text-[12px] font-bold tracking-wider text-amber-400 hover:bg-amber-400/25"
            >
              MECHANICS →
            </Link>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {PILLARS.map((p) => (
              <div key={p.id} className="border-l border-green-500/30 pl-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-green-400">
                  {p.k}
                </div>
                <div className="mt-0.5 text-[11px] leading-snug text-green-700">{p.v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: live reward flow, M.I.M basket, supply-burn progress */}
        <div className="mx-auto flex w-full max-w-[300px] flex-col items-center gap-3 lg:w-auto">
          <span className="inline-flex items-center gap-1.5 border border-emerald-500/50 px-2 py-0.5 text-[10px] font-bold tracking-widest text-emerald-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> LIVE
          </span>
          <div className="w-full overflow-hidden">
            <RewardFlow compact />
          </div>
          <div className="w-full border border-green-500/20 bg-green-500/5 p-2">
            <div className="text-[10px] uppercase tracking-widest text-green-500/60">
              M.I.M payout basket
            </div>
            <div className="mt-1.5">
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {["OTC", "CRCLx", "NVDAx", "SPCXx"].map((s) => (
                  <span
                    key={s}
                    className="inline-flex items-center gap-1 border border-green-500/20 bg-green-500/5 px-1.5 py-px text-[10px] font-bold uppercase tracking-widest text-green-300"
                  >
                    <StockIcon symbol={s} className="h-3.5 w-3.5" />
                    {s}
                  </span>
                ))}
              </span>
            </div>
            <div className="mt-1.5 text-[10px] leading-snug text-green-700">
              rotating stock basket credited per closed round, pro-rata by tier weight
            </div>
          </div>
          <div className="w-full">
            <div className="flex items-center justify-between text-[10px] tracking-widest text-green-500/60">
              <span>$HUB BURNED</span>
              <span className="text-green-300">{burned} / 1B max</span>
            </div>
            <ProgressBar frac={burnFrac} suffix="of max supply burned" />
          </div>
        </div>
      </div>
    </section>
  );
}