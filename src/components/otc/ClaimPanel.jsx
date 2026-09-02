import React, { useState } from "react";
import { Image } from "@/components/ui/image";
import {
  resolveTokenPrograms,
  scanDesks,
  buildClaimInstructions,
  packTxs,
  executeClaimTxs,
  getConnectedProvider,
} from "@/lib/otcClaim";

export default function ClaimPanel({ address, holdings, onClaimed }) {
  const [selected, setSelected] = useState(() => new Set());
  const [tpMap, setTpMap] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState([]);

  const desks = holdings || [];
  const log = (l) => setLogs((prev) => [...prev, { ...l, t: Date.now() }]);

  const toggle = (id) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const selectAll = () => setSelected(new Set(desks.map((d) => d.asset_id)));
  const clearAll = () => setSelected(new Set());

  const scan = async () => {
    if (!selected.size) return;
    setScanning(true);
    setPlan(null);
    setLogs([]);
    log({ type: "info", msg: `Resolving token programs...` });
    const map = await resolveTokenPrograms();
    setTpMap(map);
    log({ type: "info", msg: `Scanning ${selected.size} desk(s) on-chain...` });
    const chosen = desks.filter((d) => selected.has(d.asset_id));
    const result = await scanDesks(chosen, map);
    setPlan(result);
    const totalClaimable = result.reduce((a, d) => a + d.claimable.length, 0);
    log({
      type: totalClaimable ? "ok" : "err",
      msg: `Scan done: ${totalClaimable} claimable ticker(s) across ${result.length} desk(s).`,
    });
    setScanning(false);
  };

  const runClaim = async (allDesks) => {
    const provider = getConnectedProvider(address);
    if (!provider) {
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
      const results = await executeClaimTxs(txs, provider, log);
      const ok = results.filter((r) => r.ok).length;
      const fail = results.length - ok;
      log({
        type: fail ? "err" : "ok",
        msg: `DONE: ${ok} confirmed, ${fail} failed.`,
      });
      if (ok > 0 && onClaimed) onClaimed();
    } catch (e) {
      log({ type: "err", msg: `CLAIM_ABORT: ${e.message}` });
    } finally {
      setBusy(false);
    }
  };

  const totalClaimable = plan
    ? plan.reduce((a, d) => a + d.claimable.length, 0)
    : 0;

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
              {deskPlan && (
                <span
                  className={`font-mono text-[9px] ${
                    deskPlan.claimable.length
                      ? "text-emerald-400"
                      : "text-green-500/40"
                  }`}
                >
                  {deskPlan.claimable.length
                    ? `${deskPlan.claimable.length} CLAIM`
                    : "—"}
                </span>
              )}
            </label>
          );
        })}
      </div>

      {/* Actions */}
      <div className="mt-2 flex flex-wrap gap-1">
        <button
          onClick={scan}
          disabled={!selected.size || scanning || busy}
          className="border border-emerald-500/50 px-2.5 py-1 text-[10px] text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-30"
        >
          {scanning ? "SCANNING..." : "[SCAN_SELECTED]"}
        </button>
        <button
          onClick={() => runClaim(false)}
          disabled={!plan || busy || !totalClaimable}
          className="border border-emerald-500/50 px-2.5 py-1 text-[10px] text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-30"
        >
          {busy ? "CLAIMING..." : "[CLAIM_SELECTED]"}
        </button>
        <button
          onClick={() => runClaim(true)}
          disabled={!plan || busy || !totalClaimable}
          className="border border-emerald-500/70 px-2.5 py-1 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-30"
        >
          {busy ? "CLAIMING..." : "[CLAIM_ALL_DESKS]"}
        </button>
      </div>
      {plan && (
        <div className="mt-1 text-[9px] text-green-500/60">
          {totalClaimable} claimable ticker(s) found
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