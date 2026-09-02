import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

const TONES = {
  green: { btn: "text-green-500/40 hover:text-green-400", body: "text-green-500/60" },
  amber: { btn: "text-amber-500/40 hover:text-amber-400", body: "text-amber-500/60" },
};

// Compact one-line help toggle — collapses the long always-on explanation
// paragraphs that bloated the panels down to a single [?] line you can expand.
export default function HelpNote({
  label = "[?] DETAILS",
  tone = "green",
  className = "",
  children,
}) {
  const [open, setOpen] = useState(false);
  const t = TONES[tone] || TONES.green;
  return (
    <div className={`mt-1 font-mono text-[9px] ${className}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex min-h-[24px] items-center gap-1 uppercase tracking-wide ${t.btn}`}
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
        {label}
      </button>
      {open && <p className={`mt-1 leading-snug ${t.body}`}>{children}</p>}
    </div>
  );
}