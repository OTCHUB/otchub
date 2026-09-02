import React, { useState, useEffect } from "react";

// All panels open by default; click anywhere on the header bar to toggle.
// `openSignal` lets other panels force this card open: bump the counter and
// the card re-expands (used by the swap panel's "connect wallet" shortcut).
export default function CollapsibleCard({ title, children, defaultOpen = true, id, right, openSignal }) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = () => setOpen((o) => !o);

  useEffect(() => {
    if (openSignal) setOpen(true);
  }, [openSignal]);

  return (
    <div id={id} className="flex h-full flex-col break-inside-avoid">
      <div
        onClick={toggle}
        className={`flex cursor-pointer select-none items-center justify-between bg-black px-3 py-2 ${
          open ? "border border-green-500/30 border-b-0" : "border border-green-500/30"
        }`}
      >
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-green-500/70">
          <span className="text-green-500/60">{open ? "[−]" : "[+]"}</span>
          {title}
        </div>
        {right && (
          <div onClick={(e) => e.stopPropagation()} className="shrink-0">
            {right}
          </div>
        )}
      </div>
      {open && <div className="flex-1">{children}</div>}
    </div>
  );
}