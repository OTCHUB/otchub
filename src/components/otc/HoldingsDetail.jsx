import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Image } from "@/components/ui/image";
import { fmtSol, fmtUsd } from "@/lib/format";

export default function HoldingsDetail({ h, onClose }) {
  if (!h) return null;
  const spread = (h.accrued_value_sol || 0) - (h.listing_price_sol || 0);
  const snipe = h.is_listed && h.listing_price_sol != null && spread > 0.0001;
  return (
    <Dialog open={!!h} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md border border-green-500/40 bg-black font-mono text-green-400">
        <DialogHeader>
          <DialogTitle className="font-mono text-green-400">{h.name}</DialogTitle>
        </DialogHeader>
        <div className="flex gap-3">
          <div className="h-24 w-24 shrink-0 border border-green-500/30">
            {h.image_url ? (
              <Image src={h.image_url} fittingType="fill" className="h-full w-full" />
            ) : (
              <div className="flex h-full items-center justify-center text-[10px] text-green-500/30">NO_IMG</div>
            )}
          </div>
          <div className="flex-1 space-y-1 text-[11px]">
            <div className="text-green-500/50">
              PDA_ACCRUED: <span className="font-bold text-emerald-400">{fmtSol(h.accrued_value_sol, 4)}</span> · {fmtUsd(h.accrued_value_usd, 2)}
            </div>
            <div className="text-green-500/50">MINT_DAY: <span className="text-green-300">{h.mint_day || "—"}</span></div>
            {h.is_listed && h.listing_price_sol != null && (
              <>
                <div className="text-green-500/50">LISTING: <span className="text-amber-400">{fmtSol(h.listing_price_sol, 3)}</span> · {fmtUsd(h.listing_price_usd, 2)}</div>
                <div className={snipe ? "text-emerald-400" : "text-amber-400/70"}>SPREAD: {fmtSol(spread, 4)} {snipe ? "[SNIPE]" : ""}</div>
              </>
            )}
            <div className="break-all text-green-500/40">ID: {h.asset_id}</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
          {h.is_listed && (
            <a href={`https://magiceden.io/itemdetails/${h.asset_id}`} target="_blank" rel="noreferrer" className="border border-green-500/50 px-2 py-1 text-green-400 hover:bg-green-500/10">[MAGIC_EDEN]</a>
          )}
          <a href={`https://solscan.io/token/${h.asset_id}`} target="_blank" rel="noreferrer" className="border border-green-500/30 px-2 py-1 text-green-400 hover:bg-green-500/10">[SOLSCAN]</a>
        </div>
      </DialogContent>
    </Dialog>
  );
}