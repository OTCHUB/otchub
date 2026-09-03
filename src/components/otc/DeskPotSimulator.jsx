import React, { useState } from "react";
import { fmtSol, fmtUsd } from "@/lib/format";

function Metric({ label, value, sub, accent = "text-green-300" }) {
  return (
    <div className="border border-green-500/20 px-2 py-1.5">
      <div className="text-[8px] uppercase tracking-widest text-green-500/50">{label}</div>
      <div className={`mt-0.5 font-mono text-sm font-bold leading-none ${accent}`}>{value}</div>
      {sub && <div className="mt-0.5 font-mono text-[8px] text-green-500/50">{sub}</div>}
    </div>
  );
}

// Simulates desk-pot revenue: N desks bought at a given SOL price, earning at
// the current closed-day 7D average per-desk rate. Shows the projected
// per-day revenue, APR and breakeven so a buy can be sanity-checked before
// minting or sniping.
export default function DeskPotSimulator({ latest }) {
  const raw = latest?.per_desk?.items || [];
  const todayKey = new Date().toISOString().slice(0, 10);
  const floorSol = latest?.nft_floor_sol || 0;
  const solUsd = latest?.sol_price_usd || 0;

  // Rate basis: 7d average of CLOSED days only (today's running day and
  // zero-earning days excluded so the projection isn't dragged down).
  const closed = [...raw]
    .filter((d) => String(d.day || "") !== todayKey)
    .sort((a, b) => String(b.day || "").localeCompare(String(a.day || "")))
    .slice(0, 7)
    .filter((d) => (d.per_desk_sol || 0) > 0);
  const rateSol = closed.length
    ? closed.reduce((a, d) => a + (d.per_desk_sol || 0), 0) / closed.length
    : null;

  const [desks, setDesks] = useState("1");
  const [price, setPrice] = useState("");

  const n = Math.max(1, Math.floor(parseFloat(desks) || 1));
  const priceSol = parseFloat(price) > 0 ? parseFloat(price) : floorSol;
  const perDaySol = rateSol != null ? rateSol * n : null;
  const perDayUsd = perDaySol != null && solUsd ? perDaySol * solUsd : null;
  const costSol = priceSol * n;
  const aprPct = perDaySol && priceSol > 0 ? (perDaySol / priceSol) * 365 * 100 : null;
  const beDays = perDaySol > 0 && costSol > 0 ? costSol / perDaySol : null;
  const cum30Sol = perDaySol != null ? perDaySol * 30 : null;
  const cumVsCost = cum30Sol != null && costSol > 0 ? (cum30Sol / costSol) * 100 : null;

  return (
    <div className="mt-3 border-t border-green-500/20 pt-2">
      <div className="text-[10px] uppercase tracking-widest text-green-500/70">
        SIM :: DESK_POT_REVENUE / DAY
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1 border border-green-500/30 px-1.5 py-1">
          <span className="font-mono text-[9px] text-green-500/40">DESKS</span>
          <input
            value={desks}
            onChange={(e) => setDesks(e.target.value)}
            inputMode="numeric"
            className="w-14 bg-transparent font-mono text-[10px] text-green-300 focus:outline-none"
          />
        </label>
        <label className="inline-flex items-center gap-1 border border-green-500/30 px-1.5 py-1">
          <span className="font-mono text-[9px] text-green-500/40">BUY ◎</span>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            placeholder={floorSol ? floorSol.toFixed(2) : "floor"}
            className="w-16 bg-transparent font-mono text-[10px] text-green-300 placeholder:text-green-500/30 focus:outline-none"
          />
        </label>
        <span className="font-mono text-[9px] text-green-500/40">
          {rateSol != null
            ? `rate = 7d closed-day avg ${fmtSol(rateSol, 4)}/DESK/DAY`
            : "rate = no closed-day data yet"}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <Metric
          label="PER_DAY"
          value={perDaySol != null ? fmtSol(perDaySol, 4) : "—"}
          sub={`≈ ${fmtUsd(perDayUsd)} · ${n} DESK${n > 1 ? "S" : ""}`}
          accent="text-emerald-400"
        />
        <Metric
          label="APR :: SIM"
          value={aprPct != null ? `${aprPct.toFixed(0)}%` : "—"}
          sub={`vs buy ${fmtSol(priceSol, 2)} ◎/DESK`}
          accent="text-cyan-400"
        />
        <Metric
          label="BREAKEVEN :: SIM"
          value={beDays != null ? `${beDays.toFixed(0)}d` : "—"}
          sub={`recoup ${fmtSol(costSol, 2)} ◎ cost`}
          accent="text-amber-400"
        />
        <Metric
          label="30D_CUM"
          value={cum30Sol != null ? fmtSol(cum30Sol, 3) : "—"}
          sub={
            cumVsCost != null
              ? `≈ ${fmtUsd(solUsd ? cum30Sol * solUsd : null)} · ${cumVsCost.toFixed(0)}% of cost`
              : null
          }
          accent="text-green-300"
        />
      </div>
    </div>
  );
}