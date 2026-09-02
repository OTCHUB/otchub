import React, { useMemo, useState } from "react";
import {
  buildDistributeInstructions,
  resolveTokenPrograms,
} from "@/lib/otcClaim";
import { executeCrank } from "@/lib/otcCrank";
import { getSignerForAddress } from "@/lib/walletSigner";
import { fmtSol, fmtNum } from "@/lib/format";
import HelpNote from "@/components/otc/HelpNote";

const SLOTS = 13; // lineup slots (distribute(index) u8 arg)
const TXS_PER_WAVE = 100; // signed txs per wallet approval (1 prompt per wave)
const MAX_DEPTH = 10;

// Nuclear-style launcher for the protocol's PERMISSIONLESS `distribute(index)`
// crank. Anyone can call it for ANY desk — it moves one owed round from the
// protocol pool into a desk's vault per call. Desks behind R rounds need R
// distributes per slot. The owed backlog shows here so you can see what a
// launch would clear. Every tx is simulated first; failing sims are dropped
// (no fee), no-op distributes deliver 0 and are harmless, and rejecting any
// wallet prompt aborts the run (already-sent groups stay landed).
export default function DistributeCrank({ wallet, allDesks, latest }) {
  const [armed, setArmed] = useState(false);
  const [depth, setDepth] = useState(1);
  // Atomic 5-tx Jito bundles via Helius — requires a Helius API key on a plan
  // with bundle access; on other plans submits fail fast and fall back to
  // normal sends, so it stays OFF by default until that's confirmed.
  const [useBundles, setUseBundles] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState(null);

  const log = (l) => setLogs((prev) => [...prev, { ...l, t: Date.now() }]);

  const desks = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const h of allDesks || []) {
      if (h?.asset_id && !seen.has(h.asset_id)) {
        seen.add(h.asset_id);
        out.push(h);
      }
    }
    return out;
  }, [allDesks]);

  const ixCount = desks.length * SLOTS * depth;
  const estTxs = Math.ceil(ixCount / 6); // slot-major packing fits ~6-8/tx
  const estWaves = Math.max(1, Math.ceil(estTxs / TXS_PER_WAVE)); // ~1 approval per wave
  const feeLo = (estTxs * 0.0000058 + estTxs * 0.000005).toFixed(3); // base+floor fee + jito tip
  const feeHi = (estTxs * 0.000045 + estTxs * 0.000005).toFixed(2); // busy-network fee + jito tip
  const owed = latest?.protocol_owed_sol;

  const launch = async () => {
    if (!wallet) {
      log({ type: "err", msg: "No wallet connected — connect a wallet above to crank." });
      return;
    }
    const signer = getSignerForAddress(wallet);
    if (!signer) {
      log({ type: "err", msg: "Connected wallet cannot sign this address." });
      return;
    }
    if (!desks.length) {
      log({ type: "err", msg: "No desk data loaded — refresh the dashboard." });
      return;
    }
    setBusy(true);
    try {
      log({ type: "info", msg: "CRANK_INIT :: resolving token programs..." });
      const tpMap = await resolveTokenPrograms();
      log({
        type: "info",
        msg: `TARGETS :: ${desks.length} desks × ${SLOTS} slots × ${depth} round(s) = ${ixCount} distribute(index) ixs.`,
      });
      const deskPlans = desks.map((d) => ({ asset_id: d.asset_id }));
      const base = await buildDistributeInstructions(deskPlans, wallet, tpMap, true);
      const ixs = [];
      for (let r = 0; r < depth; r++) ixs.push(...base);
      log({ type: "info", msg: "IGNITION :: 3... 2... 1... ☢ LAUNCH" });
      const results = await executeCrank(
        ixs,
        wallet,
        signer.signAllTransactionsRaw,
        log,
        setProgress,
        { useBundles }
      );
      const ok = results.filter((r) => r.ok).length;
      const fail = results.length - ok;
      log({
        type: fail ? "err" : "ok",
        msg: `CRANK_DONE :: ${ok} confirmed, ${fail} skipped/failed (of ${results.length} tx). Owed backlog will re-read on the next snapshot.`,
      });
      setArmed(false);
    } catch (e) {
      log({ type: "err", msg: `CRANK_ABORT: ${e.message}` });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const phaseLabel = busy
    ? progress
      ? progress.phase === "start"
        ? `INIT · ${progress.totalGroups} GROUP(S)`
        : `G${progress.group}/${progress.totalGroups} ${progress.phase.toUpperCase()} · ${progress.signaturesLeft ?? ""}SIG`
      : "PROCESSING…"
    : "PROCESSING…";

  return (
    <div className="border border-amber-500/30 bg-black p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-widest text-amber-400/80">
          ☢ DISTRIBUTE(index) :: PERMISSIONLESS_CRANK
        </span>
        {owed != null && (
          <span className="border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[9px] text-amber-300">
            OWED_BACKLOG :: {fmtSol(owed, 3)} UN-CRANKED
          </span>
        )}
      </div>

      <HelpNote tone="amber" label="[?] CRANK DETAILS" className="mt-2">
        The protocol NEVER auto-distributes — distribute(index) is a permissionless crank anyone
        can call for ANY desk. Each call advances a desk ONE round per slot; a desk behind R rounds
        needs R calls. Launching here cranks every desk so the owed backlog flows into vaults.
        Slots whose vault ticker account isn't open yet fail sim and are dropped (no fee); no-op
        cranks deliver 0 safely. With JITO_BUNDLE ON, signed txs go out 5-at-a-time as ATOMIC
        bundles that land in order in one slot (each carries a 5,000-lamport Jito tip ≈ $0.001;
        unlanded bundles fall back to normal broadcast).
      </HelpNote>

      {!desks.length ? (
        <div className="mt-3 border border-amber-500/30 bg-amber-500/5 px-2 py-2 text-center text-[11px] text-amber-400/80">
          NO_DESK_DATA :: loading collection desks...
        </div>
      ) : !wallet ? (
        <div className="mt-3 border border-amber-500/30 bg-amber-500/5 px-2 py-2 text-center text-[11px] text-amber-400/80">
          CONNECT WALLET ABOVE TO ARM THE CRANK
        </div>
      ) : (
        <>
          {/* Controls */}
          <div className="mt-2 flex flex-wrap items-center gap-2 border border-amber-500/20 p-2">
            <div className="flex items-center gap-1">
              <span className="text-[9px] uppercase tracking-widest text-amber-500/60">
                ROUNDS_DEPTH
              </span>
              <input
                type="number"
                min="1"
                max={MAX_DEPTH}
                value={depth}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(MAX_DEPTH, parseInt(e.target.value || "1", 10) || 1));
                  setDepth(v);
                }}
                disabled={busy}
                className="w-14 border border-amber-500/40 bg-black px-1.5 py-0.5 text-center text-[11px] text-amber-300 outline-none focus:border-amber-400 disabled:opacity-40"
                title="How many rounds to crank per desk-slot per launch. 1 = advance every desk one round."
              />
            </div>
            <button
              onClick={() => setUseBundles((v) => !v)}
              disabled={busy}
              title="ON: signed txs are submitted as atomic 5-tx Jito bundles via Helius — all-or-nothing, executed in order in a single slot (needs a Helius plan with bundle access). Each tx carries a 5,000-lamport tip and each bundle costs 1 integration credit. OFF: normal broadcast."
              className={`border px-2 py-1 text-[9px] disabled:opacity-40 ${
                useBundles
                  ? "border-cyan-400/60 text-cyan-300"
                  : "border-amber-500/30 text-amber-500/50 hover:border-amber-400/50"
              }`}
            >
              [JITO_BUNDLE:{useBundles ? "ON" : "OFF"}]
            </button>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-amber-500/60">
              <span>{fmtNum(desks.length)} DESKS</span>
              <span>{fmtNum(ixCount)} IX</span>
              <span>≈{fmtNum(estTxs)} TX</span>
              <span className="text-amber-400">≈{estWaves} APPROVAL(S)</span>
              <span className="text-cyan-400">FEES ≈ {feeLo}–{feeHi} SOL</span>
            </div>
          </div>

          {/* Arm + Launch */}
          <div className="mt-3 grid gap-2 sm:grid-cols-[auto_1fr]">
            <button
              onClick={() => setArmed((v) => !v)}
              disabled={busy}
              className={`border px-4 py-3 text-[11px] font-bold tracking-widest disabled:opacity-40 ${
                armed
                  ? "border-red-500 bg-red-500/15 text-red-300 animate-pulse"
                  : "border-amber-500/40 text-amber-400 hover:border-amber-400/70"
              }`}
            >
              {armed ? "[DISARM]" : "[ARM]"}
            </button>
            <button
              onClick={launch}
              disabled={!armed || busy}
              className={`border px-4 py-3 text-[12px] font-bold tracking-widest transition-all ${
                busy
                  ? "border-red-500/60 bg-red-500/10 text-red-300"
                  : armed
                  ? "border-red-500 bg-red-500/10 text-red-400 animate-pulse hover:bg-red-500/20"
                  : "border-red-500/20 text-red-500/30"
              }`}
            >
              {busy ? `☢ CRANKING :: ${phaseLabel}` : "▓▓▓ [ ☢ LAUNCH_DISTRIBUTE ] ▓▓▓"}
            </button>
          </div>
          <p className="mt-1 text-[9px] text-amber-500/40">
            {armed
              ? "ARMED — launch will request ~" + estWaves + " batched signature(s). REJECT any prompt to abort."
              : "Arm, then launch. Sim-first, permissionless, abortable at any prompt."}
          </p>

          {/* Live progress */}
          {busy && progress && (
            <div className="mt-2 border border-red-500/40 bg-red-500/5 p-2">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-red-300">
                  {progress.phase === "start"
                    ? `INIT · ${progress.totalGroups} GROUP(S)`
                    : `GROUP ${progress.group}/${progress.totalGroups} · ${progress.phase.toUpperCase()}`}
                </span>
                <span className="text-amber-300">{progress.signaturesLeft ?? 0} SIG LEFT</span>
              </div>
              <div className="mt-1 h-1.5 w-full bg-red-500/10">
                <div
                  className="h-full bg-red-400 transition-all duration-300"
                  style={{
                    width: `${
                      progress.totalGroups
                        ? Math.min(100, (progress.group / progress.totalGroups) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Log */}
          {logs.length > 0 && (
            <div className="mt-2 max-h-48 overflow-y-auto border border-amber-500/20 bg-black p-2">
              {logs.map((l, i) => (
                <div
                  key={i}
                  className={`text-[9px] leading-snug ${
                    l.type === "ok"
                      ? "text-emerald-400"
                      : l.type === "err"
                      ? "text-red-400"
                      : "text-amber-500/70"
                  }`}
                >
                  {l.msg}
                  {l.sig && (
                    <a
                      href={`https://solscan.io/tx/${l.sig}`}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-1 underline hover:text-amber-300"
                    >
                      [SCAN]
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}