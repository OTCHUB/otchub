import React, { useEffect, useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import StatCard from "@/components/otc/StatCard";
import ArbitrageCard from "@/components/otc/ArbitrageCard";
import ProtocolPanel from "@/components/otc/ProtocolPanel";
import ArbitrageChart from "@/components/otc/ArbitrageChart";
import EarningsChart from "@/components/otc/EarningsChart";
import RoundsChart from "@/components/otc/RoundsChart";
import ByStockChart from "@/components/otc/ByStockChart";
import PerDeskTrendChart from "@/components/otc/PerDeskTrendChart";
import SupplyChart from "@/components/otc/SupplyChart";
import BuybacksPanel from "@/components/otc/BuybacksPanel";
import DesksTables from "@/components/otc/DesksTables";
import HoldingsGallery from "@/components/otc/HoldingsGallery";
import WalletConnect from "@/components/otc/WalletConnect";
import WalletPortfolio from "@/components/otc/WalletPortfolio";
import JupiterSwapPanel from "@/components/otc/JupiterSwapPanel";
import NftTradeCard from "@/components/otc/NftTradeCard";
import BootScreen from "@/components/otc/BootScreen";
import DistributeCrank from "@/components/otc/DistributeCrank";
import CollapsibleCard from "@/components/otc/CollapsibleCard";
import TerminalVisual from "@/components/otc/TerminalVisual";
import { fmtSol, fmtUsd, fmtNum, fmtPct, fmtCompact, timeAgo } from "@/lib/format";
import { useLiveOtcPrice } from "@/lib/useLiveOtcPrice";

export default function Home() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [bootDone, setBootDone] = useState(false);

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
  const sortedPd = [...perDeskItems].sort((a, b) =>
    String(b.day || "").localeCompare(String(a.day || ""))
  );
  const trailingPd = sortedPd.slice(0, 7).filter((d) => (d.per_desk_sol || 0) > 0);
  const perDeskPerDaySol = trailingPd.length
    ? trailingPd.reduce((a, d) => a + (d.per_desk_sol || 0), 0) / trailingPd.length
    : sortedPd[0]?.per_desk_sol ?? 0;

  if (loading || !bootDone) {
    return <BootScreen onComplete={() => setBootDone(true)} />;
  }

  return (
    <div className="min-h-screen bg-black font-mono text-green-400">
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6 xl:max-w-[1500px]">
        {/* Header */}
        <header className="border border-green-500/30 bg-black p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-sm font-bold uppercase tracking-widest text-green-400 sm:text-base">
                &gt; OTC_HUB :: OTC_DESK SOLANA TOOL
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
                href="https://otcdesks.cash"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 border border-green-500/50 px-2.5 py-1.5 text-[11px] text-green-400 hover:bg-green-500/10"
                title="Official otcdesks.cash protocol app"
              >
                [OTC_APP ↗]
              </a>
              <Link
                to="/about"
                className="inline-flex items-center border border-green-500/50 px-2.5 py-1.5 text-[11px] text-green-400 hover:bg-green-500/10"
                title="What OTC Hub is and who builds it"
              >
                [ABOUT]
              </Link>
              <button
                onClick={refresh}
                disabled={refreshing}
                className="inline-flex items-center gap-1.5 border border-green-500/50 px-2.5 py-1.5 text-[11px] text-green-400 hover:bg-green-500/10 disabled:opacity-40"
              >
                <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
                [REFRESH]
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
          <CollapsibleCard title="WALLET">
            {wallet ? (
              <WalletPortfolio
                address={wallet}
                onClear={() => setWallet(null)}
                perDeskPerDaySol={perDeskPerDaySol}
              />
            ) : (
              <WalletConnect onConnected={setWallet} />
            )}
          </CollapsibleCard>
        </div>

        {/* Top metrics */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <StatCard
            label="SOL_PRICE"
            value={fmtUsd(latest?.sol_price_usd)}
            sub="SPOT_USD"
            desc="Wrapped SOL spot price"
            accent="cyan"
          />
          <StatCard
            label="OTC_TOKEN"
            value={fmtUsd(latest?.token_price_usd, 5)}
            sub={`24H ${fmtPct(latest?.token_price_change_24h)}`}
            desc="OTC token spot market price"
            accent="green"
          />
          <StatCard
            label="NFT_FLOOR"
            value={fmtSol(latest?.secondary_cost_sol)}
            sub={fmtUsd(latest?.secondary_cost_usd)}
            desc="ME floor incl. 2% + 5% fees"
            accent="amber"
          />
          <StatCard
            label="DESKS_MINTED"
            value={fmtNum(latest?.desks_minted)}
            sub={`SUPPLY ${fmtNum(latest?.nft_total_supply)}`}
            desc="Total OTC desks minted"
            accent="green"
          />
        </div>

        {/* Secondary metrics */}
        <div className="mt-2 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <StatCard
            label="MKT_CAP"
            value={fmtCompact(latest?.token_market_cap) === "—" ? "—" : `$${fmtCompact(latest?.token_market_cap)}`}
            sub="OTC"
            accent="green"
          />
          <StatCard
            label="VOL_24H"
            value={fmtCompact(latest?.token_volume_24h) === "—" ? "—" : `$${fmtCompact(latest?.token_volume_24h)}`}
            sub="OTC"
            accent="green"
          />
          <StatCard
            label="LIQUIDITY"
            value={fmtUsd(latest?.token_liquidity_usd)}
            sub="DEX"
            accent="green"
          />
          <StatCard
            label="LISTED"
            value={fmtNum(latest?.nft_listed_count)}
            sub="NFTs for sale"
            accent="amber"
          />
        </div>

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

        {/* Trade hub: two-way token swap + NFT desk trade routes */}
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <div className="lg:col-span-2" id="otc-swap">
            <CollapsibleCard title="TRADE :: $OTC TOKEN">
              <JupiterSwapPanel wallet={wallet} />
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
            <EarningsChart latest={latest} />
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

        {/* Permissionless global distribute crank + code-stream terminal filler (desktop) */}
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <CollapsibleCard title="☢ DISTRIBUTE :: GLOBAL CRANK">
              <DistributeCrank wallet={wallet} allDesks={data?.holdings} latest={latest} />
            </CollapsibleCard>
          </div>
          <div className="hidden border border-green-500/30 bg-black lg:flex lg:flex-col">
            <div className="flex items-center justify-between border-b border-green-500/20 px-3 py-2 text-[10px] uppercase tracking-widest text-green-500/70">
              <span>TERMINAL :: CODE_STREAM</span>
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                COMPILING
              </span>
            </div>
            <div className="min-h-0 flex-1">
              <TerminalVisual variant="code" />
            </div>
          </div>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <CollapsibleCard title="PER_DESK_EARN">
            <PerDeskTrendChart latest={latest} />
          </CollapsibleCard>
          <CollapsibleCard title="BY_STOCK">
            <ByStockChart latest={latest} />
          </CollapsibleCard>
        </div>

        {/* Tables */}
        <div className="mt-3">
          <CollapsibleCard title="DESKS :: DISTRIBUTION">
            <DesksTables latest={latest} />
          </CollapsibleCard>
        </div>

        {/* Holdings */}
        <div className="mt-3">
          <CollapsibleCard title="LISTINGS :: NFT HOLDINGS" id="otc-listings">
            <HoldingsGallery holdings={data?.holdings} byStock={latest?.by_stock?.items} />
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