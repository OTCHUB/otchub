import React, { useEffect, useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { RefreshCw } from "lucide-react";
import MetricsStrip from "@/components/otc/MetricsStrip";
import ArbitrageCard from "@/components/otc/ArbitrageCard";
import ProtocolPanel from "@/components/otc/ProtocolPanel";
import ArbitrageChart from "@/components/otc/ArbitrageChart";
import EarningsChart from "@/components/otc/EarningsChart";
import RoundsChart from "@/components/otc/RoundsChart";
import ByStockChart from "@/components/otc/ByStockChart";
import PotSourcesChart from "@/components/otc/PotSourcesChart";
import PerDeskTrendChart from "@/components/otc/PerDeskTrendChart";
import SupplyChart from "@/components/otc/SupplyChart";
import BuybacksPanel from "@/components/otc/BuybacksPanel";
import DesksTables from "@/components/otc/DesksTables";
import HoldingsGallery from "@/components/otc/HoldingsGallery";
import ListingsDepthChart from "@/components/otc/ListingsDepthChart";
import WalletConnect from "@/components/otc/WalletConnect";
import WalletPortfolio from "@/components/otc/WalletPortfolio";
import JupiterSwapPanel from "@/components/otc/JupiterSwapPanel";
import NftTradeCard from "@/components/otc/NftTradeCard";
import BootScreen from "@/components/otc/BootScreen";
import CollapsibleCard from "@/components/otc/CollapsibleCard";
import TerminalVisual from "@/components/otc/TerminalVisual";
import { timeAgo } from "@/lib/format";
import { useLiveOtcPrice } from "@/lib/useLiveOtcPrice";

export default function Home() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [bootDone, setBootDone] = useState(false);
  const [walletOpenSignal, setWalletOpenSignal] = useState(0);

  // Jump the user straight to the wallet connect controls (e.g. from the
  // swap panel when no wallet is connected): expand the card, then scroll.
  const goWalletConnect = useCallback(() => {
    setWalletOpenSignal((s) => s + 1);
    setTimeout(() => {
      document
        .getElementById("otc-wallet")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await base44.functions.invoke("getOtcDashboard", {});
      setData(res.data);
      setError(null);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh the dashboard view every 60s so listings/trends reflect
  // quick secondary-market buy-ups captured by the 5-min snapshot workflow,
  // without requiring a manual force-refresh.
  useEffect(() => {
    const id = setInterval(() => {
      load();
    }, 60000);
    return () => clearInterval(id);
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await base44.functions.invoke("fetchOtcData", { force: true });
      await load();
    } catch (e) {
      setError(e?.response?.data?.error || e.message || "Refresh failed (admin only)");
    } finally {
      setRefreshing(false);
    }
  };

  const snapshot = data?.latest;
  // Live DexScreener OTC + SOL price poll (every ~15s) merged over the stored
  // snapshot so the displayed price, SOL conversion, and arbitrage stay fresh
  // between the 5-minute backend ingests.
  const live = useLiveOtcPrice(snapshot);
  const latest = live && snapshot ? { ...snapshot, ...live } : snapshot;

  // Trailing 7-day average per-desk daily earning (SOL) — used to estimate a
  // connected wallet's daily earning from its owned (activated) desks.
  const perDeskItems = latest?.per_desk?.items || [];
  // Estimates come from CLOSED (completed) days only — the newest feed day
  // is today's in-progress working day with partial numbers.
  const todayKey = new Date().toISOString().slice(0, 10);
  const closedPd = perDeskItems.filter((d) => String(d.day || "") < todayKey);
  const sortedPd = [...closedPd].sort((a, b) =>
    String(b.day || "").localeCompare(String(a.day || ""))
  );
  const trailingPd = sortedPd.slice(0, 7).filter((d) => (d.per_desk_sol || 0) > 0);
  const perDesk7dSol = trailingPd.length
    ? trailingPd.reduce((a, d) => a + (d.per_desk_sol || 0), 0) / trailingPd.length
    : sortedPd[0]?.per_desk_sol ?? 0;
  // 24H window = the latest CLOSED daily row; shown next to the 7D trailing average.
  const perDesk24hSol = sortedPd[0]?.per_desk_sol ?? 0;

  if (loading || !bootDone) {
    return <BootScreen onComplete={() => setBootDone(true)} />;
  }

  return (
    <div className="min-h-screen max-w-[100vw] overflow-x-hidden bg-black font-mono text-green-400">
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6 xl:max-w-[1500px]">
        {/* Header */}
        <header className="border border-green-500/30 bg-black p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-sm font-bold uppercase tracking-widest text-green-400 sm:text-base">
                &gt; OTC_HUB :: OTC_DESK TOOLS
                <span className="ml-1 inline-block animate-pulse text-green-500">▋</span>
              </h1>
              <p className="text-[10px] text-green-500/50">
                LAST_UPDATE {timeAgo(latest?.updated_date || latest?.created_date)}
                {live ? " · " : ""}{live && <span className="text-emerald-400">● LIVE</span>}
                {" · "}{data?.snapshot_count || 0} SNAPSHOTS
              </p>
            </div>
            <div className="flex items-center gap-2">
              <a
                href="https://x.com/i/chat/group_join/g2094534355506860481/nX3pHq1n00"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 border border-green-500/50 px-2.5 py-1.5 text-[11px] text-green-400 hover:bg-green-500/10"
                title="Community-owned OTC holders group on X — come discuss with other desk holders"
              >
                [COMMUNITY ↗]
              </a>
              <a
                href="https://otcdesks.cash"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 border border-green-500/50 px-2.5 py-1.5 text-[11px] text-green-400 hover:bg-green-500/10"
                title="Official otcdesks.cash protocol app"
              >
                [OTC_APP ↗]
              </a>
              <a
                href="https://otcdesks.observer/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 border border-green-500/50 px-2.5 py-1.5 text-[11px] text-green-400 hover:bg-green-500/10"
                title="Community OTC_DESK visualization tool — desk charts and holder stats"
              >
                [OBSERVER ↗]
              </a>
              <button
                onClick={refresh}
                disabled={refreshing}
                className="inline-flex items-center border border-green-500/50 px-2 py-1.5 text-green-400 hover:bg-green-500/10 disabled:opacity-40"
                title="Force a fresh data snapshot (admin)"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>
          <div className="mt-2 border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[10px] text-amber-400/80">
            COMMUNITY_TOOLING :: NOT AFFILIATED WITH OTCDESKS.CASH · UNOFFICIAL ANALYTICS DASHBOARD
          </div>
          {error && (
            <div className="mt-2 border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-[11px] text-amber-400">
              ERR: {error}
            </div>
          )}
        </header>

        {/* Wallet */}
        <div className="mt-3">
          <CollapsibleCard title="WALLET" id="otc-wallet" openSignal={walletOpenSignal}>
            {wallet ? (
              <WalletPortfolio
                address={wallet}
                onClear={() => setWallet(null)}
                perDesk24hSol={perDesk24hSol}
                perDesk7dSol={perDesk7dSol}
              />
            ) : (
              <WalletConnect onConnected={setWallet} />
            )}
          </CollapsibleCard>
        </div>

        {/* All 8 headline metrics in one dense ticker strip */}
        <MetricsStrip latest={latest} history={data?.history} />

        {/* Arbitrage + Protocol */}
        <div className="mt-3 grid items-stretch gap-3 lg:grid-cols-3">
          <div className="h-full lg:col-span-2">
            <CollapsibleCard title="ARBITRAGE">
              <ArbitrageCard latest={latest} holdings={data?.holdings} />
            </CollapsibleCard>
          </div>
          <CollapsibleCard title="PROTOCOL">
            <ProtocolPanel latest={latest} />
          </CollapsibleCard>
        </div>

        {/* Supply vs desks minted + live terminal filler (desktop) */}
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <CollapsibleCard title="SUPPLY vs DESKS">
              <SupplyChart history={data?.history} latest={latest} />
            </CollapsibleCard>
          </div>
          <div className="hidden border border-green-500/30 bg-black lg:flex lg:flex-col">
            <div className="flex items-center justify-between border-b border-green-500/20 px-3 py-2 text-[10px] uppercase tracking-widest text-green-500/70">
              <span>TERMINAL :: CHAIN_FEED</span>
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                LIVE
              </span>
            </div>
            <div className="min-h-0 flex-1">
              <TerminalVisual variant="feed" />
            </div>
          </div>
        </div>

        {/* Listings: secondary-market desk inventory, above the trade hub so
            arbitrage jumps land right next to the swap they feed into */}
        <div className="mt-3">
          <CollapsibleCard title="LISTINGS :: NFT HOLDINGS" id="otc-listings">
            <ListingsDepthChart holdings={data?.holdings} />
            <div className="mt-3">
              <HoldingsGallery holdings={data?.holdings} byStock={latest?.by_stock?.items} floorSol={latest?.nft_floor_sol} />
            </div>
          </CollapsibleCard>
        </div>

        {/* Trade hub: two-way token swap + NFT desk trade routes */}
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <div className="lg:col-span-2" id="otc-swap">
            <CollapsibleCard title="TRADE :: $OTC TOKEN">
              <JupiterSwapPanel
                wallet={wallet}
                latest={latest}
                history={data?.history}
                onGoConnect={goWalletConnect}
                onConnected={setWallet}
              />
            </CollapsibleCard>
          </div>
          <CollapsibleCard title="TRADE :: NFT DESKS">
            <NftTradeCard />
          </CollapsibleCard>
        </div>

        {/* Charts */}
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <CollapsibleCard title="ARBITRAGE TREND">
            <ArbitrageChart history={data?.history} />
          </CollapsibleCard>
          <CollapsibleCard title="EARNINGS">
            <EarningsChart latest={latest} history={data?.history} />
          </CollapsibleCard>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <CollapsibleCard title="ROUNDS">
            <RoundsChart latest={latest} />
          </CollapsibleCard>
          <CollapsibleCard title="BUYBACKS">
            <BuybacksPanel latest={latest} />
          </CollapsibleCard>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <CollapsibleCard title="PER_DESK_EARN">
            <PerDeskTrendChart latest={latest} />
          </CollapsibleCard>
          <CollapsibleCard title="BY_STOCK">
            <ByStockChart latest={latest} />
          </CollapsibleCard>
        </div>

        {/* Desk pot revenue by source (stacked) */}
        <div className="mt-3">
          <CollapsibleCard title="POT_REVENUE :: DESK SOURCES">
            <PotSourcesChart latest={latest} />
          </CollapsibleCard>
        </div>

        {/* Tables */}
        <div className="mt-3">
          <CollapsibleCard title="DESKS :: DISTRIBUTION">
            <DesksTables latest={latest} />
          </CollapsibleCard>
        </div>

        <footer className="mt-4 space-y-1 text-center text-[10px] text-green-500/30">
          <div>OTC_HUB · COMMUNITY_TOOLING · NOT AFFILIATED WITH OTCDESKS.CASH</div>
          <div>DATA: HELIUS / DEXSCREENER / MAGIC_EDEN / OTCDESKS.CASH · OFFICIAL APP: <a href="https://otcdesks.cash" target="_blank" rel="noopener noreferrer" className="underline hover:text-green-400">otcdesks.cash ↗</a></div>
        </footer>
      </div>
    </div>
  );
}