import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Image } from "@/components/ui/image";
import { fmtSol, fmtUsd } from "@/lib/format";

export default function HoldingsDetail({ h, byStock, onClose }) {
  if (!h) return null;
  const spread = (h.accrued_value_sol || 0) - (h.listing_price_sol || 0);
  const snipe = h.is_listed && h.listing_price_sol != null && spread > 0.0001;

  const totalPerDesk = (byStock || []).reduce((a, s) => a + (s.per_desk_sol || 0), 0) || 1;
  const breakdown = (byStock || [])
    .map((s) => ({
      symbol: s.symbol,
      sol: ((s.per_desk_sol || 0) / totalPerDesk) * (h.accrued_value_sol || 0),
      usd: ((s.per_desk_sol || 0) / totalPerDesk) * (h.accrued_value_usd || 0),
    }))
    .filter((s) => s.sol > 0)
    .sort((a, b) => b.sol - a.sol);
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
              STOCK_HOLDING: <span className="font-bold text-emerald-400">{fmtSol(h.accrued_value_sol, 4)}</span> · {fmtUsd(h.accrued_value_usd, 2)}
            </div>
            <div className="text-green-500/50">MINT_DAY: <span className="text-green-300">{h.mint_day || "—"}</span></div>
            {h.is_listed && h.listing_price_sol != null && (
              <>
                <div className="text-green-500/50">LISTING: <span className="text-amber-400">{fmtSol(h.listing_price_sol, 3)}</span> · {fmtUsd(h.listing_price_usd, 2)}</div>
                <div className="text-green-500/50">
                  EFF_BUY_COST: <span className={snipe ? "text-emerald-400" : "text-amber-400"}>
                    {fmtSol(h.listing_price_sol - h.accrued_value_sol, 4)}
                  </span> · {fmtUsd((h.listing_price_usd || 0) - (h.accrued_value_usd || 0), 2)} <span className="text-green-500/40">(listing − stock)</span>
                </div>
                <div className={snipe ? "text-emerald-400" : "text-amber-400/70"}>
                  NET (STK − LST): {fmtSol(spread, 4)} · {fmtUsd((h.accrued_value_usd || 0) - (h.listing_price_usd || 0), 2)} {snipe ? "[SNIPE]" : ""}
                </div>
              </>
            )}
            <div className="break-all text-green-500/40">ID: {h.asset_id}</div>
            {breakdown.length > 0 && (
              <div className="pt-1">
                <div className="text-[9px] uppercase tracking-widest text-green-500/50">STOCK_HOLDING BY SYMBOL</div>
                <div className="mt-1 max-h-28 space-y-0.5 overflow-auto pr-1">
                  {breakdown.map((b) => (
                    <div key={b.symbol} className="flex justify-between text-[10px]">
                      <span className="text-green-300">{b.symbol}</span>
                      <span className="text-emerald-400/80">{fmtSol(b.sol, 4)} · {fmtUsd(b.usd, 2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
          <a href={`https://magiceden.io/item-details/${h.asset_id}`} target="_blank" rel="noreferrer" className="flex min-h-[44px] flex-1 items-center justify-center border border-emerald-500/50 px-3 font-bold text-emerald-400 hover:bg-emerald-500/10">[BUY_ON_ME ↗]</a>
          <a href={`https://solscan.io/token/${h.asset_id}`} target="_blank" rel="noreferrer" className="flex min-h-[44px] items-center justify-center border border-green-500/30 px-3 text-green-400 hover:bg-green-500/10">[SOLSCAN]</a>
        </div>
      </DialogContent>
    </Dialog>
  );
}