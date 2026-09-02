import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { fmtSol, fmtUsd, fmtNum } from "@/lib/format";
import { fetchTokenPricesUsd, SOL_MINT } from "@/lib/stockPrices";
import HoldingsGallery from "@/components/otc/HoldingsGallery";
import ClaimPanel from "@/components/otc/ClaimPanel";

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

export default function WalletPortfolio({ address, onClear, perDeskPerDaySol = 0 }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [lifetime, setLifetime] = useState(null); // on-chain lifetime claim totals
  const [claim, setClaim] = useState(null); // { sol, usd } live vault-scan claimable

  const load = React.useCallback(() => {
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

  useEffect(() => load(), [load]);

  // LIFETIME_EARN: authoritative — decoded from the wallet's real on-chain
  // OTC claim transactions (server-cached, incremental scan).
  useEffect(() => {
    let active = true;
    base44.functions
      .invoke("getLifetimeClaims", { wallet: address })
      .then((r) => {
        if (active && r?.data && !r.data.error) setLifetime(r.data);
      })
      .catch(() => {
        /* lifetime stays hidden on failure */
      });
    return () => {
      active = false;
    };
  }, [address]);

  // Called by ClaimPanel with its live desk-vault scan: the exact on-chain
  // stock amounts a claim would deliver right now, priced at spot.
  const handleScan = (desks) => {
    const mints = new Set([SOL_MINT]);
    for (const d of desks || []) {
      for (const t of d.claimable || []) mints.add(t.mint);
    }
    (async () => {
      try {
        const prices = await fetchTokenPricesUsd([...mints]);
        let usd = 0;
        for (const d of desks || []) {
          for (const t of d.claimable || []) {
            usd += (t.amount / 10 ** t.decimals) * (prices?.[t.mint] || 0);
          }
        }
        const solUsd = prices?.[SOL_MINT] || null;
        setClaim({ usd, sol: solUsd ? usd / solUsd : null });
      } catch {
        /* keep previous totals */
      }
    })();
  };

  const desks = data?.desks_owned || 0;
  const solUsd = data?.sol_price_usd || null;
  const estPerDaySol = desks * (perDeskPerDaySol || 0);
  // Raw ME floor (no fees) × owned desks
  const floorSol = data?.nft_floor_sol ?? null;
  const nftValueSol = floorSol != null ? desks * floorSol : null;
  const nftValueUsd = nftValueSol != null && solUsd ? nftValueSol * solUsd : null;

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
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
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
              label="LIFETIME_EARN"
              value={lifetime ? fmtSol(lifetime.total_sol, 4) : "SCANNING…"}
              sub={
                lifetime
                  ? `≈ ${fmtUsd(lifetime.total_usd)} · ${fmtNum(lifetime.count)} CLAIMS · ON-CHAIN`
                  : "DECODING CLAIM HISTORY…"
              }
              accent="text-amber-400"
            />
            <Metric
              label="EARN_TO_CLAIM"
              value={claim ? fmtSol(claim.sol, 4) : "SCANNING…"}
              sub={claim ? `≈ ${fmtUsd(claim.usd)} · LIVE VAULT SCAN` : "READING VAULTS…"}
              accent="text-emerald-400"
            />
            <Metric
              label="NFT_VALUE"
              value={nftValueSol != null ? fmtSol(nftValueSol, 3) : "—"}
              sub={`≈ ${fmtUsd(nftValueUsd)} · RAW FLOOR · NO FEES`}
              accent="text-cyan-300"
            />
            <Metric
              label="EST_EARN_PER_DAY"
              value={fmtSol(estPerDaySol, 4)}
              sub={`≈ ${fmtUsd(solUsd ? estPerDaySol * solUsd : null)} · ${fmtNum(desks)} desks · 7d avg`}
              accent="text-emerald-400"
            />
          </div>
          <div className="mt-3">
            <HoldingsGallery holdings={data.holdings} byStock={data.by_stock?.items} />
          </div>
          <div className="mt-3">
            <ClaimPanel
              address={address}
              holdings={data.holdings}
              onClaimed={load}
              onScan={handleScan}
            />
          </div>
        </>
      )}
    </div>
  );
}