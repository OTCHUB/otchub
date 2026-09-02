import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { fmtSol, fmtUsd, fmtNum } from "@/lib/format";
import HoldingsGallery from "@/components/otc/HoldingsGallery";

const trunc = (a) => (a ? `${a.slice(0, 4)}...${a.slice(-4)}` : "");

function Metric({ label, value, sub, accent = "text-green-300" }) {
  return (
    <div className="border border-green-500/20 p-2">
      <div className="text-[9px] uppercase tracking-widest text-green-500/50">{label}</div>
      <div className={`mt-1 font-mono text-sm font-bold ${accent}`}>{value}</div>
      {sub && <div className="text-[9px] text-green-500/50">{sub}</div>}
    </div>
  );
}

export default function WalletPortfolio({ address, onClear }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setData(null);
    base44.functions
      .invoke("getWalletPortfolio", { address })
      .then((r) => {
        if (active) {
          setData(r.data);
          setErr(null);
        }
      })
      .catch((e) => {
        if (active) setErr(e?.response?.data?.error || e.message || "Lookup failed");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [address]);

  return (
    <div className="border border-green-500/30 bg-black p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-green-500/70">
          WALLET :: {trunc(address)}
        </span>
        <button
          onClick={onClear}
          className="border border-green-500/30 px-2 py-0.5 text-[10px] text-green-500/60 hover:text-green-400"
        >
          [DISCONNECT]
        </button>
      </div>

      {loading && (
        <div className="mt-3 text-[11px] text-green-500/50">
          <span className="animate-pulse">▋</span> LOADING_PORTFOLIO...
        </div>
      )}
      {err && !loading && <div className="mt-3 text-[11px] text-amber-400">ERR: {err}</div>}

      {data && !loading && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric
              label="OTC_BALANCE"
              value={fmtNum(data.otc_balance)}
              sub={`≈ ${fmtUsd(data.otc_value_usd)}`}
              accent="text-green-300"
            />
            <Metric
              label="DESKS_OWNED"
              value={fmtNum(data.desks_owned)}
              sub={`${data.listed_count} listed`}
              accent="text-cyan-400"
            />
            <Metric
              label="TOTAL_EARN_SOL"
              value={fmtSol(data.total_earning_sol, 4)}
              accent="text-emerald-400"
            />
            <Metric
              label="TOTAL_EARN_USD"
              value={fmtUsd(data.total_earning_usd)}
              accent="text-emerald-400"
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric
              label="EARN_TO_CLAIM"
              value={fmtSol(data.total_earning_sol, 4)}
              sub={`≈ ${fmtUsd(data.total_earning_usd)}`}
              accent="text-emerald-400"
            />
            <Metric
              label="CLAIMED_EARN"
              value="—"
              sub="no claim data"
              accent="text-green-500/50"
            />
            <Metric
              label="STOCK_HOLDING"
              value={fmtSol(data.total_earning_sol, 4)}
              sub={`${(data.by_stock?.items || []).length} symbols`}
              accent="text-emerald-400"
            />
            <Metric
              label="LISTED_DESKS"
              value={fmtNum(data.listed_count)}
              sub={`of ${fmtNum(data.desks_owned)}`}
              accent="text-amber-400"
            />
          </div>
          <div className="mt-3">
            <HoldingsGallery holdings={data.holdings} byStock={data.by_stock?.items} />
          </div>
        </>
      )}
    </div>
  );
}