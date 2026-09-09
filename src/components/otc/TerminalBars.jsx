import React from "react";

// Fixed terminal frame bars shared by the boot screen AND the main dashboard:
// the same top status bar and bottom disclaimer persist across the boot → app
// transition, so the whole session reads as one continuous terminal.
export function TerminalTopBar({
  label = "OTC_HUB_TERMINAL",
  statusText = "MAINNET_LINK_ACTIVE",
  live = true,
}) {
  return (
    <div className="term-bar fixed inset-x-0 top-0 z-40 flex items-center justify-between gap-2 border-b border-green-500/20 bg-black px-3 py-1.5 font-mono text-[10px] text-green-500/60 sm:text-[11px]">
      <span className="truncate">TTY1 :: {label}</span>
      {live && (
        <span className="flex shrink-0 items-center gap-1.5 text-emerald-400">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          {statusText}
        </span>
      )}
    </div>
  );
}

export function TerminalBottomBar({ children }) {
  return (
    <div className="term-bar fixed inset-x-0 bottom-0 z-40 border-t border-green-500/20 bg-black px-3 py-1.5 text-center font-mono text-[10px] text-green-500/40 sm:text-[11px]">
      {children}
    </div>
  );
}