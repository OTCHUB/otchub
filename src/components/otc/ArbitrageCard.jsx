import React from "react";
import { fmtSol, fmtUsd, fmtPct } from "@/lib/format";

const ME_BASE = "https://magiceden.io/item-details";

function Field({ label, value, sub, valueClass = "text-green-300" }) {
  return (
    <div className="border border-green-500/20 bg-black/40 p-2 text-center">
      <div className="text-[9px] uppercase tracking-widest text-green-500/50">{label}</div>
      <div className={`mt-1 font-mono text-sm font-bold sm:text-base ${valueClass}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[9px] text-green-500/50">{sub}</div>}
    </div>
  );
}

export default function ArbitrageCard({ latest, holdings }) {
  const mintSol = latest?.mint_cost_sol;
  const floorSol = latest?.secondary_cost_sol;

  // Best secondary opportunity: the listed desk whose bundled stock holding
  // gives the lowest net cost (floor - accrued). Buying secondary acquires the
  // desk AND its accrued claimable SOL, so net cost = listing - accrued.
  const listed = (holdings || []).filter(
    (h) => h.is_listed && h.listing_price_sol != null && h.accrued_value_sol != null
  );
  const snipe = listed.length
    ? listed.reduce((best, h) => {
        const net = h.listing_price_sol - h.accrued_value_sol;
        return !best || net < best.net ? { ...h, net } : best;
      }, null)
    : null;

  const bestAccrued = snipe?.accrued_value_sol ?? null;
  const bestFloor = snipe?.listing_price_sol ?? floorSol;
  const effectiveSecSol =
    bestFloor != null && bestAccrued != null ? bestFloor - bestAccrued : null;

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
    <div className="border border-green-500/30 bg-black p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-green-500/70">
          ARBITRAGE :: MINT vs SECONDARY (+ STOCK)
        </span>
        <span className={`border px-2 py-0.5 font-mono text-[10px] ${rec.cls}`}>
          {rec.label}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Field
          label="MINT_FRESH"
          value={fmtSol(mintSol)}
          sub="stock included: 0 (fresh)"
          valueClass="text-amber-400"
        />
        <Field
          label="SECONDARY_FLOOR"
          value={fmtSol(bestFloor)}
          sub={`incl. 2% ME fee · stock ${fmtSol(bestAccrued, 3)}`}
          valueClass="text-cyan-400"
        />
        <Field
          label="NET_SEC_COST"
          value={fmtSol(effectiveSecSol)}
          sub="floor − stock holding"
          valueClass={secCheaper ? "text-emerald-400" : "text-red-400"}
        />
      </div>

      <div className="mt-2 space-y-1 font-mono text-[11px] sm:text-xs">
        <div className="flex justify-between">
          <span className="text-green-500/50">&gt; MINT = 100,000 OTC burned + 0.5 SOL surcharge · stock = 0</span>
          <span className="text-amber-400">{fmtUsd(latest?.mint_cost_usd)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-green-500/50">&gt; SECONDARY = floor + 2% ME buyer fee + bundled accrued stock</span>
          <span className="text-cyan-400">{fmtUsd(latest?.secondary_cost_usd)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-green-500/50">&gt; EFFECTIVE_SEC = floor (+2% fee) − stock (net cost to acquire desk + claim)</span>
          <span className={secCheaper ? "text-emerald-400" : "text-red-400"}>
            {fmtSol(effectiveSecSol, 4)}
          </span>
        </div>
        <div className="flex justify-between border-t border-green-500/20 pt-1">
          <span className="text-green-500/50">&gt; SAVINGS (MINT − NET_SEC)</span>
          <span className={savingsSol != null && savingsSol > 0 ? "text-emerald-400" : "text-red-400"}>
            {fmtSol(savingsSol, 4)} · {fmtPct(
              mintSol && savingsSol != null ? (savingsSol / mintSol) * 100 : null
            )}
          </span>
        </div>
      </div>

      {snipe && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-1 border border-emerald-500/30 bg-emerald-500/5 p-2 font-mono text-[10px]">
          <span className="text-emerald-400/80">
            BEST_SNIPES :: {snipe.name} · list {fmtSol(snipe.listing_price_sol, 3)} · stock {fmtSol(snipe.accrued_value_sol, 3)} · net {fmtSol(snipe.net, 3)}
          </span>
          <a
            href={`${ME_BASE}/${snipe.asset_id}`}
            target="_blank"
            rel="noreferrer"
            className="border border-emerald-500/50 px-2 py-0.5 text-emerald-400 hover:bg-emerald-500/10"
          >
            [BUY]
          </a>
        </div>
      )}

      <div className="mt-2 border border-green-500/20 bg-black/40 p-2 font-mono text-[11px]">
        <div className="text-[9px] uppercase tracking-widest text-green-500/50">RECOMMENDATION</div>
        <div className={`mt-1 ${rec.cls.split(" ")[0]}`}>
          {recKey === "buy_secondary"
            ? `> BUY_SECONDARY — net ${fmtSol(effectiveSecSol, 3)} < mint ${fmtSol(mintSol, 3)} (save ${fmtSol(savingsSol, 3)} SOL / desk incl. stock holding)`
            : recKey === "mint"
            ? `> MINT_NOW — mint ${fmtSol(mintSol, 3)} < secondary net ${fmtSol(effectiveSecSol, 3)} (fresh desk cheaper than listed desks after stock)`
            : "> NEUTRAL — costs within tolerance"}
        </div>
      </div>
    </div>
  );
}