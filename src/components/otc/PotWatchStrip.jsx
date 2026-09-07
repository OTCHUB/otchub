import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { fmtSol, timeAgo } from "@/lib/format";

// Live fee-routing health, polled from the getPotRoutingHealth backend check:
// desks-owed coverage (the ecosystem's pivotal obligation), protocol CONFIG
// change detection (route map goes stale the moment the dev reconfigures
// fees) and the pot's last real SOL inflow. Every value is read fresh
// on-chain by the backend — nothing here is hardcoded.
const POLL_MS = 90_000;

const Chip = ({ tone, children }) => {
  const cls =
    tone === "red"
      ? "border-red-500/50 bg-red-500/10 text-red-400"
      : tone === "amber"
        ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
        : "border-emerald-500/50 bg-emerald-500/10 text-emerald-300";
  return <span className={`shrink-0 border px-1 font-mono text-[9px] ${cls}`}>{children}</span>;
};

export default function PotWatchStrip() {
  const [watch, setWatch] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let dead = false;
    const load = async () => {
      try {
        const res = await base44.functions.invoke("getPotRoutingHealth");
        if (!dead) { setWatch(res.data); setErr(null); }
      } catch (e) {
        if (!dead) setErr(e?.response?.data?.error || e.message || "watch offline");
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => { dead = true; clearInterval(id); };
  }, []);

  const c = watch?.checks || {};
  const owed = watch?.owed_sol;
  const potSol = watch?.pot?.sol;
  // Coverage bar: pot balance against the desks-owed obligation.
  const coverPct =
    owed != null && potSol != null && owed > 0 ? Math.min(100, (potSol / owed) * 100) : null;
  const inflow = watch?.pot_activity?.last_inflow;

  return (
    <div className="space-y-1 border border-green-500/20 px-2 py-1.5">
      {/* desk owing — the pivotal obligation, always first */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-green-300">
          DESKS OWED :: {fmtSol(owed, 2)}
        </span>
        {c.covered === true && <Chip tone="green">POT COVERS OWED</Chip>}
        {c.covered === false && <Chip tone="red">SHORTFALL −{fmtSol(c.shortfall_sol, 2)}</Chip>}
        {watch?.desks != null && (
          <span className="font-mono text-[9px] text-green-500/50">{watch.desks} DESKS</span>
        )}
        <span className="ml-auto shrink-0 font-mono text-[9px] text-green-500/60">
          POT {fmtSol(potSol, 2)}
          {watch?.at ? ` · checked ${timeAgo(new Date(watch.at).toISOString())}` : ""}
        </span>
      </div>
      {coverPct != null && (
        <span
          role="progressbar"
          aria-label="Pot balance vs desks owed coverage"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(coverPct)}
          className="flex h-1.5 w-full overflow-hidden border border-green-500/30 bg-green-500/5"
        >
          <span
            className={c.covered === false ? "bg-red-400/80" : "bg-emerald-400/80"}
            style={{ width: `${coverPct}%` }}
          />
        </span>
      )}

      {/* config watch — catches any on-chain fee-config change */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[9px]">
        <span className="uppercase tracking-widest text-green-500/50">CONFIG_WATCH</span>
        {watch == null && <span className="text-green-500/40">{err ? "OFFLINE" : "…"}</span>}
        {watch?.config?.changed ? (
          <Chip tone="red">⚠ CONFIG CHANGED — ROUTE MAP STALE — RE-VERIFY</Chip>
        ) : watch?.config?.hash ? (
          <span className="text-green-500/50">
            fp:{watch.config.hash.slice(0, 8)} · unchanged since{" "}
            {watch.config.since ? timeAgo(new Date(watch.config.since).toISOString()) : "—"}
          </span>
        ) : null}
        {watch?.config?.hash ? (
          <a
            href={`https://solscan.io/account/9b5VLbpXedgXcjWyboXqHMbDgeHJtb5PBsy6TE18REU4`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto shrink-0 text-cyan-300/70 underline hover:text-cyan-300"
          >
            CFG ↗
          </a>
        ) : null}
      </div>

      {/* live pot inflow */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[9px]">
        <span className="uppercase tracking-widest text-green-500/50">POT_LAST_INFLOW</span>
        {inflow ? (
          <>
            <span className="text-emerald-300">+{fmtSol(inflow.sol, 3)}</span>
            <span className="text-green-500/50">{timeAgo(new Date(inflow.at).toISOString())}</span>
            {c.pot_live === false && (
              <Chip tone="red">NO FRESH INFLOW &gt; {watch.pot_activity.window_h}H</Chip>
            )}
          </>
        ) : watch ? (
          <Chip tone="red">NO INFLOW IN RECENT TX SAMPLE</Chip>
        ) : null}
        {!!watch?.pot_activity?.inflow_window_sol && (
          <span className="text-green-500/40">
            {fmtSol(watch.pot_activity.inflow_window_sol, 2)} sampled in{" "}
            {watch.pot_activity.window_h}h
          </span>
        )}
      </div>

      {err && <div className="font-mono text-[9px] text-amber-400">WATCH_ERR: {err}</div>}
    </div>
  );
}