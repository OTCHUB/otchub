import React, { useEffect, useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { RefreshCw, Wallet, Coins, Image as ImageIcon, Layers } from "lucide-react";
import StatCard from "@/components/otc/StatCard";
import ArbitrageCard from "@/components/otc/ArbitrageCard";
import ProtocolPanel from "@/components/otc/ProtocolPanel";
import TrendChart from "@/components/otc/TrendChart";
import DesksTables from "@/components/otc/DesksTables";
import HoldingsGallery from "@/components/otc/HoldingsGallery";
import { fmtSol, fmtUsd, fmtNum, fmtPct, timeAgo } from "@/lib/format";

export default function Home() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

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
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-800 border-t-emerald-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              OTC Pulse <span className="font-normal text-slate-500">· Solana</span>
            </h1>
            <p className="text-xs text-slate-500">
              Last update {timeAgo(latest?.created_date)} · {data?.snapshot_count || 0} snapshots
            </p>
          </div>
          <button
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh
          </button>
        </header>

        {error && (
          <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            {error}
          </div>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="SOL Price" value={fmtUsd(latest?.sol_price_usd)} sub="Spot" accent="sky" icon={Wallet} />
          <StatCard label="OTC Token" value={fmtUsd(latest?.token_price_usd, 5)} sub={fmtPct(latest?.token_price_change_24h)} accent="emerald" icon={Coins} />
          <StatCard label="NFT Floor" value={fmtSol(latest?.nft_floor_sol)} sub={fmtUsd(latest?.nft_floor_usd)} accent="violet" icon={ImageIcon} />
          <StatCard label="Desks Minted" value={fmtNum(latest?.desks_minted)} sub={`Supply ${fmtNum(latest?.nft_total_supply)}`} accent="amber" icon={Layers} />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ArbitrageCard latest={latest} />
          </div>
          <ProtocolPanel latest={latest} />
        </div>

        <div className="mt-4">
          <TrendChart history={data?.history} />
        </div>

        <div className="mt-4">
          <DesksTables latest={latest} />
        </div>

        <div className="mt-4">
          <HoldingsGallery holdings={data?.holdings} />
        </div>
      </div>
    </div>
  );
}