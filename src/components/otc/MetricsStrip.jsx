import React from "react";
import { fmtSol, fmtUsd, fmtNum, fmtPct, fmtCompact } from "@/lib/format";

const COLOR = {
  green: "text-green-400",
  amber: "text-amber-400",
  red: "text-red-400",
  cyan: "text-cyan-400",
};

// All 8 headline metrics as ONE dense ticker strip (gap-px divider trick):
// a single row on desktop instead of two rows of cards, and a tight 2-column
// grid on mobile — same data, a fraction of the vertical space.
// The old per-card description line lives on as a hover tooltip (title).
export default function MetricsStrip({ latest }) {
  const cells = [
    {
      label: "SOL_PRICE",
      value: fmtUsd(latest?.sol_price_usd),
      sub: "SPOT_USD",
      desc: "Wrapped SOL spot price",
      accent: "cyan",
    },
    {
      label: "OTC_TOKEN",
      value: fmtUsd(latest?.token_price_usd, 5),
      sub: `24H ${fmtPct(latest?.token_price_change_24h)}`,
      desc: "OTC token spot market price",
      accent: "green",
    },
    {
      label: "NFT_FLOOR",
      value: fmtSol(latest?.secondary_cost_sol),
      sub: fmtUsd(latest?.secondary_cost_usd),
      desc: "ME floor incl. 2% + 5% fees",
      accent: "amber",
    },
    {
      label: "DESKS_MINTED",
      value: fmtNum(latest?.desks_minted),
      sub: `SUPPLY ${fmtNum(latest?.nft_total_supply)}`,
      desc: "Total OTC desks minted",
      accent: "green",
    },
    {
      label: "MKT_CAP",
      value:
        fmtCompact(latest?.token_market_cap) === "—"
          ? "—"
          : `$${fmtCompact(latest?.token_market_cap)}`,
      sub: "OTC",
      accent: "green",
    },
    {
      label: "VOL_24H",
      value:
        fmtCompact(latest?.token_volume_24h) === "—"
          ? "—"
          : `$${fmtCompact(latest?.token_volume_24h)}`,
      sub: "OTC",
      accent: "green",
    },
    {
      label: "LIQUIDITY",
      value: fmtUsd(latest?.token_liquidity_usd),
      sub: "DEX",
      accent: "green",
    },
    {
      label: "LISTED",
      value: fmtNum(latest?.nft_listed_count),
      sub: "NFTs for sale",
      accent: "amber",
    },
  ];

  return (
    <div className="mt-3 grid grid-cols-2 gap-px border border-green-500/30 bg-green-500/20 sm:grid-cols-4 lg:grid-cols-8">
      {cells.map((c) => (
        <div key={c.label} className="bg-black px-2 py-1.5" title={c.desc}>
          <div className="text-[8px] uppercase tracking-widest text-green-500/50">
            {c.label}
          </div>
          <div
            className={`mt-0.5 truncate font-mono text-xs font-bold sm:text-sm ${
              COLOR[c.accent] || COLOR.green
            }`}
          >
            {c.value}
          </div>
          <div className="font-mono text-[8px] text-green-500/50">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}