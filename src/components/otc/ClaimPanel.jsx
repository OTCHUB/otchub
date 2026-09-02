import React, { useEffect, useState } from "react";
import { Image } from "@/components/ui/image";
import { buildClaimInstructions, buildActivateInstructions, packTxs, executeClaimTxs } from "@/lib/otcClaim";
import { getSignerForAddress } from "@/lib/walletSigner";
import { fetchTokenPricesUsd, SOL_MINT } from "@/lib/stockPrices";
import { fmtSol, fmtUsd } from "@/lib/format";
import { base44 } from "@/api/base44Client";

export default function ClaimPanel({ address, holdings, onClaimed }) {
  const [selected, setSelected] = useState(() => new Set());
  const [tpMap, setTpMap] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState([]);
  const [prices, setPrices] = useState({});
  const [lifetime, setLifetime] = useState({}); // asset_id -> {value_sol, value_usd, count, tickers}

  const desks = holdings || [];
  const log = (l) => setLogs((prev) => [...prev, { ...l, t: Date.now() }]);

  const loadLifetime = async (w) => {
    try {
      const res = await base44.functions.invoke("getLifetimeClaims", { wallet: w });
      const payload = res?.data || {};
      if (payload.error) return;
      const map = {};
      for (const d of payload.by_desk || []) map[d.asset_id] = d;
      setLifetime(map);
    } catch {
      /* ignore */
    }
  };

  // USD spot price per mint, plus SOL spot (keyed by SOL_MINT). Re-fetched
  // whenever the scan plan changes so claim values stay current.
  useEffect(() => {
    if (!plan) return;
    const mints = new Set([SOL_MINT]);
    for (const d of plan) for (const t of d.claimable || []) mints.add(t.mint);
    let cancelled = false;
    (async () => {
      const p = await fetchTokenPricesUsd([...mints]);
      if (!cancelled) setPrices(p);
    })();
    return () => {
      cancelled = true;
    };
  }, [plan]);

  const solPriceUsd = prices?.[SOL_MINT] ?? null;
  const deskUsdValue = (dp) =>
    (dp?.claimable || []).reduce((s, t) => {
      const px = prices?.[t.mint] || 0;
      return s + (t.amount / 10 ** t.decimals) * px;
    }, 0);
  const deskSolValue = (dp) =>
    solPriceUsd ? deskUsdValue(dp) / solPriceUsd : null;

  const toggle = (id) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const selectAll = () => setSelected(new Set(desks.map((d) => d.asset_id)));
  const clearAll = () => setSelected(new Set());

  const applyScan = (scanned) => {
    const list = scanned || [];
    const map = {};
    for (const d of list) {
      for (const t of d.tickers || []) {
        if (t.token_program) map[t.mint] = t.token_program;
      }
    }
    setTpMap(map);
    setPlan(list);
    return list;
  };

  const scan = async (opts = {}) => {
    const force = opts.force !== false; // default true
    const silent = opts.silent === true;
    if (!address) return null;
    if (!silent) {
      setLogs([]);
      log({ type: "info", msg: `Requesting claim scan from server...` });
    }
    setScanning(true);
    try {
      const res = await base44.functions.invoke("scanWalletClaims", {
        wallet: address,
        force,
        assets: desks.map((d) => ({ asset_id: d.asset_id, name: d.name, image_url: d.image_url })),
      });
      // invoke returns an axios response — the function payload lives in res.data
      const payload = res?.data || {};
      if (payload.error) throw new Error(payload.error);
      const list = applyScan(payload.desks);
      if (!silent) {
        const totalClaimable = list.reduce((a, d) => a + (d.claimable?.length || 0), 0);
        log({
          type: totalClaimable ? "ok" : "info",
          msg: `${payload.cached ? "CACHED" : "FRESH"} scan: ${totalClaimable} claimable ticker(s) across ${list.length} desk(s).`,
        });
      }
      return list;
    } catch (e) {
      if (!silent) log({ type: "err", msg: `SCAN_FAIL: ${e.message}` });
      return null;
    } finally {
      setScanning(false);
    }
  };

  // Auto-scan on mount so each NFT's unclaimed claim value shows immediately.
  // force=false returns a fresh cache if within TTL, else scans on-chain.
  useEffect(() => {
    if (!address || !desks.length) return;
    scan({ force: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, desks.length]);

  // Load this wallet's per-desk lifetime claimed totals on mount.
  useEffect(() => {
    if (!address) return;
    loadLifetime(address);
  }, [address]);

  const runClaim = async (allDesks) => {
    const signer = getSignerForAddress(address);
    if (!signer) {
      log({ type: "err", msg: "No signing wallet connected for this address." });
      return;
    }
    const targets = allDesks ? plan : plan.filter((d) => selected.has(d.asset_id));
    if (!targets || !targets.length) {
      log({ type: "err", msg: "Nothing to claim — run a scan first." });
      return;
    }
    const claimable = targets.filter((d) => d.claimable.length);
    if (!claimable.length) {
      log({ type: "err", msg: "No desks with claimable balance." });
      return;
    }
    setBusy(true);
    try {
      log({
        type: "info",
        msg: `Building claim ixs for ${claimable.length} desk(s)...`,
      });
      const ixs = await buildClaimInstructions(claimable, address, tpMap);
      log({ type: "info", msg: `Packing ${ixs.length} instruction(s) into txs...` });
      const txs = await packTxs(ixs, address);
      log({ type: "info", msg: `${txs.length} transaction(s) to submit.` });
      const results = await executeClaimTxs(txs, signer.signTransactionRaw, log);
      const ok = results.filter((r) => r.ok).length;
      const fail = results.length - ok;
      log({
        type: fail ? "err" : "ok",
        msg: `DONE: ${ok} confirmed, ${fail} failed.`,
      });
      if (ok > 0) {
        if (onClaimed) onClaimed();
        // Capture pre-claim balances, re-scan on-chain, and log the per-ticker
        // deltas (claimed = pre − post) as lifetime history for this wallet.
        const pre = {};
        for (const d of claimable) {
          pre[d.asset_id] = {};
          for (const t of d.claimable) pre[d.asset_id][t.mint] = t.amount;
        }
        const postPlan = await scan({ force: true, silent: true });
        const claimed = [];
        for (const d of postPlan || []) {
          const preD = pre[d.asset_id];
          if (!preD) continue;
          for (const t of d.tickers || []) {
            const diff = (preD[t.mint] || 0) - (t.amount || 0);
            if (diff > 0) {
              const amountHuman = diff / 10 ** t.decimals;
              const valueUsd = amountHuman * (prices?.[t.mint] || 0);
              const valueSol = solPriceUsd ? valueUsd / solPriceUsd : 0;
              claimed.push({
                asset_id: d.asset_id,
                symbol: t.symbol,
                mint: t.mint,
                amount: amountHuman,
                value_usd: valueUsd,
                value_sol: valueSol,
              });
            }
          }
        }
        if (claimed.length) {
          try {
            await base44.functions.invoke("logClaims", { wallet: address, claims: claimed });
            log({ type: "ok", msg: `Logged ${claimed.length} claim(s) to lifetime history.` });
            loadLifetime(address);
          } catch (e) {
            log({ type: "err", msg: `LOG_FAIL: ${e.message}` });
          }
        }
      }
    } catch (e) {
      log({ type: "err", msg: `CLAIM_ABORT: ${e.message}` });
    } finally {
      setBusy(false);
    }
  };

  const runActivate = async (allDesks) => {
    const signer = getSignerForAddress(address);
    if (!signer) {
      log({ type: "err", msg: "No signing wallet connected for this address." });
      return;
    }
    const targets = allDesks ? plan : plan.filter((d) => selected.has(d.asset_id));
    if (!targets || !targets.length) {
      log({ type: "err", msg: "Nothing selected — scan first." });
      return;
    }
    const toActivate = [];
    for (const d of targets) {
      for (const t of d.tickers || []) if (!t.exists) toActivate.push(t);
    }
    if (!toActivate.length) {
      log({ type: "info", msg: "All tickers already open on selected desks." });
      return;
    }
    setBusy(true);
    try {
      log({ type: "info", msg: `Building activate ixs for ${toActivate.length} ticker(s)...` });
      const ixs = await buildActivateInstructions(targets, address, tpMap);
      log({ type: "info", msg: `Packing ${ixs.length} instruction(s)...` });
      const txs = await packTxs(ixs, address);
      log({ type: "info", msg: `${txs.length} transaction(s) to submit.` });
      const results = await executeClaimTxs(txs, signer.signTransactionRaw, log);
      const ok = results.filter((r) => r.ok).length;
      const fail = results.length - ok;
      log({ type: fail ? "err" : "ok", msg: `ACTIVATE DONE: ${ok} confirmed, ${fail} failed.` });
      if (ok > 0) {
        await scan({ force: true, silent: true });
        if (onClaimed) onClaimed();
      }
    } catch (e) {
      log({ type: "err", msg: `ACTIVATE_ABORT: ${e.message}` });
    } finally {
      setBusy(false);
    }
  };

  const totalClaimable = plan
    ? plan.reduce((a, d) => a + d.claimable.length, 0)
    : 0;
  const totalNeedsActivation = plan
    ? plan.reduce((a, d) => a + (d.tickers || []).filter((t) => !t.exists).length, 0)
    : 0;

  const selectedDesks = plan ? plan.filter((d) => selected.has(d.asset_id)) : [];
  const selectedUsd = selectedDesks.reduce((s, d) => s + deskUsdValue(d), 0);
  const selectedSol = solPriceUsd ? selectedUsd / solPriceUsd : null;
  const allUsd = plan ? plan.reduce((s, d) => s + deskUsdValue(d), 0) : 0;
  const allSol = solPriceUsd ? allUsd / solPriceUsd : null;

  return (
    <div className="border border-emerald-500/30 bg-black p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-emerald-400/80">
          CLAIM_TOOL :: STOCK → WALLET
        </span>
        <div className="flex gap-1">
          <button
            onClick={selectAll}
            disabled={!desks.length || busy}
            className="border border-green-500/30 px-2 py-0.5 text-[10px] text-green-500/70 hover:border-emerald-500/50 hover:text-emerald-400 disabled:opacity-30"
          >
            [SELECT_ALL]
          </button>
          <button
            onClick={clearAll}
            disabled={busy}
            className="border border-green-500/30 px-2 py-0.5 text-[10px] text-green-500/70 hover:border-emerald-500/50 hover:text-emerald-400 disabled:opacity-30"
          >
            [CLEAR]
          </button>
        </div>
      </div>

      <p className="mt-2 text-[9px] leading-snug text-green-500/40">
        Each claim moves one ticker's accrued stock out of the desk NFT vault
        into your own wallet. Every tx is simulated first; a failing sim is
        skipped (no fee spent). The program enforces you own the NFT.
      </p>

      {Object.keys(lifetime).length > 0 && (() => {
        const tSol = Object.values(lifetime).reduce((a, d) => a + (d.value_sol || 0), 0);
        const tUsd = Object.values(lifetime).reduce((a, d) => a + (d.value_usd || 0), 0);
        return (
          <div className="mt-2 border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[9px] text-amber-400/80">
            LIFETIME_CLAIMED_BY_THIS_WALLET :: {fmtSol(tSol, 3)} · {fmtUsd(tUsd)} · {Object.keys(lifetime).length} desk(s)
          </div>
        );
      })()}

      {/* Desk list */}
      <div className="mt-2 max-h-52 overflow-y-auto border border-green-500/20">
        {desks.length === 0 && (
          <div className="p-3 text-center text-[10px] text-green-500/40">
            NO_DESKS_OWNED
          </div>
        )}
        {desks.map((d) => {
          const sel = selected.has(d.asset_id);
          const deskPlan = plan?.find((p) => p.asset_id === d.asset_id);
          return (
            <label
              key={d.asset_id}
              className={`flex cursor-pointer items-center gap-2 border-b border-green-500/10 px-2 py-1.5 ${
                sel ? "bg-emerald-500/10" : "hover:bg-green-500/5"
              }`}
            >
              <input
                type="checkbox"
                checked={sel}
                onChange={() => toggle(d.asset_id)}
                disabled={busy}
                className="accent-emerald-500"
              />
              <div className="h-8 w-8 shrink-0 overflow-hidden border border-green-500/20">
                {d.image_url ? (
                  <Image src={d.image_url} fittingType="fill" className="h-full w-full" />
                ) : (
                  <div className="flex h-full items-center justify-center text-[8px] text-green-500/30">
                    N/A
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[10px] text-green-300">
                  {d.name}
                </div>
                <div className="font-mono text-[8px] text-green-500/40">
                  {d.asset_id.slice(0, 8)}...
                </div>
              </div>
              <div className="text-right">
                {deskPlan ? (
                  <>
                    <div
                      className={`font-mono text-[11px] font-bold leading-tight ${
                        deskPlan.claimable.length ? "text-emerald-300" : "text-green-500/40"
                      }`}
                    >
                      {fmtUsd(deskUsdValue(deskPlan), 2)}
                    </div>
                    <div className="font-mono text-[8px] leading-tight text-green-500/60">
                      {fmtSol(deskSolValue(deskPlan), 4)}
                    </div>
                    <div
                      className={`font-mono text-[8px] leading-tight ${
                        deskPlan.claimable.length ? "text-cyan-400/70" : "text-green-500/30"
                      }`}
                    >
                      {deskPlan.claimable.length} CLAIMABLE
                    </div>
                    {(() => {
                      const need = (deskPlan.tickers || []).filter((t) => !t.exists).length;
                      return need > 0 ? (
                        <div className="font-mono text-[8px] leading-tight text-cyan-500/70">
                          {need} NEEDS ACTIVATE
                        </div>
                      ) : null;
                    })()}
                  </>
                ) : (
                  <div className="font-mono text-[9px] text-green-500/30">SCAN…</div>
                )}
                {lifetime[d.asset_id] && (
                  <div className="mt-0.5 border-t border-amber-500/20 pt-0.5">
                    <div className="font-mono text-[8px] leading-tight text-amber-400/70">
                      LT {fmtSol(lifetime[d.asset_id].value_sol, 3)}
                    </div>
                    <div className="font-mono text-[8px] leading-tight text-amber-300/60">
                      {fmtUsd(lifetime[d.asset_id].value_usd)}
                    </div>
                  </div>
                )}
              </div>
            </label>
          );
        })}
      </div>

      {/* Actions */}
      <div className="mt-2 flex flex-wrap gap-1">
        <button
          onClick={() => scan(true)}
          disabled={scanning || busy || !address}
          className="border border-emerald-500/50 px-2.5 py-1 text-[10px] text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-30"
        >
          {scanning ? "SCANNING..." : "[SCAN_DESKS]"}
        </button>
        <button
          onClick={() => runClaim(false)}
          disabled={!plan || busy || !totalClaimable}
          className="border border-emerald-500/50 px-2.5 py-1 text-[10px] text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-30"
        >
          {busy ? "CLAIMING..." : "[CLAIM_SELECTED]"}
        </button>
        <button
          onClick={() => runActivate(false)}
          disabled={!plan || busy || !totalNeedsActivation}
          className="border border-cyan-500/50 px-2.5 py-1 text-[10px] text-cyan-400 hover:bg-cyan-500/10 disabled:opacity-30"
        >
          {busy ? "..." : "[ACTIVATE_SELECTED]"}
        </button>
      </div>
      {plan && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-green-500/60">
          <span>{totalClaimable} claimable ticker(s)</span>
          {totalNeedsActivation > 0 && (
            <span className="text-cyan-400">
              {totalNeedsActivation} ticker(s) need activation
            </span>
          )}
          {selectedDesks.length > 0 && (
            <span className="text-emerald-400">
              SELECTED {selectedDesks.length} :: {fmtSol(selectedSol, 4)} · {fmtUsd(selectedUsd)}
            </span>
          )}
          {totalClaimable > 0 && (
            <span>
              ALL_DESKS :: {fmtSol(allSol, 4)} · {fmtUsd(allUsd)}
            </span>
          )}
        </div>
      )}

      {/* Log */}
      {logs.length > 0 && (
        <div className="mt-2 max-h-40 overflow-y-auto border border-green-500/20 bg-black p-2">
          {logs.map((l, i) => (
            <div
              key={i}
              className={`font-mono text-[9px] leading-snug ${
                l.type === "ok"
                  ? "text-emerald-400"
                  : l.type === "err"
                  ? "text-red-400"
                  : l.type === "sim"
                  ? "text-cyan-400"
                  : "text-green-500/60"
              }`}
            >
              {l.msg}
              {l.sig && (
                <a
                  href={`https://solscan.io/tx/${l.sig}`}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 underline hover:text-emerald-300"
                >
                  [SCAN]
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}