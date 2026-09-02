import React, { useState } from "react";
import { Image } from "@/components/ui/image";
import { fmtSol, fmtUsd } from "@/lib/format";
import HoldingsDetail from "@/components/otc/HoldingsDetail";

export default function HoldingsGallery({ holdings }) {
  const [mode, setMode] = useState("ALL");
  const [sel, setSel] = useState(null);
  const all = holdings || [];
  const listed = all.filter((h) => h.is_listed && h.listing_price_sol != null);
  const snipes = listed
    .map((h) => ({ ...h, spread_sol: (h.accrued_value_sol || 0) - (h.listing_price_sol || 0) }))
    .sort((a, b) => b.spread_sol - a.spread_sol);
  const list = (mode === "SNIPE" ? snipes : mode === "LISTED" ? listed : all).slice(0, 60);

  return (
    <div className="border border-green-500/30 bg-black p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-green-500/70">
          NFT_HOLDINGS :: {all.length} · LISTED {listed.length}
        </span>
        <div className="flex gap-1">
          {["ALL", "LISTED", "SNIPE"].map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`border px-2 py-0.5 font-mono text-[10px] ${mode === m ? "border-emerald-500/50 text-emerald-400" : "border-green-500/30 text-green-500/60"}`}>[{m}]</button>
          ))}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
        {list.map((h) => {
          const spread = (h.accrued_value_sol || 0) - (h.listing_price_sol || 0);
          const snipe = h.is_listed && h.listing_price_sol != null && spread > 0.0001;
          return (
            <button key={h.asset_id} onClick={() => setSel(h)} className="border border-green-500/20 bg-black text-left hover:border-green-500/50">
              <div className="relative aspect-square">
                {h.image_url ? <Image src={h.image_url} fittingType="fill" className="h-full w-full" /> : <div className="flex h-full items-center justify-center font-mono text-[10px] text-green-500/30">NO_IMG</div>}
                {h.is_listed && h.listing_price_sol != null && <span className="absolute right-1 top-1 bg-black/80 px-1 font-mono text-[9px] text-emerald-400">LST {fmtSol(h.listing_price_sol, 2)}</span>}
                {snipe && <span className="absolute left-1 top-1 bg-emerald-500/90 px-1 font-mono text-[9px] font-bold text-black">SNIPE</span>}
              </div>
              <div className="border-t border-green-500/20 p-1.5">
                <div className="truncate font-mono text-[10px] text-green-300">{h.name}</div>
                <div className="font-mono text-[9px] text-green-500/60">PDA {fmtSol(h.accrued_value_sol, 3)} · {fmtUsd(h.accrued_value_usd, 2)}</div>
                {h.is_listed && h.listing_price_sol != null && <div className={`font-mono text-[9px] ${snipe ? "text-emerald-400" : "text-amber-400/70"}`}>Δ {fmtSol(spread, 3)}</div>}
              </div>
            </button>
          );
        })}
        {!list.length && <div className="col-span-full py-6 text-center font-mono text-[11px] text-green-500/40">NO_DATA</div>}
      </div>
      <HoldingsDetail h={sel} onClose={() => setSel(null)} />
    </div>
  );
}