import React, { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { fmtSol, fmtUsd, fmtNum } from "@/lib/format";
import { fetchTokenPricesUsd, SOL_MINT } from "@/lib/stockPrices";
import HoldingsGallery from "@/components/otc/HoldingsGallery";
import ClaimPanel from "@/components/otc/ClaimPanel";
import { StockIcon } from "@/hub/components/ui/StockIcon";

const trunc = (a) => (a ? `${a.slice(0, 4)}...${a.slice(-4)}` : "");

function Metric({ label, value, sub, accent = "text-green-300" }) {
  return (
    <div className="border border-green-500/20 p-2">
      <div className="text-[11px] uppercase tracking-widest text-green-500/50">{label}</div>
      <div className={`mt-1 font-mono text-sm font-bold ${accent}`}>{value}</div>
      {sub && <div className="text-[11px] text-green-500/50">{sub}</div>}
    </div>
  );
}

export default function WalletPortfolio({ address, onClear, perDesk24hSol = 0, perDesk7dSol = 0, refreshSignal = 0, onActivity }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [lifetime, setLifetime] = useState(null); // on-chain lifetime claim totals
  const [claim, setClaim] = useState(null); // { sol, usd } live vault-scan claimable
  const [scanPlan, setScanPlan] = useState(null); // per-desk vault scan from the claim tool
  const [claimPrices, setClaimPrices] = useState(null); // spot prices for valuing per-desk claimable stock
  const [deskCommand, setDeskCommand] = useState(null); // { assetId, mode, nonce } from the holdings dialog
  const claimRef = useRef(null);
  const firstRefreshSignal = useRef(true); // skip the signal effect on mount

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

  // External refresh (e.g. a confirmed swap changed OTC/SOL balances): reload
  // the portfolio. 0 = initial mount, which the load above already covers.
  useEffect(() => {
    if (firstRefreshSignal.current) {
      firstRefreshSignal.current = false;
      return;
    }
    if (refreshSignal) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  // LIFETIME_EARN: authoritative — seeded instantly from the persisted ClaimLog
  // DB, then kept current by an incremental on-chain claim scan. Re-fetch with
  // force after a claim so the new claim is picked up right away.
  // This component is the SINGLE owner of the fetch: the claim tool consumes
  // the result via props, so connecting never fires two identical on-chain
  // scans that can race each other into double-persisted claim records.
  const loadLifetime = React.useCallback(
    (force) =>
      base44.functions
        .invoke("getLifetimeClaims", { wallet: address, force: force === true })
        .then((r) => {
          if (r?.data && !r.data.error) setLifetime(r.data);
        })
        .catch(() => {
          /* lifetime stays hidden on failure */
        }),
    [address]
  );

  useEffect(() => {
    loadLifetime(false);
  }, [loadLifetime]);

  // Called by ClaimPanel with its live desk-vault scan: the exact on-chain
  // stock amounts a claim would deliver right now, priced at spot.
  const handleScan = (desks) => {
    setScanPlan(desks || null);
    const mints = new Set([SOL_MINT]);
    for (const d of desks || []) {
      for (const t of d.claimable || []) mints.add(t.mint);
    }
    (async () => {
      try {
        const prices = await fetchTokenPricesUsd([...mints]);
        setClaimPrices(prices);
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

  // Per-desk lifetime claimed earnings — same on-chain claim-history data the
  // claim tool consumes, keyed by desk for the holdings gallery/dialog.
  const lifetimeByDesk = React.useMemo(() => {
    const m = {};
    for (const d of lifetime?.by_desk || []) m[d.asset_id] = d;
    return m;
  }, [lifetime]);

  // Per-desk action from the holdings dialog: aim the claim tool at ONE desk
  // (claim its earnings / activate its accounts), then bring the tool into
  // view so its progress bar, status overlay and log are visible.
  const runDeskCommand = (assetId, mode) => {
    setDeskCommand({ assetId, mode, nonce: Date.now() });
    setTimeout(() => claimRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const desks = data?.desks_owned || 0;
  const solUsd = data?.sol_price_usd || null;
  const estPerDay24hSol = desks * (perDesk24hSol || 0);
  const estPerDay7dSol = desks * (perDesk7dSol || 0);
  // Raw ME floor (no fees) × owned desks
  const floorSol = data?.nft_floor_sol ?? null;
  const nftValueSol = floorSol != null ? desks * floorSol : null;
  const nftValueUsd = nftValueSol != null && solUsd ? nftValueSol * solUsd : null;
  // FOMO_ALPHA gate requirement (fomo.otchub.dev extension): granted while
  // the wallet holds >= 1 desk OR >= 100,000 $OTC, revoked when balances drop
  // below it — re-evaluated on every portfolio refresh, same rule the public
  // fomoGate API checks live for the fomo site.
  const fomoAccess = (data?.desks_owned || 0) >= 1 || (data?.otc_balance || 0) >= 100000;

  return (
    <div className="border border-green-500/30 bg-black p-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] uppercase tracking-widest text-green-500/70">
          WALLET :: {trunc(address)}
        </span>
        <button
          onClick={onClear}
          className="border border-green-500/30 px-2 py-0.5 text-[12px] text-green-500/60 hover:text-green-400"
        >
          [DISCONNECT]
        </button>
      </div>

      {loading && (
        <div className="mt-3 text-[13px] text-green-500/50">
          <span className="animate-pulse">▋</span> LOADING_PORTFOLIO...
        </div>
      )}
      {err && !loading && <div className="mt-3 text-[13px] text-amber-400">ERR: {err}</div>}

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
            <div className="border border-green-500/20 p-2">
              <div className="text-[11px] uppercase tracking-widest text-green-500/50">
                EST_EARN_PER_DAY
              </div>
              <div className="mt-1 grid grid-cols-2 gap-2 font-mono text-sm font-bold">
                <div className="text-emerald-400">
                  {fmtSol(estPerDay24hSol, 4)}
                  <div className="text-[11px] font-normal text-green-500/50">
                    24H · ≈ {fmtUsd(solUsd ? estPerDay24hSol * solUsd : null)}
                  </div>
                </div>
                <div className="text-cyan-300">
                  {fmtSol(estPerDay7dSol, 4)}
                  <div className="text-[11px] font-normal text-green-500/50">
                    7D_AVG · ≈ {fmtUsd(solUsd ? estPerDay7dSol * solUsd : null)}
                  </div>
                </div>
              </div>
              <div className="text-[11px] text-green-500/50">{fmtNum(desks)} DESKS</div>
            </div>
          </div>
          {/* FOMO_ALPHA access gate — live requirement check for the
              fomo.otchub.dev extension; shows granted/locked based on the
              wallet's current desk count and $OTC balance. */}
          <div
            className={`mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border px-2 py-1 font-mono text-[11px] ${
              fomoAccess ? "border-emerald-500/40 bg-emerald-500/5" : "border-green-500/20"
            }`}
          >
            <span className={fomoAccess ? "font-bold text-emerald-400" : "text-green-500/50"}>
              FOMO_ALPHA :: {fomoAccess ? "ACCESS_GRANTED" : "LOCKED"}
            </span>
            <span className="text-green-500/40">
              REQ 1 DESK OR 100,000 $OTC · HOLDING {fmtNum(data.desks_owned)} DESKS · {fmtNum(data.otc_balance)} $OTC
            </span>
            {fomoAccess && (
              <a
                href="https://fomo.otchub.dev"
                target="_blank"
                rel="noreferrer"
                className="text-emerald-400 hover:text-emerald-300"
              >
                [OPEN_FOMO ↗]
              </a>
            )}
          </div>
          {/* Lifetime earnings per stock (ticker) — amount + live SOL/USD.
              The tile label is icon-only on phones (the coin's title carries
              the symbol) and icon + symbol on ≥sm screens. */}
          {lifetime?.by_stock?.length > 0 && (
            <div className="mt-2 border border-amber-500/20 p-2">
              <div className="text-[11px] uppercase tracking-widest text-amber-500/50">
                LIFETIME :: BY STOCK (AMOUNT
                <span className="hidden sm:inline"> · SOL</span> · USD)
              </div>
              <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-3">
                {lifetime.by_stock.map((s) => (
                  <div
                    key={s.symbol}
                    className="flex items-center justify-between gap-1 border border-green-500/15 px-1.5 py-1 font-mono text-[11px]"
                  >
                    <span className="flex min-w-0 items-center gap-1 text-amber-300">
                      <StockIcon symbol={s.symbol} className="h-3.5 w-3.5 shrink-0" />
                      <span className="hidden truncate sm:inline">{s.symbol}</span>
                    </span>
                    <span className="truncate text-right">
                      <span className="text-green-300">{fmtNum(s.amount)}</span>{" "}
                      <span className="text-green-500/50">
                        <span className="hidden sm:inline">{fmtSol(s.value_sol, 3)} ◎ / </span>
                        {fmtUsd(s.value_usd)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="mt-3">
            <HoldingsGallery
              holdings={data.holdings}
              byStock={data.by_stock?.items}
              floorSol={data?.nft_floor_sol}
              walletOwned
              claimPlan={scanPlan}
              claimPrices={claimPrices}
              lifetimeByDesk={lifetimeByDesk}
              onDeskCommand={runDeskCommand}
            />
          </div>
          <div className="mt-3" ref={claimRef}>
            <ClaimPanel
              address={address}
              holdings={data.holdings}
              onClaimed={() => {
                load();
                onActivity?.();
              }}
              onScan={handleScan}
              lifetimeData={lifetime}
              refreshLifetime={loadLifetime}
              command={deskCommand}
              onCommandDone={() => setDeskCommand(null)}
            />
          </div>
        </>
      )}
    </div>
  );
}