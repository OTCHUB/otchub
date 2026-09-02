import React, { useState } from "react";
import { Image } from "@/components/ui/image";
import { fmtSol } from "@/lib/format";

export default function HoldingsGallery({ holdings }) {
  const [onlyListed, setOnlyListed] = useState(false);
  const list = (holdings || [])
    .filter((h) => !onlyListed || h.is_listed)
    .slice(0, 60);

  return (
    <div className="border border-green-500/30 bg-black p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-green-500/70">
          NFT_HOLDINGS :: {holdings?.length || 0}
        </span>
        <button
          onClick={() => setOnlyListed((v) => !v)}
          className={`border px-2 py-0.5 font-mono text-[10px] ${
            onlyListed
              ? "border-emerald-500/50 text-emerald-400"
              : "border-green-500/30 text-green-500/60"
          }`}
        >
          {onlyListed ? "[LISTED]" : "[ALL]"}
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
        {list.map((h) => (
          <div
            key={h.asset_id}
            className="border border-green-500/20 bg-black"
          >
            <div className="relative aspect-square">
              {h.image_url ? (
                <Image src={h.image_url} fittingType="fill" className="h-full w-full" />
              ) : (
                <div className="flex h-full items-center justify-center font-mono text-[10px] text-green-500/30">
                  NO_IMG
                </div>
              )}
              {h.is_listed && (
                <span className="absolute right-1 top-1 bg-black/80 px-1 font-mono text-[9px] text-emerald-400">
                  LST
                </span>
              )}
            </div>
            <div className="border-t border-green-500/20 p-1.5">
              <div className="truncate font-mono text-[10px] text-green-300">{h.name}</div>
              <div className="font-mono text-[9px] text-green-500/50">{fmtSol(h.accrued_value_sol, 3)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}