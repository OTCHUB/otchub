import React, { useState } from "react";
import { Image } from "@/components/ui/image";
import { fmtSol } from "@/lib/format";

export default function HoldingsGallery({ holdings }) {
  const [onlyListed, setOnlyListed] = useState(false);
  const list = (holdings || [])
    .filter((h) => !onlyListed || h.is_listed)
    .slice(0, 60);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">
          NFT Holdings ({holdings?.length || 0})
        </h3>
        <button
          onClick={() => setOnlyListed((v) => !v)}
          className={`rounded-full border px-3 py-1 text-xs ${
            onlyListed
              ? "border-emerald-500/40 text-emerald-400"
              : "border-slate-700 text-slate-400"
          }`}
        >
          {onlyListed ? "Listed only" : "All"}
        </button>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
        {list.map((h) => (
          <div
            key={h.asset_id}
            className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950/50"
          >
            <div className="relative aspect-square">
              {h.image_url ? (
                <Image src={h.image_url} fittingType="fill" className="h-full w-full" />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-slate-600">
                  No img
                </div>
              )}
              {h.is_listed && (
                <span className="absolute right-1 top-1 rounded bg-emerald-500/80 px-1 text-[10px] text-white">
                  Listed
                </span>
              )}
            </div>
            <div className="p-2">
              <div className="truncate text-[11px] text-slate-300">{h.name}</div>
              <div className="text-[10px] text-slate-500">{fmtSol(h.accrued_value_sol, 3)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}