import React from "react";

// Fixed-order pipeline stepper for multi-phase transaction flows (claim runs, consolidate &
// swap). Complements TxStatusOverlay (which names the CURRENT phase in a bottom banner) by
// showing the WHOLE sequence at once — done / active / pending / failed per step — so the user
// always knows where the run is, what already happened, and what's next. Terminal states
// (all-done / failed-at-step) persist until dismissed or the next run starts.
//
//   <StepTracker title="CLAIM PIPELINE" steps={STEPS} current="send" detail="TX 2/5" />
//   steps: [{ id: "prep", label: "PREP" }, ...] — order is the pipeline order.

function Step({ label, state }) {
  const icon = state === "done" ? "✓" : state === "active" ? "▸" : state === "failed" ? "✗" : "·";
  const cls =
    state === "done"
      ? "border-emerald-500/50 text-emerald-300"
      : state === "active"
        ? "border-cyan-400/60 bg-cyan-500/10 text-cyan-200"
        : state === "failed"
          ? "border-red-500/60 bg-red-500/10 text-red-300"
          : "border-green-500/15 text-green-800";
  return (
    <span
      className={`inline-flex items-center gap-1 border px-1.5 py-0.5 text-[9px] font-bold tracking-widest ${cls}`}
    >
      <span className={state === "active" ? "animate-pulse" : ""}>{icon}</span>
      {label}
    </span>
  );
}

export default function StepTracker({
  title,
  steps,
  current = null,
  done = false,
  failed = null,
  detail = null,
  onDismiss = null,
}) {
  const curIdx = steps.findIndex((s) => s.id === current);
  const terminal = done || !!failed;
  return (
    <div className="border border-green-500/25 bg-black/70 p-2 font-mono">
      <div className="mb-1.5 flex items-center justify-between text-[9px] uppercase tracking-widest">
        <span className="text-green-700">{title}</span>
        <span
          className={
            failed ? "font-bold text-red-400" : done ? "font-bold text-emerald-400" : "text-cyan-400"
          }
        >
          {failed ? "FAILED" : done ? "COMPLETE" : "IN PROGRESS"}
        </span>
        {terminal && onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="ml-2 text-green-700 hover:text-green-400"
            aria-label="dismiss"
          >
            [✕]
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
        {steps.map((s, i) => {
          const state = failed
            ? i < steps.findIndex((x) => x.id === failed)
              ? "done"
              : s.id === failed
                ? "failed"
                : "pending"
            : done
              ? "done"
              : curIdx < 0
                ? "pending"
                : i < curIdx
                  ? "done"
                  : i === curIdx
                    ? "active"
                    : "pending";
          return (
            <React.Fragment key={s.id}>
              {i > 0 && <span className="text-[9px] text-green-800">→</span>}
              <Step label={s.label} state={state} />
            </React.Fragment>
          );
        })}
      </div>
      {detail && !terminal && (
        <div className="mt-1 text-[10px] text-green-500/60">
          <span className="animate-pulse">▋</span> {detail}
        </div>
      )}
    </div>
  );
}
