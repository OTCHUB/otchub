import React, { useState } from "react";

export default function CollapsibleCard({ title, children, defaultOpen = true, id, right }) {
  const storageKey = `otc:col:${title}`;
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(storageKey);
      return v == null ? defaultOpen : v === "1";
    } catch {
      return defaultOpen;
    }
  });
  const toggle = () =>
    setOpen((o) => {
      const n = !o;
      try {
        localStorage.setItem(storageKey, n ? "1" : "0");
      } catch {}
      return n;
    });

  return (
    <div id={id} className="break-inside-avoid">
      <div
        className={`flex items-center justify-between bg-black px-3 py-2 ${
          open ? "border border-green-500/30 border-b-0" : "border border-green-500/30"
        }`}
      >
        <button
          onClick={toggle}
          className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-green-500/70"
        >
          <span className="text-green-500/60">{open ? "[−]" : "[+]"}</span>
          {title}
        </button>
        {right && (
          <div onClick={(e) => e.stopPropagation()} className="shrink-0">
            {right}
          </div>
        )}
      </div>
      {open && <div>{children}</div>}
    </div>
  );
}