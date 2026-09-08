import React, { useState } from "react";
import { Check, Copy } from "lucide-react";
import { HUB_MINT, HUB_MINT_READY } from "@/lib/hubMint";

// Header banner with the official $HUB mint CA. Renders NOTHING until the
// builder sets the real mint (VITE_HUB_MINT secret) and republishes — the
// launch stays completely stealth until then.
export default function HubOfficialCa() {
  const [copied, setCopied] = useState(false);
  if (!HUB_MINT_READY) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(HUB_MINT);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* Clipboard permission may be denied. */
    }
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border border-fuchsia-500/60 bg-fuchsia-500/10 px-2 py-1.5 text-[12px] sm:text-[13px]">
      <span className="font-bold uppercase tracking-widest text-fuchsia-300">
        ★ $HUB :: OFFICIAL OTC_HUB TOKEN :: CA
      </span>
      <span className="min-w-0 break-all font-mono text-fuchsia-200">{HUB_MINT}</span>
      <button
        type="button"
        onClick={copy}
        className="inline-flex shrink-0 items-center gap-1 border border-fuchsia-500/50 px-1.5 py-0.5 font-mono text-[11px] text-fuchsia-300 hover:bg-fuchsia-500/10"
        title="Copy the official $HUB mint"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? "COPIED" : "COPY"}
      </button>
      <span className="text-fuchsia-400/70">verify this CA before trading — impersonators exist</span>
    </div>
  );
}