import React from "react";
import { Link } from "react-router-dom";
import CollapsibleCard from "@/components/otc/CollapsibleCard";

// Public, SEO-indexable overview of what OTC Pulse does, who it serves, and
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
                &gt; ABOUT :: OTC_PULSE
                <span className="ml-1 inline-block animate-pulse text-green-500">▋</span>
              </h1>
              <p className="text-[10px] text-green-500/50">
                SOLANA OTC DESK ANALYTICS · EST. 2026
              </p>
            </div>
            <Link
              to="/"
              className="inline-flex items-center border border-green-500/50 px-2.5 py-1.5 text-[11px] text-green-400 hover:bg-green-500/10"
            >
              [← DASHBOARD]
            </Link>
          </div>
          <div className="mt-2 border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[10px] text-amber-400/80">
            COMMUNITY_TOOLING :: NOT AFFILIATED WITH OTCDESKS.CASH · UNOFFICIAL ANALYTICS DASHBOARD
          </div>
        </header>

        {/* What it does */}
        <div className="mt-3">
          <CollapsibleCard title="WHAT_IS_OTC_PULSE">
            <div className="space-y-3 text-[12px] leading-relaxed text-green-400/90">
              <p>
                OTC Pulse is a real-time analytics and trading dashboard for the OTC desk protocol
                that lives on the Solana blockchain. The protocol lets people mint, buy, and hold
                special NFTs called "desks". Each desk sits on top of a vault that continuously
                accrues stock distributions from the protocol&apos;s trading activity, and every
                desk holder can claim those earnings straight to their own wallet at any time.
              </p>
              <p>
                The dashboard reads live on-chain data through Solana RPC providers and
                market-price feeds, then turns it into decision-ready intelligence. It tracks the
                $OTC token price, circulating supply, and burn progress; the OTC desk floor price
                and listing depth on secondary markets; and the protocol&apos;s treasury, its
                earned and distributed SOL, buyback activity, and the backlog of distributions
                waiting to be claimed. It also calculates the spread between minting a fresh desk
                and sniping a stocked one on the secondary market, so users can see at a glance
                which side of the trade is cheaper right now.
              </p>
              <p>
                Beyond analytics, the app is a full wallet toolkit. Connect a Solana wallet to
                view your desk portfolio and accrued stock, batch-claim every distribution across
                all of your desks with a single approval flow, run the permissionless distribution
                crank that pushes the protocol&apos;s owed backlog into desk vaults, and swap
                between SOL and $OTC through the Jupiter aggregator with pre-signature simulation
                so a transaction that would fail never costs you a fee.
              </p>
            </div>
          </CollapsibleCard>
        </div>

        {/* Who it's for */}
        <div className="mt-3">
          <CollapsibleCard title="WHO_IT_IS_FOR">
            <div className="space-y-3 text-[12px] leading-relaxed text-green-400/90">
              <p>
                OTC Pulse is built for anyone active in the OTC desk ecosystem: current desk
                holders who want to see their accrued earnings grow in real time and claim them
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
                OTC Pulse is an independent, community-built project made by Solana developers and
                OTC desk holders who wanted better tooling for the protocol they use themselves.
                It is not the official otcdesks.cash application and is not affiliated with,
                endorsed by, or maintained by the protocol team. All analytics are provided as
                community tooling for informational purposes only — nothing here is financial
                advice, and you should always verify important transactions in your own wallet
                before signing.
              </p>
              <p>
                Questions, feedback, or bug reports? Reach us from the{" "}
                <Link to="/contact" className="text-emerald-400 underline hover:text-emerald-300">
                  contact page
                </Link>
                .
              </p>
            </div>
          </CollapsibleCard>
        </div>
      </div>
    </div>
  );
}