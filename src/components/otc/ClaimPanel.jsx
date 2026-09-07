import React, { useEffect, useState } from "react";
import { Image } from "@/components/ui/image";
import { buildClaimInstructions, buildActivateInstructions, buildDistributeInstructions, buildClaimPairs, executeClaimChunked, executePairedClaim, probeOwed } from "@/lib/otcClaim";
import { getSignerForAddress, abortPendingSigns } from "@/lib/walletSigner";
import { fetchTokenPricesUsd, SOL_MINT } from "@/lib/stockPrices";
import { fmtSol, fmtUsd } from "@/lib/format";
import { base44 } from "@/api/base44Client";
import HelpNote from "@/components/otc/HelpNote";
import TxStatusOverlay from "@/components/otc/TxStatusOverlay";

export default function ClaimPanel({
  address,
  holdings,
  onClaimed,
  onScan,
  lifetimeData,
  refreshLifetime,
  command,
  onCommandDone,
}) {
  const [selected, setSelected] = useState(() => new Set());
  const [tpMap, setTpMap] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState([]);
  const [prices, setPrices] = useState({});
  const [cleared, setCleared] = useState(() => new Set()); // desks claimed & emptied this session
  const [pullOwed, setPullOwed] = useState(false); // OFF = atomic distribute+claim pairs (fast); ON = also activate + distribute ALL owed backlog first
  const [progress, setProgress] = useState(null); // { group, totalGroups, phase } live chunk progress
  const [owed, setOwed] = useState(null); // PULL_OWED probe: asset_id -> { items: [{symbol, mint, decimals, amount}] }
  const [probing, setProbing] = useState(false);

  const desks = holdings || [];
  const log = (l) => setLogs((prev) => [...prev, { ...l, t: Date.now() }]);

  // Compact age label for a timestamp ("2h 5m ago").
  const agoLabel = (iso) => {
    if (!iso) return null;
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms) || ms < 0) return null;
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  // Per-desk lifetime claimed totals come from the parent wallet panel (the
  // single shared getLifetimeClaims fetch) so connecting doesn't fire a second
  // identical on-chain scan alongside the portfolio's own.
  const lifetime = React.useMemo(() => {
    const map = {};
    for (const d of lifetimeData?.by_desk || []) map[d.asset_id] = d;
    return map;
  }, [lifetimeData]);

  // USD spot price per mint, plus SOL spot (keyed by SOL_MINT). Re-fetched
  // whenever the scan plan changes so claim values stay current.
  useEffect(() => {
    if (!plan) return;
    const mints = new Set([SOL_MINT]);
    for (const d of plan) for (const t of d.tickers || []) mints.add(t.mint);
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
  // USD value of a desk's probe-detected owed backlog (only PULL_OWED can
  // reach it — the fast path claims stock already in the vault).
  const owedUsdFor = (o) =>
    (o?.items || []).reduce(
      (s, t) => s + (t.amount / 10 ** t.decimals) * (prices[t.mint] || 0),
      0
    );

  const toggle = (id) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const selectAll = () => setSelected(new Set(desks.map((d) => d.asset_id)));
  const clearAll = () => setSelected(new Set());
  // Recommended batch: the top 3 desks by claimable value. Large all-at-once
  // runs can fail/timeout at the wallet prompt, so the panel nudges toward
  // small batches — but the user can still claim everything if they choose.
  const selectRecommended = () => {
    if (!plan) return;
    const ranked = [...plan]
      .filter((d) => d.claimable?.length)
      .sort((a, b) => deskUsdValue(b) - deskUsdValue(a));
    setSelected(new Set(ranked.slice(0, 3).map((d) => d.asset_id)));
  };

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
    // Bubble the live scan up so the portfolio's EARN_TO_CLAIM total tracks it.
    if (onScan) onScan(list);
    return list;
  };

  // PULL_OWED probe: unsigned simulations (no fee, no wallet prompt) check
  // whether any desk has owed backlog in the protocol pot that only a
  // PULL_OWED run would move into the vault. Runs in the background after
  // every scan; the result drives the NEEDED / NOT NEEDED verdict.
  const runProbe = async (list) => {
    if (!address || !list?.length) return;
    setProbing(true);
    try {
      setOwed(await probeOwed(list, address));
    } catch {
      /* probe is best-effort — the verdict falls back to NOT NEEDED */
    } finally {
      setProbing(false);
    }
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
      runProbe(list); // background — never blocks the scan
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



  // Chunked claim pipeline for large runs (300+ claimable). Wallets can't sign
  // 100+ txs in one prompt reliably (they reject or the blockhash expires), so
  // instructions are split into groups and each group is ONE wallet approval: a
  // fresh blockhash per group, simulated first, signed in a single prompt, sent
  // sequentially, then the next group.
  //   Default (PULL_OWED OFF): withdraws every ticker already sitting in the
  //   desk vaults — smooth, few approvals. This is what 99% of claims need.
  //   PULL_OWED ON: also activates missing ticker accounts and distributes the
  //   owed backlog from the protocol pot into the vaults first, so the claims
  //   in the same run capture the freshly-distributed stock too. Adds ~desks×13
  //   instructions → more groups/approvals; run occasionally, not every claim.
  const runClaimAll = async (explicitIds = null) => {
    const signer = getSignerForAddress(address);
    if (!signer) {
      log({ type: "err", msg: "No signing wallet connected for this address." });
      return;
    }
    if (!plan || !plan.length) {
      log({ type: "err", msg: "Nothing to claim — run a scan first." });
      return;
    }
    // Operate on the desks named by the caller (a single desk from the
    // holdings dialog), else the selected desks, else all owned desks.
    const targetIds = new Set(
      explicitIds || (selected.size ? [...selected] : plan.map((d) => d.asset_id))
    );
    const targets = plan.filter((d) => targetIds.has(d.asset_id));
    if (!targets.length) {
      log({ type: "err", msg: "Nothing to claim — run a scan first." });
      return;
    }
    setBusy(true);
    try {
      const claimable = targets.filter((d) => d.claimable.length);
      if (!claimable.length && !pullOwed) {
        log({ type: "err", msg: "Nothing to claim — no claimable tickers. Toggle [PULL_OWED] to pull owed backlog first." });
        return;
      }
      setProgress(null);

      let results;
      if (pullOwed) {
        // Full backlog pull: activate missing accounts, distribute ALL 13
        // slots per desk (pulls owed into empty vaults too), then claim. Uses
        // the chunked executor (cross-tx distribute→claim ordering, pauses
        // between groups). Run occasionally to refresh empty vaults.
        const orderedIxs = [];
        const toActivate = [];
        for (const d of targets) for (const t of d.tickers || []) if (!t.exists) toActivate.push(t);
        if (toActivate.length) {
          const actIxs = await buildActivateInstructions(targets, address, tpMap);
          orderedIxs.push(...actIxs);
          log({ type: "info", msg: `ACTIVATE :: ${toActivate.length} ticker account(s) to open.` });
        } else {
          log({ type: "info", msg: `ACTIVATE :: all ticker accounts already open.` });
        }
        const distIxs = await buildDistributeInstructions(targets, address, tpMap);
        orderedIxs.push(...distIxs);
        log({ type: "info", msg: `DISTRIBUTE_ALL :: ${distIxs.length} ixs (${targets.length} desks × 13 slots) — pulling owed backlog.` });
        const claimIxs = await buildClaimInstructions(claimable, address, tpMap);
        orderedIxs.push(...claimIxs);
        log({ type: "info", msg: `CLAIM :: ${claimable.length} desk(s), ${claimIxs.length} claimable ticker(s).` });
        results = await executeClaimChunked(orderedIxs, address, signer.signAllTransactionsRaw, log, 60, setProgress);
        // The sweep above may have delivered backlog into vaults that had
        // NOTHING claimable at scan time — those desks were excluded from
        // `claimable` and would end the run still full. Re-scan the targets
        // and fast-path claim whatever was newly delivered, in the same run.
        const rescanned = await scan({ force: true, silent: true });
        const newClaimable = (rescanned || []).filter(
          (d) => targetIds.has(d.asset_id) && d.claimable?.length
        );
        if (newClaimable.length) {
          log({
            type: "info",
            msg: `BACKLOG :: ${newClaimable.length} desk(s) received newly delivered stock — claiming...`,
          });
          const pairs = await buildClaimPairs(newClaimable, address, tpMap);
          const r2 = await executePairedClaim(pairs, address, signer.signAllTransactionsRaw, log, 60, setProgress);
          results.push(...r2);
          setCleared((prev) => {
            const n = new Set(prev);
            for (const d of newClaimable) n.add(d.asset_id);
            return n;
          });
        }
      } else {
        // Fast path: one atomic [distribute(slot), claim(ticker)] tx per
        // claimable ticker. Each tx is self-contained (its claim depends only
        // on its own distribute in the same tx), so txs are independent —
        // signed in a few large batches and sent in parallel with no pauses.
        // This is the smooth default for claiming already-owed stock.
        const pairs = await buildClaimPairs(claimable, address, tpMap);
        log({ type: "info", msg: `PAIRS :: ${pairs.length} atomic distribute+claim pair(s).` });
        results = await executePairedClaim(pairs, address, signer.signAllTransactionsRaw, log, 60, setProgress);
      }
      const ok = results.filter((r) => r.ok).length;
      const fail = results.length - ok;
      log({ type: fail ? "err" : "ok", msg: `DONE :: ${ok} confirmed, ${fail} failed (of ${results.length} tx).` });

      if (ok > 0) {
        setCleared((prev) => {
          const n = new Set(prev);
          for (const d of claimable) n.add(d.asset_id);
          return n;
        });
        // Lifetime totals are authoritative on-chain now: re-scan the wallet's
        // OTC claim history (force bypasses the 5-min cache) so the totals
        // reflect exactly what landed in this run — no client estimate.
        log({ type: "info", msg: "Refreshing lifetime totals from on-chain history..." });
        await refreshLifetime?.(true);
        log({ type: "ok", msg: "Lifetime totals refreshed from on-chain claim history." });
        // Re-scan the vault balances (force bypasses the 5-min scan cache).
        // Claims are already confirmed on-chain, so just-claimed tickers now
        // read ZERO — without this the stale plan keeps listing them as
        // claimable and invites a pointless re-claim of empty vaults.
        log({ type: "info", msg: "Refreshing desk claimable balances..." });
        const rescanned = await scan({ force: true, silent: true });
        if (rescanned) {
          log({ type: "ok", msg: "Claimable balances refreshed — cleared desks now show 0." });
        } else {
          log({
            type: "err",
            msg: "Rescan failed — counts may be stale. Press [SCAN_DESKS] before claiming again.",
          });
        }
        // Reload the portfolio LAST. It unmounts/remounts this panel, and by
        // then the post-claim vault scan above is already cached — so the
        // remounted panel serves zeros. Firing it earlier orphaned the
        // refreshes: the panel remounted mid-run, served the pre-claim cache
        // within its TTL, and claimable counts never reset.
        if (onClaimed) onClaimed();
      }
    } catch (e) {
      log({ type: "err", msg: `CLAIM_ABORT: ${e.message}` });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  // ACTIVATE_ONLY: open a desk's missing ticker accounts (the claim
  // pre-requisite — distributions can only land in vaults whose accounts
  // exist) WITHOUT claiming. Aimed at a single desk from the holdings
  // dialog; reuses the chunked executor and refresh ordering of the claim runs.
  const runActivateOnly = async (ids) => {
    const signer = getSignerForAddress(address);
    if (!signer) {
      log({ type: "err", msg: "No signing wallet connected for this address." });
      return;
    }
    if (!plan || !plan.length) {
      log({ type: "err", msg: "Nothing to activate — run a scan first." });
      return;
    }
    const targets = plan.filter((d) => ids.includes(d.asset_id));
    if (!targets.length) {
      log({ type: "err", msg: "Desk not found in the vault scan." });
      return;
    }
    const missing = targets.flatMap((d) => (d.tickers || []).filter((t) => !t.exists));
    if (!missing.length) {
      log({ type: "ok", msg: `ACTIVATE :: ${targets[0].name} — all ticker accounts already open.` });
      return;
    }
    setBusy(true);
    setProgress(null);
    try {
      const actIxs = await buildActivateInstructions(targets, address, tpMap);
      log({ type: "info", msg: `ACTIVATE :: opening ${actIxs.length} ticker account(s) for ${targets.length} desk(s).` });
      const results = await executeClaimChunked(actIxs, address, signer.signAllTransactionsRaw, log, 60, setProgress);
      const ok = results.filter((r) => r.ok).length;
      log({
        type: results.length - ok ? "err" : "ok",
        msg: `DONE :: ${ok} confirmed, ${results.length - ok} failed (of ${results.length} tx).`,
      });
      const rescanned = await scan({ force: true, silent: true });
      if (rescanned) log({ type: "ok", msg: "Vault scan refreshed — activation state updated." });
      if (ok > 0 && onClaimed) onClaimed();
    } catch (e) {
      log({ type: "err", msg: `ACTIVATE_ABORT: ${e.message}` });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  // Desk-level commands from the holdings detail dialog: claim this desk's
  // earnings or activate its missing ticker accounts. Both reuse the exact
  // pipelines above — the dialog just aims them at one desk. Waits until the
  // vault scan plan is loaded and no other run is in flight.
  useEffect(() => {
    if (!command || !plan || busy) return;
    const desk = plan.find((p) => p.asset_id === command.assetId);
    if (!desk) {
      onCommandDone?.();
      return;
    }
    setSelected(new Set([command.assetId]));
    (async () => {
      if (command.mode === "activate") await runActivateOnly([command.assetId]);
      else await runClaimAll([command.assetId]);
      onCommandDone?.();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command, plan, busy]);

  const totalClaimable = plan ? plan.reduce((a, d) => a + d.claimable.length, 0) : 0;
  const totalNeedsActivation = plan
    ? plan.reduce((a, d) => a + (d.tickers || []).filter((t) => !t.exists).length, 0)
    : 0;
  // Verdict: is PULL_OWED needed? Owed backlog detected by the probe, or
  // ticker accounts that must be activated first (the fast path can reach
  // neither).
  const owedTotalUsd = owed ? [...owed.values()].reduce((s, o) => s + owedUsdFor(o), 0) : 0;
  const pullNeeded = owedTotalUsd > 0 || totalNeedsActivation > 0;
  const allUsd = plan ? plan.reduce((s, d) => s + deskUsdValue(d), 0) : 0;
  const allSol = solPriceUsd ? allUsd / solPriceUsd : null;

  const targetCount = selected.size || (plan ? plan.length : 0);
  const distIxEst = pullOwed ? 13 * targetCount : totalClaimable;
  const estApprovals = pullOwed
    ? Math.ceil((totalClaimable + distIxEst) / 60) || 0
    : Math.ceil(totalClaimable / 60) || 0;
  const phaseLabel = busy
    ? progress
      ? progress.phase === "resolve"
        ? "RESOLVING…"
        : `G${progress.group}/${progress.totalGroups} ${progress.phase.toUpperCase()} · ${progress.signaturesLeft ?? ""}SIG`
      : "PROCESSING…"
    : pullOwed
    ? "PULL_OWED + CLAIM"
    : "CLAIM";

  // Global status overlay: map the claim pipeline's internal phase to the
  // fixed bottom banner so the app never looks frozen during a run.
  const overlayPhase = busy
    ? progress && progress.phase !== "start"
      ? progress.phase
      : "prep"
    : null;
  const overlayDetail = progress
    ? progress.phase === "send" && progress.txCur
      ? `TX ${progress.txCur}/${progress.txTotal}`
      : progress.phase === "confirm"
      ? `${progress.pending ?? 0} tx(s) awaiting block`
      : progress.phase === "sign"
      ? `${progress.signaturesLeft} approval(s) left`
      : progress.group
      ? `GROUP ${progress.group}/${progress.totalGroups}`
      : null
    : null;

  return (
    <div className="border border-emerald-500/30 bg-black p-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] uppercase tracking-widest text-emerald-400/80">
          CLAIM_TOOL :: STOCK → WALLET
        </span>
        <div className="flex gap-1">
          <button
            onClick={selectRecommended}
            disabled={busy || !plan}
            title="Select the top 3 desks by claimable value — recommended batch size"
            className="border border-amber-500/40 px-2 py-0.5 text-[12px] text-amber-400 hover:border-amber-400/60 disabled:opacity-30"
          >
            [REC_TOP3]
          </button>
          <button
            onClick={selectAll}
            disabled={!desks.length || busy}
            className="border border-green-500/30 px-2 py-0.5 text-[12px] text-green-500/70 hover:border-emerald-500/50 hover:text-emerald-400 disabled:opacity-30"
          >
            [SELECT_ALL]
          </button>
          <button
            onClick={clearAll}
            disabled={busy}
            className="border border-green-500/30 px-2 py-0.5 text-[12px] text-green-500/70 hover:border-emerald-500/50 hover:text-emerald-400 disabled:opacity-30"
          >
            [CLEAR]
          </button>
        </div>
      </div>

      <HelpNote label="[?] HOW_IT_WORKS" className="mt-2">
        Each ticker is probed unsigned (no fee) for how many distributes its claim needs; failing
        sims are skipped (no fee spent); the program enforces you own the NFT. The PULL_OWED
        verdict is probed the same way — a free unsigned distribute per empty ticker shows
        whether owed backlog exists that only PULL_OWED can pull. PULL_OWED ON also
        opens missing accounts and pulls the full owed backlog first (more approvals; run
        occasionally). NOTE: claims drain the vault to ZERO on-chain, but desks re-accrue new
        stock continuously — balances that reappear after a claim (marked ↻ NEW_ACCRUAL) are
        fresh distributions, not stale data. [SCAN_DESKS] always re-reads live vault balances.
      </HelpNote>

      {Object.keys(lifetime).length > 0 && (() => {
        const tSol = Object.values(lifetime).reduce((a, d) => a + (d.value_sol || 0), 0);
        const tUsd = Object.values(lifetime).reduce((a, d) => a + (d.value_usd || 0), 0);
        return (
          <div className="mt-2 border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-400/80">
            LIFETIME_CLAIMED (ON-CHAIN) :: {fmtSol(tSol, 3)} · {fmtUsd(tUsd)} · {Object.keys(lifetime).length} desk(s)
          </div>
        );
      })()}

      {/* Desk list (read-only status) */}
      <div className="mt-2 max-h-52 overflow-y-auto border border-green-500/20">
        {desks.length === 0 && (
          <div className="p-3 text-center text-[12px] text-green-500/40">
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
          const lastClaim = lifetime[d.asset_id]?.last_claim_at || null;
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
                  <div className="flex h-full items-center justify-center text-[10px] text-green-500/30">
                    N/A
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[12px] text-green-300">
                  {d.name}
                </div>
                <div className="font-mono text-[10px] text-green-500/40">
                  {d.asset_id.slice(0, 8)}...
                </div>
              </div>
              <div className="text-right">
                {deskPlan ? (
                  <>
                    <div
                      className={`font-mono text-[13px] font-bold leading-tight ${
                        deskPlan.claimable.length ? "text-emerald-300" : "text-green-500/40"
                      }`}
                    >
                      {fmtUsd(deskUsdValue(deskPlan), 2)}
                    </div>
                    <div className="font-mono text-[10px] leading-tight text-green-500/60">
                      {fmtSol(deskSolValue(deskPlan), 4)}
                    </div>
                    {deskPlan.claimable.length > 0 ? (
                      <div
                        className="font-mono text-[10px] leading-tight text-cyan-400/70"
                        title={
                          lastClaim
                            ? `Fresh stock accrued since your last claim (${agoLabel(lastClaim)})`
                            : undefined
                        }
                      >
                        {lastClaim ? "↻ " : ""}
                        {deskPlan.claimable.length} {lastClaim ? "NEW_ACCRUAL" : "CLAIMABLE"}
                      </div>
                    ) : cleared.has(d.asset_id) ? (
                      <div className="font-mono text-[10px] leading-tight text-emerald-400">
                        ✓ CLEARED
                      </div>
                    ) : (
                      <div className="font-mono text-[10px] leading-tight text-green-500/30">
                        0 CLAIMABLE
                      </div>
                    )}
                    {(() => {
                      const need = (deskPlan.tickers || []).filter((t) => !t.exists).length;
                      return need > 0 ? (
                        <div className="font-mono text-[10px] leading-tight text-cyan-500/70">
                          {need} NEEDS ACTIVATE
                        </div>
                      ) : null;
                    })()}
                    {(() => {
                      const o = owed?.get(d.asset_id);
                      if (!o?.items?.length) return null;
                      return (
                        <div className="font-mono text-[10px] leading-tight text-cyan-300/80">
                          OWED ≥ {fmtUsd(owedUsdFor(o), 2)} · PULL_OWED
                        </div>
                      );
                    })()}
                  </>
                ) : (
                  <div className="font-mono text-[11px] text-green-500/30">SCAN…</div>
                )}
                {lifetime[d.asset_id] && (
                  <div className="mt-0.5 border-t border-amber-500/20 pt-0.5">
                    <div className="font-mono text-[10px] leading-tight text-amber-400/70">
                      LT {fmtSol(lifetime[d.asset_id].value_sol, 3)}
                    </div>
                    <div className="font-mono text-[10px] leading-tight text-amber-300/60">
                      {fmtUsd(lifetime[d.asset_id].value_usd)}
                    </div>
                    {lastClaim && (
                      <div className="font-mono text-[10px] leading-tight text-amber-300/40">
                        LAST_CLAIM {agoLabel(lastClaim)}
                      </div>
                    )}
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
          className="border border-green-500/40 px-2.5 py-1 text-[12px] text-green-400 hover:border-emerald-500/50 hover:text-emerald-400 disabled:opacity-30"
        >
          {scanning ? "SCANNING..." : "[SCAN_DESKS]"}
        </button>
        <button
          onClick={() => setPullOwed((v) => !v)}
          disabled={busy}
          title="ON: also activate missing accounts + pull owed backlog from the protocol pot before claiming (more approvals). OFF: claim only stock already in the vaults (smooth)."
          className={`border px-2.5 py-1 text-[12px] disabled:opacity-30 ${pullOwed ? "border-cyan-400 text-cyan-300 bg-cyan-500/10" : "border-green-500/40 text-green-400 hover:border-emerald-500/50"}`}
        >
          [PULL_OWED:{pullOwed ? "ON" : "OFF"}]
        </button>
        <button
          onClick={() => runClaimAll()}
          disabled={!plan || busy || !desks.length}
          className="border border-emerald-500/60 px-3 py-1 text-[12px] font-bold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-30"
        >
          {busy ? phaseLabel : selected.size ? `[CLAIM_SELECTED (${selected.size})]` : "[CLAIM_ALL]"}
        </button>
      </div>
      {plan && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-green-500/60">
          <span className="text-amber-400/80">
            REC :: ≤3 DESKS PER RUN — larger batches may fail/timeout
          </span>
          <span>{totalClaimable} claimable ticker(s)</span>
          {totalNeedsActivation > 0 && (
            <span className="text-cyan-400">
              {totalNeedsActivation} ticker(s) need activation
            </span>
          )}
          {!busy && (
            <span
              className={pullNeeded ? "text-cyan-300" : "text-emerald-400/70"}
              title="Probed unsigned on-chain: would PULL_OWED deliver stock the fast path can't reach?"
            >
              PULL_OWED ::{" "}
              {probing
                ? "PROBING…"
                : pullNeeded
                ? `NEEDED — ≥${fmtUsd(owedTotalUsd, 2)} owed${totalNeedsActivation ? ` · ${totalNeedsActivation} to activate` : ""}`
                : "NOT NEEDED"}
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
          {totalClaimable > 0 && (
            <span className="text-cyan-400">
              ~{estApprovals} approval(s) · {totalClaimable + distIxEst} ix
            </span>
          )}
        </div>
      )}

      {/* Live claim progress: which desks are in the current signing group and
          how many wallet signatures remain. */}
      {busy && progress && (
        <div className="mt-2 border border-emerald-500/40 bg-emerald-500/5 p-2">
          <div className="flex items-center justify-between font-mono text-[12px]">
            <span className="text-emerald-300">
              {progress.phase === "resolve"
                ? "RESOLVING TICKERS…"
                : progress.phase === "start"
                ? `INIT · ${progress.totalGroups} GROUP(S)`
                : progress.phase === "confirm"
                ? `CONFIRMING :: ${progress.pending ?? 0} TX ON-CHAIN`
                : `GROUP ${progress.group}/${progress.totalGroups} · ${progress.phase.toUpperCase()}${
                    progress.phase === "send" && progress.txCur ? ` ${progress.txCur}/${progress.txTotal}` : ""
                  }`}
            </span>
            <span className="text-cyan-300">
              {progress.phase === "resolve"
                ? "PROBING"
                : progress.phase === "confirm"
                ? "WAITING FOR BLOCK"
                : `${progress.signaturesLeft} SIG LEFT`}
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full bg-green-500/10">
            <div
              className={`h-full bg-emerald-400 ${progress.phase === "resolve" ? "animate-pulse" : "transition-all duration-300"}`}
              style={{
                width: `${progress.phase === "resolve" ? 100 : progress.totalGroups ? Math.min(100, (progress.group / progress.totalGroups) * 100) : 0}%`,
              }}
            />
          </div>
          {progress.desks && progress.desks.length > 0 && (
            <div className="mt-1 font-mono text-[11px] leading-snug text-green-500/70">
              <span className="text-emerald-400/90">PROCESSING:</span>{" "}
              {progress.desks.join(" · ")}
            </div>
          )}
        </div>
      )}

      {overlayPhase && (
        <TxStatusOverlay
          phase={overlayPhase}
          detail={overlayDetail}
          // CANCEL is only offered during the SIGNATURE phase — before that
          // there is nothing to abort, and after it txs are already in flight.
          onCancel={
            overlayPhase === "sign"
              ? () => abortPendingSigns("Cancelled by user — no tx was sent")
              : null
          }
        />
      )}

      {/* Log */}
      {logs.length > 0 && (
        <div className="mt-2 max-h-40 overflow-y-auto border border-green-500/20 bg-black p-2">
          {logs.map((l, i) => (
            <div
              key={i}
              className={`break-all font-mono text-[11px] leading-snug ${
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