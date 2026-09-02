import React, { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const OTC_MINT = "MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump";
const PLUGIN_SRC = "https://plugin.jup.ag/plugin-v1.js";
const TARGET_ID = "jup-swap-otc";

export default function JupiterSwapPanel() {
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const initRef = useRef(false);

  useEffect(() => {
    if (document.getElementById("jup-plugin-script")) {
      if (window.Jupiter && !initRef.current) {
        initRef.current = true;
        window.Jupiter.init({
          displayMode: "integrated",
          integratedTargetId: TARGET_ID,
          formProps: {
            initialInputMint: SOL_MINT,
            initialOutputMint: OTC_MINT,
            fixedMint: OTC_MINT,
          },
        });
        setReady(true);
      }
      return;
    }
    const s = document.createElement("script");
    s.id = "jup-plugin-script";
    s.src = PLUGIN_SRC;
    s.defer = true;
    s.onload = () => {
      if (window.Jupiter && !initRef.current) {
        initRef.current = true;
        window.Jupiter.init({
          displayMode: "integrated",
          integratedTargetId: TARGET_ID,
          formProps: {
            initialInputMint: SOL_MINT,
            initialOutputMint: OTC_MINT,
            fixedMint: OTC_MINT,
          },
        });
        setReady(true);
      }
    };
    document.head.appendChild(s);
  }, []);

  const copyCa = async () => {
    try {
      await navigator.clipboard.writeText(OTC_MINT);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch (e) {
      /* ignore */
    }
  };

  return (
    <div className="border border-green-500/30 bg-black p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-widest text-green-500/70">
          SWAP :: SOL → $OTC
        </span>
        <button
          onClick={copyCa}
          className="inline-flex items-center gap-1 border border-green-500/40 px-2 py-1 font-mono text-[10px] text-green-300 hover:bg-green-500/10"
          title="Copy OTC contract address"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          {copied ? "COPIED" : "COPY CA"}
        </button>
      </div>

      <div className="mt-2 break-all border border-green-500/20 bg-black px-2 py-1.5 font-mono text-[11px] text-emerald-400">
        $OTC :: <span className="text-green-300">{OTC_MINT}</span>
      </div>

      <div className="mt-3">
        <div id={TARGET_ID} className="min-h-[420px]">
          {!ready && (
            <div className="flex h-[420px] items-center justify-center text-[11px] text-green-500/50">
              <span className="animate-pulse">▋</span> LOADING JUPITER_SWAP...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}