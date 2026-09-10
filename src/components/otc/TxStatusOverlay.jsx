import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Fixed bottom banner shown while a transaction flow (claim / swap / crank) is
// running. It names the current phase, explains what is happening, and shows a
// live spinner + elapsed-seconds counter so the app never looks frozen during
// long broadcast/confirmation waits.
// PORTED to <body>: the frosted .term-window panels use backdrop-filter and a
// reveal transform, which make them the containing block for fixed-position
// descendants — rendered inline, this banner anchored to the CARD (clipped by
// its overflow, floating over the tx log) instead of the viewport.
const PHASES = {
  prep: {
    label: "PREPARING",
    hint: "Building transactions — please wait…",
    cls: "border-cyan-400/60 text-cyan-300",
    dot: "bg-cyan-400",
  },
  resolve: {
    label: "RESOLVING",
    hint: "Probing claimable tickers on-chain — no wallet prompt yet…",
    cls: "border-cyan-400/60 text-cyan-300",
    dot: "bg-cyan-400",
  },
  sim: {
    label: "SIMULATING",
    hint: "Verifying every tx before signing — no fee spent. Please wait…",
    cls: "border-cyan-400/60 text-cyan-300",
    dot: "bg-cyan-400",
  },
  sign: {
    label: "AWAITING SIGNATURE",
    hint: "CHECK YOUR WALLET — approve the prompt to continue. No prompt appeared or stuck? [CANCEL] ends the run — nothing is sent.",
    cls: "border-amber-400/60 text-amber-300",
    dot: "bg-amber-400",
  },
  send: {
    label: "BROADCASTING",
    hint: "Sending signed txs to Solana — keep this page open…",
    cls: "border-emerald-400/60 text-emerald-300",
    dot: "bg-emerald-400",
  },
  confirm: {
    label: "CONFIRMING",
    hint: "Waiting for on-chain confirmation — can take up to ~30s. The app is NOT frozen, please wait…",
    cls: "border-emerald-400/60 text-emerald-300",
    dot: "bg-emerald-400",
  },
  quote: {
    label: "FETCHING QUOTE",
    hint: "Getting the best route from Jupiter…",
    cls: "border-cyan-400/60 text-cyan-300",
    dot: "bg-cyan-400",
  },
  build: {
    label: "BUILDING TX",
    hint: "Jupiter is building your swap transaction…",
    cls: "border-cyan-400/60 text-cyan-300",
    dot: "bg-cyan-400",
  },
};

export default function TxStatusOverlay({ phase, detail = null, onCancel = null }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setElapsed(0);
    if (!phase) return undefined;
    const start = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  if (!phase) return null;
  const p = PHASES[phase] || PHASES.prep;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-[60px] z-[60] flex justify-center px-3">
      <div className={`w-full max-w-lg border bg-black/95 px-3 py-2 ${p.cls} ${onCancel ? "pointer-events-auto" : ""}`}>
        <div className="flex items-center gap-2.5">
          <span
            className={`h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-t-transparent ${p.dot}`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-x-2">
              <span className="font-mono text-[13px] font-bold tracking-widest">
                {p.label}
                {detail ? <span className="text-green-500/60"> :: {detail}</span> : null}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {onCancel && (
                  <button
                    onClick={onCancel}
                    className="border border-red-500/50 px-2 py-0.5 font-mono text-[11px] text-red-400 hover:border-red-400 hover:text-red-300"
                  >
                    [CANCEL]
                  </button>
                )}
                <span className="font-mono text-[12px] text-green-500/50">
                  [{elapsed}s] <span className="animate-pulse">▋</span>
                </span>
              </span>
            </div>
            <div className="mt-0.5 font-mono text-[11px] leading-snug text-green-500/60">
              {p.hint}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}