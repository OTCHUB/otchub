import React, { useEffect, useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { RefreshCw } from "lucide-react";
import StatCard from "@/components/otc/StatCard";
import ArbitrageCard from "@/components/otc/ArbitrageCard";
import ProtocolPanel from "@/components/otc/ProtocolPanel";
import TrendChart from "@/components/otc/TrendChart";
import PerDeskChart from "@/components/otc/PerDeskChart";
import DesksTables from "@/components/otc/DesksTables";
import HoldingsGallery from "@/components/otc/HoldingsGallery";
import WalletConnect from "@/components/otc/WalletConnect";
import WalletPortfolio from "@/components/otc/WalletPortfolio";
import { fmtSol, fmtUsd, fmtNum, fmtPct, fmtCompact, timeAgo } from "@/lib/format";

export default function Home() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [wallet, setWallet] = useState(null);

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

  const refresh = async () => {
    setRefreshing(true);
    try {
      await base44.functions.invoke("fetchOtcData", {});
      await load();
    } catch (e) {
      setError(e?.response?.data?.error || e.message || "Refresh failed (admin only)");
    } finally {
      setRefreshing(false);
    }
  };

  const latest = data?.latest;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black font-mono">
        <span className="text-green-400">
          <span className="animate-pulse">▋</span> LOADING OTC_PULSE...
        </span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black font-mono text-green-400">
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6">
        {/* Header */}
        <header className="border border-green-500/30 bg-black p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-sm font-bold uppercase tracking-widest text-green-400 sm:text-base">
                &gt; OTC_PULSE :: SOLANA
                <span className="ml-1 inline-block animate-pulse text-green-500">▋</span>
              </h1>
              <p className="text-[10px] text-green-500/50">
                LAST_UPDATE {timeAgo(latest?.created_date)} · {data?.snapshot_count || 0} SNAPSHOTS
              </p>
            </div>
            <button
              onClick={refresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 border border-green-500/50 px-2.5 py-1.5 text-[11px] text-green-400 hover:bg-green-500/10 disabled:opacity-40"
            >
              <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
              [REFRESH]
            </button>
          </div>
          {error && (
            <div className="mt-2 border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-[11px] text-amber-400">
              ERR: {error}
            </div>
          )}
        </header>

        {/* Wallet */}
        <div className="mt-3">
          {wallet ? (
            <WalletPortfolio address={wallet} onClear={() => setWallet(null)} />
          ) : (
            <WalletConnect onConnected={setWallet} />
          )}
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
            value={fmtSol(latest?.nft_floor_sol)}
            sub={fmtUsd(latest?.nft_floor_usd)}
            desc="Lowest Magic Eden listing"
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
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ArbitrageCard latest={latest} />
          </div>
          <ProtocolPanel latest={latest} />
        </div>

        {/* Charts */}
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <TrendChart history={data?.history} />
          <PerDeskChart latest={latest} />
        </div>

        {/* Tables */}
        <div className="mt-3">
          <DesksTables latest={latest} />
        </div>

        {/* Holdings */}
        <div className="mt-3">
          <HoldingsGallery holdings={data?.holdings} />
        </div>

        <footer className="mt-4 text-center text-[10px] text-green-500/30">
          OTC_PULSE v1.0 · DATA: HELIUS / DEXSCREENER / MAGIC_EDEN / OTCDESKS.CASH
        </footer>
      </div>
    </div>
  );
}