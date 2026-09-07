import React, { useState } from "react";

// Terminal-styled copy-to-clipboard block: a labeled, read-only value with a
// [COPY] button. Handles the legacy execCommand fallback for browsers that
// don't expose navigator.clipboard.
export default function CopyBlock({ label, value, note }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="border border-green-500/30 bg-black">
      <div className="flex items-center justify-between border-b border-green-500/20 px-2 py-1">
        <span className="text-[11px] uppercase tracking-widest text-green-500/50">{label}</span>
        <button
          onClick={copy}
          className={`border px-2 py-0.5 text-[12px] ${
            copied
              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
              : "border-green-500/50 text-green-400 hover:bg-green-500/10"
          }`}
        >
          {copied ? "COPIED ✓" : "[COPY]"}
        </button>
      </div>
      <pre className="whitespace-pre-wrap break-all px-2 py-2 text-[12px] leading-relaxed text-green-300">
        {value}
      </pre>
      {note && <div className="border-t border-green-500/10 px-2 py-1 text-[11px] text-green-500/40">{note}</div>}
    </div>
  );
}