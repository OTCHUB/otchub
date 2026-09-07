import React, { useCallback, useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { fmtSol, timeAgo } from "@/lib/format";
import HelpNote from "@/components/otc/HelpNote";

const statusCls = (s) =>
  s === "ok"
    ? "text-emerald-400"
    : s === "low_balance" || s === "error" || s === "all_sims_failed"
    ? "text-red-400"
    : "text-green-500/50";

// Keeper control room: shows whether the automated distribute crank is armed,
// the keeper wallet's fee float, and a log of recent runs. Pause/resume is
// admin-only server-side — non-admins get an inline error on toggle.
export default function KeeperPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await base44.functions.invoke("otcKeeper", { mode: "status" });
      setData(res.data);
      setError(null);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || "Failed to load keeper status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async () => {
    setBusy(true);
    try {
      await base44.functions.invoke("otcKeeper", {
        mode: "toggle",
        enabled: !(data?.enabled ?? true),
      });
      await load();
    } catch (e) {
      setError(e?.response?.data?.error || e.message || "Toggle failed (admin only)");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="border border-green-500/30 bg-black p-3 text-[12px] text-green-500/50">
        KEEPER :: LOADING…
      </div>
    );
  }

  const runs = data?.runs || [];
  const enabled = data?.enabled ?? true;
  const lowBalance =
    data?.keeper_balance_sol != null &&
    data.keeper_balance_sol < (data?.minBalanceSol ?? 0.05);

  return (
    <div className="border border-green-500/30 bg-black p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span
          className={`border px-2 py-0.5 font-mono text-[12px] ${
            enabled
              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
              : "border-red-500/50 bg-red-500/10 text-red-400"
          }`}
        >
          {enabled ? "● ARMED" : "■ PAUSED"}
        </span>
        {lowBalance && (
          <span className="font-mono text-[12px] text-red-400">
            LOW_FUNDS — TOP UP THE KEEPER WALLET
          </span>
        )}
        <button
          onClick={toggle}
          disabled={busy}
          className={`border px-2 py-1 font-mono text-[12px] disabled:opacity-40 ${
            enabled
              ? "border-red-500/50 text-red-400 hover:bg-red-500/10"
              : "border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10"
          }`}
          title="Pause or resume the automated distribute keeper (admin only)"
        >
          {busy ? "…" : enabled ? "[PAUSE]" : "[RESUME]"}
        </button>
      </div>

      <div className="mt-1 text-[11px] text-green-500/40">
        CADENCE 30m · DEPTH {data?.depth ?? "—"} round(s)/slot · ≤{data?.maxTxs ?? "—"} TX/RUN ·
        MIN_FLOAT {fmtSol(data?.minBalanceSol ?? 0, 2)} · pushes owed pot earnings into desk vaults
      </div>

      {data?.totals && (
        <div className="mt-2 border border-green-500/20 bg-black">
          <div className="border-b border-green-500/20 px-2 py-1 text-[11px] uppercase tracking-widest text-green-500/50">
            CRKR_IMPACT :: HOW MUCH THE KEEPER HELPED THE PROTOCOL (LIFETIME)
          </div>
          <div className="grid grid-cols-2 gap-1 p-1 sm:grid-cols-3 lg:grid-cols-6">
            <div className="border border-green-500/20 px-2 py-1">
              <div className="text-[10px] uppercase tracking-widest text-green-500/50">RUNS</div>
              <div className="text-[13px] font-bold text-green-300">
                {data.totals.runs}
                <span className="ml-1 text-[10px] font-normal text-green-500/50">
                  OK {data.totals.ok_runs}
                </span>
              </div>
            </div>
            <div className="border border-green-500/20 px-2 py-1">
              <div className="text-[10px] uppercase tracking-widest text-green-500/50">DESKS_SERVED</div>
              <div className="text-[13px] font-bold text-green-300">{data.totals.desks}</div>
            </div>
            <div className="border border-green-500/20 px-2 py-1">
              <div className="text-[10px] uppercase tracking-widest text-green-500/50">TXS_LANDED</div>
              <div className="text-[13px] font-bold text-green-300">
                <span className="text-emerald-400">{data.totals.txs_sent}</span>
                <span className="text-[10px] font-normal text-red-400">/{data.totals.txs_failed}</span>
              </div>
            </div>
            <div className="border border-green-500/20 px-2 py-1">
              <div className="text-[10px] uppercase tracking-widest text-green-500/50">FEES_SPENT</div>
              <div className="text-[13px] font-bold text-cyan-400">{fmtSol(data.totals.fees_sol, 4)}</div>
            </div>
            <div className="border border-emerald-500/40 bg-emerald-500/5 px-2 py-1">
              <div className="text-[10px] uppercase tracking-widest text-emerald-500/70">OWED_CLEARED</div>
              <div className="text-[13px] font-bold text-emerald-400">
                {fmtSol(data.totals.cleared_sol, 3)}
                {data?.sol_price_usd != null && data.totals.cleared_sol > 0 && (
                  <span className="ml-1 text-[10px] font-normal text-green-500/50">
                    ≈ {fmtSol(data.totals.cleared_sol * data.sol_price_usd, 0)}$
                  </span>
                )}
              </div>
            </div>
            <div className="border border-green-500/20 px-2 py-1">
              <div className="text-[10px] uppercase tracking-widest text-green-500/50">HELPING_SINCE</div>
              <div className="text-[13px] font-bold text-green-300">
                {data.totals.since ? timeAgo(data.totals.since) : "—"}
              </div>
            </div>
          </div>
          <div className="border-t border-green-500/10 px-2 py-1 text-[11px] text-green-500/40">
            OWED_CLEARED = SOL value of stock tokens CRKR pushed from the protocol pool into desk
            vaults, measured on-chain from pool deltas and valued at live spot prices (unpriced
            stocks excluded — conservative).
          </div>
        </div>
      )}

      <HelpNote label="[?] KEEPER_LEGEND" className="mt-1">
        A dedicated fee-only wallet signs permissionless distribute(index) txs on a schedule so
        owed desk earnings never sit stuck in the pot. It holds no user funds — only its own fee
        float. Every run is simulated first (failing txs cost nothing), fees are capped per run,
        and a rotating desk cursor gives the whole collection coverage over time. The sim also
        probes what the distributes would actually move — runs that would deliver nothing are
        skipped for free (NOTHING_DUE). Vault ticker accounts not yet open fail sim and are
        skipped harmlessly.
      </HelpNote>

      {error && (
        <div className="mt-2 border border-amber-500/40 bg-amber-500/5 px-2 py-1 text-[12px] text-amber-400 break-all">
          ERR: {error}
        </div>
      )}

      <div className="mt-3 border border-green-500/20">
        <div className="border-b border-green-500/20 px-2 py-1 text-[11px] uppercase tracking-widest text-green-500/50">
          RUN_LOG :: LAST {runs.length}
        </div>
        {runs.length ? (
          runs.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b border-green-500/10 px-2 py-1 text-[12px] last:border-0"
            >
              <span className="text-green-500/50">{timeAgo(r.created_date)}</span>
              <span className={`font-mono ${statusCls(r.status)}`}>{r.status}</span>
              <span className="font-mono text-green-500/70">
                DESKS <span className="text-green-300">{r.desks ?? 0}</span> · TX{" "}
                <span className="text-emerald-400">{r.txs_sent ?? 0}</span>/
                <span className="text-red-400">{r.txs_failed ?? 0}</span> · FEES{" "}
                <span className="text-cyan-400">{fmtSol(r.fees_sol ?? 0, 4)}</span>
              </span>
              <span className="font-mono text-green-500/50">
                BACKLOG {r.backlog_sol_before != null ? fmtSol(r.backlog_sol_before, 2) : "—"}
                {r.cleared_sol != null && r.cleared_sol > 0 && (
                  <span
                    className="text-emerald-400"
                    title={
                      r.cleared_by_stock
                        ? Object.entries(r.cleared_by_stock)
                            .map(([sym, sol]) => `${sym} ${fmtSol(sol, 4)}`)
                            .join(" · ")
                        : ""
                    }
                  >
                    {" · CLR "}
                    {fmtSol(r.cleared_sol, 3)}
                  </span>
                )}
              </span>
            </div>
          ))
        ) : (
          <div className="px-2 py-2 text-center text-[12px] text-green-500/50">
            NO_RUNS_YET — the first keeper run fires on the next 30-minute tick
          </div>
        )}
      </div>
    </div>
  );
}