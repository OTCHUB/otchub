import React, { useState } from "react";
import { rewardIconProxyUrl } from "@/lib/rewardIcons";

// Coin-shaped token icon for the main OTC_HUB terminal — the same crop/ring
// treatment as the $HUB terminal's StockIcon: the image is cropped full-bleed
// inside a circle with a thin green ring (rounded-full + object-cover).
// Resolution chain: bundled 1:1 asset (public/stocks, backfilled from the
// official site) → getRewardIcon proxy by symbol → proxy by mint → the
// symbol's first letter. SOL has a bundled official wrapped-SOL logo, so the
// "S" coin never touches the network.
const BUNDLED_ICONS = {
  OTC: "/stocks/OTC.png",
  SOL: "/stocks/SOL.png",
  WSOL: "/stocks/SOL.png",
  HUB: "/hub-mint.png",
};

export default function TokenCoin({ symbol, mint = null, className = "h-4 w-4" }) {
  const [failed, setFailed] = useState(0);
  const label = String(symbol || (mint ? mint.slice(0, 1) : "?"));
  const candidates =
    label === "SOL"
      ? [BUNDLED_ICONS.SOL]
      : [
          BUNDLED_ICONS[symbol] ?? null,
          symbol ? rewardIconProxyUrl(symbol) : null,
          mint ? rewardIconProxyUrl(mint) : null,
        ].filter(Boolean);
  const src = [...new Set(candidates)][failed] || "";
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-green-500/30 bg-green-500/10 text-[9px] font-bold leading-none text-green-400 ${className}`}
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
        label.slice(0, 1)
      )}
    </span>
  );
}