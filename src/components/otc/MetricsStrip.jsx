import React from "react";
import { fmtSol, fmtUsd, fmtNum, fmtCompact } from "@/lib/format";

const COLOR = {
  green: "text-green-400",
  amber: "text-amber-400",
  red: "text-red-400",
  cyan: "text-cyan-400",
};

// 24H change chip helpers: emerald when up, pale red when down, dim when there
// is no stored reference point yet.
const chipCls = (v) =>
  v == null ? "text-green-500/40" : v >= 0 ? "text-emerald-400" : "text-red-400";
const pctChip = (v) =>
  v == null ? "24H —" : `24H ${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
const absChip = (v) =>
  v == null ? "24H —" : `24H ${v >= 0 ? "+" : "-"}${fmtNum(Math.abs(v))}`;
const pct = (cur, past) =>
  cur != null && past != null && past !== 0 ? ((cur - past) / Math.abs(past)) * 100 : null;
const delta = (cur, past) => (cur != null && past != null ? cur - past : null);

// All 8 headline metrics as ONE dense ticker strip (gap-px divider trick):
// a single row on desktop instead of two rows of cards, and a tight 2-column
// grid on mobile — same data, a fraction of the vertical space.
// Every metric now carries a 24H change chip (the OTC_TOKEN pattern), sourced
// from the newest stored snapshot that is at least 24h old.
export default function MetricsStrip({ latest, history }) {
  const nowMs = latest?.created_date ? Date.parse(latest.created_date) : Date.now();
  const rows = (history || [])
    .filter((h) => h?.t && !Number.isNaN(Date.parse(h.t)))
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));

  // Newest snapshot ≥24h old that actually carries the metric, per metric.
  const refVal = (key) => {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (nowMs - Date.parse(rows[i].t) < 24 * 3600 * 1000) continue;
      if (rows[i][key] != null) return rows[i][key];
    }
    return null;
  };

  // chg = numeric change driving the chip (pct for prices, absolute for counts)
  const solChg = pct(latest?.sol_price_usd, refVal("sol_price_usd"));
  const otcChg = latest?.token_price_change_24h ?? null;
  const floorChg = pct(latest?.nft_floor_sol, refVal("nft_floor_sol"));
  const desksChg = delta(latest?.desks_minted, refVal("desks_minted"));
  const capChg = pct(latest?.token_market_cap, refVal("token_market_cap"));
  const volChg = pct(latest?.token_volume_24h, refVal("token_volume_24h"));
  const liqChg = pct(latest?.token_liquidity_usd, refVal("token_liquidity_usd"));
  const listedChg = delta(latest?.nft_listed_count, refVal("nft_listed_count"));

  const cells = [
    {
      label: "SOL_PRICE",
      value: fmtUsd(latest?.sol_price_usd),
      chg: solChg,
      change: pctChip(solChg),
      desc: "Wrapped SOL spot price",
      accent: "cyan",
    },
    {
      label: "OTC_TOKEN",
      value: fmtUsd(latest?.token_price_usd, 5),
      // DexScreener's own rolling 24h change — more accurate than a snapshot diff.
      chg: otcChg,
      change: pctChip(otcChg),
      desc: "OTC token spot market price",
      accent: "green",
    },
    {
      label: "NFT_FLOOR",
      value: fmtSol(latest?.secondary_cost_sol),
      chg: floorChg,
      change: pctChip(floorChg),
      sub: fmtUsd(latest?.secondary_cost_usd),
      desc: "ME floor incl. 2% + 5% fees",
      accent: "amber",
    },
    {
      label: "DESKS_MINTED",
      value: fmtNum(latest?.desks_minted),
      chg: desksChg,
      change: absChip(desksChg),
      desc: "Total OTC desks minted",
      accent: "green",
    },
    {
      label: "MKT_CAP",
      value:
        fmtCompact(latest?.token_market_cap) === "—"
          ? "—"
          : `$${fmtCompact(latest?.token_market_cap)}`,
      chg: capChg,
      change: pctChip(capChg),
      desc: "OTC token market cap",
      accent: "green",
    },
    {
      label: "VOL_24H",
      value:
        fmtCompact(latest?.token_volume_24h) === "—"
          ? "—"
          : `$${fmtCompact(latest?.token_volume_24h)}`,
      chg: volChg,
      change: pctChip(volChg),
      desc: "OTC 24h trading volume",
      accent: "green",
    },
    {
      label: "LIQUIDITY",
      value: fmtUsd(latest?.token_liquidity_usd),
      chg: liqChg,
      change: pctChip(liqChg),
      sub: "DEX",
      desc: "OTC DEX liquidity",
      accent: "green",
    },
    {
      label: "LISTED",
      value: fmtNum(latest?.nft_listed_count),
      chg: listedChg,
      change: absChip(listedChg),
      sub: "NFTs for sale",
      desc: "Desks listed on the secondary market",
      accent: "amber",
    },
  ].map((c) => ({ ...c, changeCls: chipCls(c.chg) }));

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
          <div className="truncate font-mono text-[8px] text-green-500/50">
            <span className={c.changeCls}>{c.change}</span>
            {c.sub && <span> · {c.sub}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}