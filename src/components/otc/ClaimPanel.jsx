import React, { useEffect, useState } from "react";
import { Image } from "@/components/ui/image";
import { buildClaimInstructions, buildActivateInstructions, buildDistributeInstructions, packTxs, executeClaimTxsBatch } from "@/lib/otcClaim";
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
  const [cleared, setCleared] = useState(() => new Set()); // desks claimed & emptied this session

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

  // Single unified claim pipeline — ONE wallet approval for the whole run.
  // Builds every instruction (activate → distribute → claim) up front in
  // execution order, packs them into transactions, simulates ALL of them, then
  // asks the wallet to sign the entire batch with a single signAllTransactions
  // prompt (Phantom / Solflare / Backpack approve all at once). Txs are sent in
  // order so on-chain they execute activate → distribute → claim; the claim
  // instruction moves the desk vault's FULL post-distribute balance to the
  // signer, so the owed backlog distribute just pulled in is captured in the
  // same batch. Every tx is simulated first — a failing sim is dropped, so the
  // wallet never signs a tx that would fail (no fee spent on it). This collapses
  // what used to be 2–3 separate signing prompts down to a single one.
  //   ACTIVATE   — open missing ticker vault accounts (skipped if all open).
  //   DISTRIBUTE — pull each desk's owed backlog from the protocol pot into its
  //                vault (permissionless; no-op for tickers already current).
  //   CLAIM      — withdraw every claimable ticker from each vault to the wallet.
  const runClaimAll = async () => {
    const signer = getSignerForAddress(address);
    if (!signer) {
      log({ type: "err", msg: "No signing wallet connected for this address." });
      return;
    }
    if (!plan || !plan.length) {
      log({ type: "err", msg: "Nothing to claim — run a scan first." });
      return;
    }
    // Operate on selected desks, or all owned desks if none are selected.
    const targetIds = selected.size ? selected : new Set(plan.map((d) => d.asset_id));
    const targets = plan.filter((d) => targetIds.has(d.asset_id));
    if (!targets.length) {
      log({ type: "err", msg: "Nothing to claim — run a scan first." });
      return;
    }
    setBusy(true);
    try {
      const allIxs = [];

      // 1. ACTIVATE — only ticker vault accounts that aren't open yet.
      const toActivate = [];
      for (const d of targets) for (const t of d.tickers || []) if (!t.exists) toActivate.push(t);
      if (toActivate.length) {
        const actIxs = await buildActivateInstructions(targets, address, tpMap);
        allIxs.push(...actIxs);
        log({ type: "info", msg: `ACTIVATE :: ${toActivate.length} ticker account(s) to open.` });
      } else {
        log({ type: "info", msg: `ACTIVATE :: all ticker accounts already open.` });
      }

      // 2. DISTRIBUTE — owed backlog → vault. All 13 lineup slots per desk.
      // The bulk of the tx count comes from here (desks × 13); it's required to
      // pull owed stock out of the protocol pot so claim can move it.
      const distIxs = await buildDistributeInstructions(targets, address, tpMap);
      allIxs.push(...distIxs);
      log({ type: "info", msg: `DISTRIBUTE :: ${distIxs.length} ixs (${targets.length} desks × 13 slots).` });

      // 3. CLAIM — vault → wallet. Claimable tickers from the pre-scan. The
      // claim ix transfers the vault's full balance AT EXECUTION (after
      // distribute lands), so it captures the owed backlog too. Tickers that
      // are empty now but owed get distributed into the vault this run and
      // become claimable on the next run — no stock is lost, just deferred.
      const claimable = targets.filter((d) => d.claimable.length);
      if (claimable.length) {
        const claimIxs = await buildClaimInstructions(claimable, address, tpMap);
        allIxs.push(...claimIxs);
        log({ type: "info", msg: `CLAIM :: ${claimable.length} desk(s), ${claimIxs.length} claimable ticker(s).` });
      }

      if (!allIxs.length) {
        log({ type: "err", msg: "Nothing to do — no activate/distribute/claim needed." });
        return;
      }

      const txs = await packTxs(allIxs, address);
      log({ type: "info", msg: `BATCH :: ${txs.length} tx(s) :: 1 wallet approval.` });
      const results = await executeClaimTxsBatch(txs, signer.signAllTransactionsRaw, log);
      const ok = results.filter((r) => r.ok).length;
      const fail = results.length - ok;
      log({ type: fail ? "err" : "ok", msg: `DONE :: ${ok} confirmed, ${fail} failed (of ${results.length} tx).` });

      if (ok > 0) {
        if (onClaimed) onClaimed();
        // Lifetime log: value the claimable tickers we sent claims for at their
        // pre-distribute vault balances. The on-chain claim actually moves the
        // full post-distribute balance (≥ this), so this is a conservative
        // (lower-bound) lifetime record.
        const claimed = [];
        for (const d of claimable) {
          for (const t of d.claimable) {
            const amountHuman = t.amount / 10 ** t.decimals;
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
        if (claimed.length) {
          setCleared((prev) => {
            const n = new Set(prev);
            for (const c of claimed) n.add(c.asset_id);
            return n;
          });
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

  const totalClaimable = plan ? plan.reduce((a, d) => a + d.claimable.length, 0) : 0;
  const totalNeedsActivation = plan
    ? plan.reduce((a, d) => a + (d.tickers || []).filter((t) => !t.exists).length, 0)
    : 0;
  const allUsd = plan ? plan.reduce((s, d) => s + deskUsdValue(d), 0) : 0;
  const allSol = solPriceUsd ? allUsd / solPriceUsd : null;

  const phaseLabel = busy ? "PROCESSING... (1 SIGN)" : "ACTIVATE → DIST → CLAIM (1 SIGN)";

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
        One click runs the full pipeline: open any missing ticker accounts,
        distribute owed stock into each desk vault, then withdraw every
        claimable ticker into your wallet. Every tx is simulated first; a
        failing sim is skipped (no fee spent). The program enforces you own
        the NFT.
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

      {/* Desk list (read-only status) */}
      <div className="mt-2 max-h-52 overflow-y-auto border border-green-500/20">
        {desks.length === 0 && (
          <div className="p-3 text-center text-[10px] text-green-500/40">
            NO_DESKS_OWNED
          </div>
        )}
        {[...desks]
          .sort((a, b) => {
            const va = deskUsdValue(plan?.find((p) => p.asset_id === a.asset_id)) || 0;
            const vb = deskUsdValue(plan?.find((p) => p.asset_id === b.asset_id)) || 0;
            return vb - va;
          })
          .map((d) => {
          const deskPlan = plan?.find((p) => p.asset_id === d.asset_id);
          const sel = selected.has(d.asset_id);
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
                    {deskPlan.claimable.length > 0 ? (
                      <div className="font-mono text-[8px] leading-tight text-cyan-400/70">
                        {deskPlan.claimable.length} CLAIMABLE
                      </div>
                    ) : cleared.has(d.asset_id) ? (
                      <div className="font-mono text-[8px] leading-tight text-emerald-400">
                        ✓ CLEARED
                      </div>
                    ) : (
                      <div className="font-mono text-[8px] leading-tight text-green-500/30">
                        0 CLAIMABLE
                      </div>
                    )}
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

      {/* Actions: a single scan + a single unified claim button */}
      <div className="mt-2 flex flex-wrap gap-1">
        <button
          onClick={() => scan(true)}
          disabled={scanning || busy || !address}
          className="border border-green-500/40 px-2.5 py-1 text-[10px] text-green-400 hover:border-emerald-500/50 hover:text-emerald-400 disabled:opacity-30"
        >
          {scanning ? "SCANNING..." : "[SCAN_DESKS]"}
        </button>
        <button
          onClick={runClaimAll}
          disabled={!plan || busy || !desks.length}
          className="border border-emerald-500/60 px-3 py-1 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-30"
        >
          {busy ? phaseLabel : selected.size ? `[CLAIM_SELECTED (${selected.size})]` : "[CLAIM_ALL]"}
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
          {selected.size > 0 && (
            <span className="text-emerald-400">
              SELECTED {selected.size} desks
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