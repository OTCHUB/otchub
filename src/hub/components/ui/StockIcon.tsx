import { useState } from "react";
import { rewardIconProxyUrl } from "@/lib/rewardIcons";

// Stock token icon for $HUB surfaces. The pot's four buckets are fixed by the
// program, so their 1:1 icons are bundled app assets (public/stocks/, backfilled
// from otcdesks.cash — see base44/shared/rewardStockCatalog.js for the harvest
// notes). Any other symbol resolves through the getRewardIcon proxy, which
// serves the official 1:1 icon server-side; final fallback is the symbol's
// first letter (same chain as the launcher tape's PayoutIcon).

const BUNDLED_ICONS: Record<string, string> = {
  OTC: "/stocks/OTC.png",
  CRCLx: "/stocks/CRCLx.png",
  NVDAx: "/stocks/NVDAx.png",
  SPCXx: "/stocks/SPCXx.png",
  SOL: "/stocks/SOL.png",
};

const STOCK_NAMES: Record<string, string> = {
  OTC: "OTC Desks",
  CRCLx: "Circle",
  NVDAx: "NVIDIA",
  SPCXx: "SpaceX",
  SOL: "Solana",
};

export function StockIcon({
  symbol,
  className = "h-4 w-4",
}: {
  symbol: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(0);
  const candidates = [
    ...new Set([BUNDLED_ICONS[symbol] ?? null, rewardIconProxyUrl(symbol)].filter(Boolean)),
  ];
  const src = candidates[failed] || "";
  return (
    <span
      aria-hidden="true"
      title={STOCK_NAMES[symbol] ?? symbol}
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-green-500/30 bg-green-500/10 text-[8px] font-bold leading-none text-green-400 ${className}`}
    >
      {src ? (
        <img
          src={src}
          alt=""
          width={16}
          height={16}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed((n) => n + 1)}
          className="h-full w-full scale-[1.08] rounded-full object-cover"
        />
      ) : (
        symbol.slice(0, 1)
      )}
    </span>
  );
}

/** The 4-bucket M.I.M payout basket ($OTC · CRCLx · NVDAx · SPCXx) as one icon strip. */
export const MIM_BASKET = ["OTC", "CRCLx", "NVDAx", "SPCXx"] as const;

export function BasketIcons({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      {MIM_BASKET.map((s) => (
        <span
          key={s}
          className="inline-flex items-center gap-1 border border-green-500/20 bg-green-500/5 px-1.5 py-px text-[10px] font-bold uppercase tracking-widest text-green-300"
        >
          <StockIcon symbol={s} className="h-3.5 w-3.5" />
          {s}
        </span>
      ))}
    </span>
  );
}