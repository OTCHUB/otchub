import React from "react";
import { fmtSol, fmtUsd, fmtPct } from "@/lib/format";
import { useLiveVaultHoldings } from "@/lib/useLiveVaultHoldings";

const ME_BASE = "https://magiceden.io/item-details";
const short = (s) => `${String(s).slice(0, 4)}…${String(s).slice(-4)}`;

// Mint-vs-secondary arbitrage, stated up front: the two net costs sit side by
// side in big type, a one-line verdict names the winner and the saving, and
// NEAR_FLOOR lists the 3 cheapest desks to snipe right now (with their real
// vault stock). Fills the full panel height to match PROTOCOL next to it.
export default function ArbitrageCard({ latest, holdings }) {
  const mintSol = latest?.mint_cost_sol;
  const floorSol = latest?.secondary_cost_sol;

  // Best secondary opportunity: the listed desk whose bundled stock holding
  // gives the lowest net cost (floor - stock). Buying secondary acquires the
  // desk AND the stock sitting in its vault — so use the REAL on-chain vault
  // balance (live scan), not the snapshot's theoretical accrued estimate: a
  // desk whose owner already claimed holds ZERO real stock, and crediting it
  // with the stale estimate would recommend a misleading buy. Empty-vault
  // desks are excluded from the snipe entirely (nothing to claim after buy).
  const listedAll = (holdings || []).filter(
    (h) => h.is_listed && h.listing_price_sol != null
  );
  const { realHold, scanning: liveScanning } = useLiveVaultHoldings(listedAll);
  const holdSol = (h) =>
    realHold[h.asset_id]?.loaded
      ? realHold[h.asset_id].holdingSol || 0
      : h.accrued_value_sol || 0;
  const holdIsLive = (h) => !!realHold[h.asset_id]?.loaded;
  const vaultHasStock = (h) =>
    realHold[h.asset_id]?.loaded ? !!realHold[h.asset_id].hasStock : true;
  const listed = listedAll.filter((h) => vaultHasStock(h));

  // Every viable snipe ranked by net cost; the top 3 feed NEAR_FLOOR below.
  const ranked = [...listed]
    .map((h) => ({ ...h, net: h.listing_price_sol - holdSol(h) }))
    .sort((a, b) => a.net - b.net);
  const snipe = ranked[0] || null;
  // Cap the near-floor list so the panel never bloats the screen.
  const TOP_N = 15;
  const shown = ranked.slice(0, TOP_N);

  const bestAccrued = snipe ? holdSol(snipe) : null;
  const bestFloor = snipe?.listing_price_sol ?? floorSol;
  const effectiveSecSol =
    bestFloor != null && bestAccrued != null ? bestFloor - bestAccrued : null;
  // Listed desks skipped because their vaults were already claimed out.
  const excludedEmpty = listedAll.filter((h) => !vaultHasStock(h)).length;

  // Recommendation: lower net cost wins. A fresh mint ships with 0 stock, so
  // its effective cost is the raw mint cost. Secondary net is floor - stock.
  let recKey = "neutral";
  if (effectiveSecSol != null && mintSol != null) {
    if (effectiveSecSol < mintSol - 0.0001) recKey = "buy_secondary";
    else if (effectiveSecSol > mintSol + 0.0001) recKey = "mint";
  } else if (latest?.recommendation) {
    recKey = latest.recommendation;
  }
  const REC = {
    buy_secondary: { label: "BUY_SECONDARY", cls: "text-emerald-400 border-emerald-500/50" },
    mint: { label: "MINT_NOW", cls: "text-amber-400 border-amber-500/50" },
    neutral: { label: "NEUTRAL", cls: "text-green-500/70 border-green-500/30" },
  };
  const rec = REC[recKey] || REC.neutral;

  const secCheaper =
    effectiveSecSol != null && mintSol != null && effectiveSecSol < mintSol;
  const savingsSol =
    effectiveSecSol != null && mintSol != null ? mintSol - effectiveSecSol : null;

  return (
    <div className="flex h-full flex-col border border-green-500/30 bg-black p-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-green-500/70">
          ARBITRAGE :: MINT vs SECONDARY{liveScanning ? " · SCANNING…" : ""}
        </span>
        <span className={`border px-2 py-0.5 font-mono text-[10px] ${rec.cls}`}>
          {rec.label}
        </span>
      </div>

      {/* The point, in big type: which side is cheaper right now */}
      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
        <div className="border border-amber-500/30 bg-amber-500/5 p-2 text-center">
          <div className="text-[9px] uppercase tracking-widest text-amber-500/70">
            MINT_FRESH
          </div>
          <div className="mt-1 font-mono text-lg font-bold text-amber-400 sm:text-xl">
            {fmtSol(mintSol)}
          </div>
          <div className="mt-0.5 text-[9px] text-amber-500/50">
            ≈ {fmtUsd(latest?.mint_cost_usd)} · stock 0
          </div>
        </div>
        <div className="flex items-center px-1 text-[10px] text-green-500/50">VS</div>
        <div
          className={`p-2 text-center ${
            secCheaper
              ? "border border-emerald-500/30 bg-emerald-500/5"
              : "border border-cyan-500/30 bg-cyan-500/5"
          }`}
        >
          <div className="text-[9px] uppercase tracking-widest text-cyan-400/70">
            NET_SECONDARY
          </div>
          <div
            className={`mt-1 font-mono text-lg font-bold sm:text-xl ${
              secCheaper ? "text-emerald-400" : "text-cyan-400"
            }`}
          >
            {fmtSol(effectiveSecSol)}
          </div>
          <div className="mt-0.5 text-[9px] text-cyan-500/50">
            floor {fmtSol(bestFloor, 2)} − stock {fmtSol(bestAccrued, 2)}
          </div>
        </div>
      </div>

      {/* One-line verdict */}
      <div className={`mt-2 border px-2 py-1.5 text-center font-mono text-[10px] sm:text-[11px] ${rec.cls}`}>
        {recKey === "buy_secondary"
          ? `SECONDARY_WINS :: save ${fmtSol(savingsSol, 3)} (${fmtPct(
              mintSol && savingsSol != null ? (savingsSol / mintSol) * 100 : null
            )}) per desk — floor desk ships with ${fmtSol(bestAccrued, 3)} stock`
          : recKey === "mint"
          ? `MINT_WINS :: fresh desk ${fmtSol(savingsSol != null ? -savingsSol : null, 3)} cheaper — listed desks cost more even after their stock`
          : "WITHIN_TOLERANCE :: mint and secondary net costs are equal"}
      </div>

      {/* NEAR_FLOOR: the 3 cheapest desks to snipe right now */}
      <div className="mt-3 flex min-h-0 flex-1 flex-col border border-green-500/20">
        <div className="flex items-center justify-between border-b border-green-500/20 px-2 py-1">
          <span className="text-[9px] uppercase tracking-widest text-green-500/50">
            NEAR_FLOOR :: TOP_{TOP_N} ({ranked.length}) · NET_ASC
          </span>
          {excludedEmpty > 0 && (
            <span className="text-[9px] text-red-400/60">
              {excludedEmpty} SKIPPED (EMPTY_VAULT)
            </span>
          )}
        </div>
        {/* Near-floor list scrolls inside the panel; bounded height on mobile so
            the panel stacks cleanly in the vertical page flow instead of
            stretching to fit every entry. */}
        <div className="min-h-0 flex-1 overflow-y-auto max-h-72 lg:max-h-none">
        {shown.length ? (
          shown.map((h, i) => (
            <a
              key={h.asset_id}
              href={`${ME_BASE}/${h.asset_id}`}
              target="_blank"
              rel="noreferrer"
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b border-green-500/10 px-2 py-1.5 text-[10px] hover:bg-green-500/5 last:border-0"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="text-green-500/40">#{i + 1}</span>
                <span className="truncate text-green-300">{h.name || short(h.asset_id)}</span>
              </span>
              <span className="flex flex-wrap items-center gap-x-3 font-mono text-green-500/70">
                <span>
                  LIST <span className="text-cyan-400">{fmtSol(h.listing_price_sol, 2)}</span>
                </span>
                <span>
                  STOCK{" "}
                  <span className="text-emerald-400">
                    {fmtSol(holdSol(h), 2)}
                    {holdIsLive(h) ? "" : "*"}
                  </span>
                </span>
                <span>
                  NET{" "}
                  <span className="font-bold text-emerald-300">{fmtSol(h.net, 2)}</span>
                </span>
                <span className="text-emerald-400">[BUY ↗]</span>
              </span>
            </a>
          ))
        ) : (
          <div className="px-2 py-2 text-center text-[10px] text-green-500/50">
            NO_LIVE_LISTINGS — no stocked desks for sale right now
          </div>
        )}
        </div>
      </div>
      {ranked.some((h) => !holdIsLive(h)) && (
        <div className="mt-1 text-right text-[8px] text-green-500/40">
          * stock estimated — live vault scan in progress
        </div>
      )}

      {/* CTAs pinned to the bottom of the panel */}
      <div className="mt-auto flex flex-wrap gap-2 pt-3">
        <button
          onClick={() =>
            document.getElementById("otc-listings")?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
          className={`border px-2 py-1 font-mono text-[10px] ${
            recKey === "buy_secondary"
              ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-400"
              : "border-green-500/30 text-green-500/60"
          }`}
        >
          [→ BUY_SECONDARY · LISTINGS]
        </button>
        {recKey === "mint" ? (
          <a
            href="https://otcdesks.cash/mint"
            target="_blank"
            rel="noopener noreferrer"
            className="border border-amber-500/60 bg-amber-500/10 px-2 py-1 font-mono text-[10px] font-bold text-amber-400 hover:bg-amber-500/20"
            title="Mint a fresh OTC desk on the official protocol app"
          >
            [→ MINT ↗ otcdesks.cash]
          </a>
        ) : (
          <button
            onClick={() =>
              document.getElementById("otc-swap")?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
            className="border border-green-500/30 px-2 py-1 font-mono text-[10px] text-green-500/60"
          >
            [→ MINT · SWAP OTC]
          </button>
        )}
      </div>
    </div>
  );
}