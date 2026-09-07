import React from "react";
import { Link } from "react-router-dom";
import CollapsibleCard from "@/components/otc/CollapsibleCard";

// Public, SEO-indexable overview of what OTC Hub does, who it serves, and
// who builds it. One semantic <h1> + topical long-form content.
export default function About() {
  return (
    <div className="min-h-screen bg-black font-mono text-green-400">
      <div className="mx-auto max-w-3xl px-3 py-4 sm:px-4 sm:py-6">
        {/* Header */}
        <header className="border border-green-500/30 bg-black p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-sm font-bold uppercase tracking-widest text-green-400 sm:text-base">
                &gt; ABOUT :: OTC_HUB
                <span className="ml-1 inline-block animate-pulse text-green-500">▋</span>
              </h1>
              <p className="text-[12px] text-green-500/50">
                OTC_DESK SOLANA TOOL · EST. 2026
              </p>
            </div>
            <Link
              to="/"
              className="inline-flex items-center border border-green-500/50 px-2.5 py-1.5 text-[13px] text-green-400 hover:bg-green-500/10"
            >
              [← DASHBOARD]
            </Link>
          </div>
          <div className="mt-2 border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[12px] text-amber-400/80">
            COMMUNITY_TOOLING :: NOT AFFILIATED WITH OTCDESKS.CASH · UNOFFICIAL ANALYTICS DASHBOARD
          </div>
        </header>

        {/* What it is */}
        <div className="mt-3">
          <CollapsibleCard title="WHAT_IS_OTC_HUB">
            <div className="space-y-3 text-[12px] leading-relaxed text-green-400/90">
              <p>
                OTC Hub is a real-time analytics and trading dashboard for the OTC desk protocol
                that lives on the Solana blockchain. The protocol lets people mint, buy, and hold
                special NFTs called &quot;desks&quot;. Each desk sits on top of a vault that
                continuously accrues stock distributions from the protocol&apos;s trading activity,
                and every desk holder can claim those earnings straight to their own wallet at any
                time.
              </p>
              <p>
                The dashboard reads live on-chain data through Solana RPC providers and
                market-price feeds, then turns it into decision-ready intelligence. Every few
                minutes it snapshots the protocol&apos;s state and stores it, so you can watch
                trends develop over time — not just see a moment-in-time number. It tracks the
                $OTC token price, market cap, volume, and liquidity; the OTC desk floor price and
                secondary-market listing depth; and the protocol&apos;s treasury, its earned and
                distributed SOL, $OTC buyback activity, and the backlog of distributions waiting
                to be claimed.
              </p>
              <p>
                A built-in arbitrage engine compares the cost of minting a fresh desk versus
                sniping a stocked one on the secondary market, accounting for vault contents and
                fees, so you can see at a glance which side of the trade is cheaper right now —
                and the listings gallery sorts every desk by lowest price, highest stock, or best
                net snipe value.
              </p>
            </div>
          </CollapsibleCard>
        </div>

        {/* What's inside */}
        <div className="mt-3">
          <CollapsibleCard title="FEATURES">
            <div className="space-y-3 text-[12px] leading-relaxed text-green-400/90">
              <ul className="list-none space-y-1.5">
                <li>
                  <span className="text-emerald-400">[LIVE_MARKETS]</span> SOL and $OTC prices,
                  desk floor, market cap, volume, liquidity, and listing counts — kept fresh
                  between snapshots by live price polling and on-chain event webhooks.
                </li>
                <li>
                  <span className="text-emerald-400">[TREND_CHARTS]</span> Historical supply vs.
                  desks minted, arbitrage spread over time, daily protocol earnings and per-desk
                  averages, distribution round velocity, by-stock distribution breakdowns, and
                  buyback history.
                </li>
                <li>
                  <span className="text-emerald-400">[ARBITRAGE]</span> Mint-vs-secondary spread
                  with live vault scans, plus LISTED / STOCK / SNIPE listing modes to find the
                  best desks to buy.
                </li>
                <li>
                  <span className="text-emerald-400">[WALLET_PORTFOLIO]</span> Connect a Solana
                  wallet to see your desks, accrued stock, and estimated daily earnings — then
                  batch-claim every distribution across all of your desks in a single approval
                  flow, with every transaction simulated before signing.
                </li>
                <li>
                  <span className="text-emerald-400">[TRADE_HUB]</span> Two-way $OTC ↔ SOL swaps
                  routed through the Jupiter aggregator, with slippage control, live quotes, and
                  pre-signature simulation — plus direct routes to mint desks or trade them on
                  Magic Eden.
                </li>
                <li>
                  <span className="text-emerald-400">[DISTRIBUTE_CRANK]</span> A permissionless
                  crank anyone can run to push the protocol&apos;s owed backlog into desk vaults,
                  submitting transactions in batched approval waves with confirmation tracking for
                  reliable landing.
                </li>
              </ul>
            </div>
          </CollapsibleCard>
        </div>

        {/* Who it's for */}
        <div className="mt-3">
          <CollapsibleCard title="WHO_IT_IS_FOR">
            <div className="space-y-3 text-[12px] leading-relaxed text-green-400/90">
              <p>
                OTC Hub is built for anyone active in the OTC desk ecosystem: current desk holders
                who want to see their accrued earnings grow in real time and claim them
                efficiently; traders watching the mint-versus-secondary spread for arbitrage
                opportunities; and newcomers evaluating whether a desk is a good buy by comparing
                live protocol economics, floor prices, and historical earning trends side by side.
                Everything is read directly from the Solana chain and public market APIs, so the
                numbers you see are the numbers on chain.
              </p>
            </div>
          </CollapsibleCard>
        </div>

        {/* Who builds it */}
        <div className="mt-3">
          <CollapsibleCard title="WHO_BUILDS_IT">
            <div className="space-y-3 text-[12px] leading-relaxed text-green-400/90">
              <p>
                OTC Hub is developed by{" "}
                <a
                  href="https://x.com/themoonether"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-400 underline hover:text-emerald-300"
                >
                  @themoonether
                </a>{" "}
                — an independent, community-built project for the protocol. It is not the official
                otcdesks.cash application and is not affiliated with, endorsed by, or maintained by
                the protocol team. All analytics are provided as community tooling for
                informational purposes only — nothing here is financial advice, and you should
                always verify important transactions in your own wallet before signing.
              </p>
              <p>
                Questions, feedback, or bug reports? Reach out on{" "}
                <a
                  href="https://x.com/themoonether"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-400 underline hover:text-emerald-300"
                >
                  X
                </a>
                .
              </p>
            </div>
          </CollapsibleCard>
        </div>
      </div>
    </div>
  );
}