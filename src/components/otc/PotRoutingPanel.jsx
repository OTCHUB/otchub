import React from "react";
import { fmtSol } from "@/lib/format";
import PotMilestones from "@/components/otc/PotMilestones";
import PotFlowDiagram from "@/components/otc/PotFlowDiagram";
import PotWatchStrip from "@/components/otc/PotWatchStrip";
import PotPumpTrace from "@/components/otc/PotPumpTrace";

// Fee-routing map verified on-chain 2026-09-06 by RPC account inspection.
// Keep addresses in sync with ADDRESSES in base44/shared/otcSources.ts.
const POT = "BZcvtxDy4WihU24k3pezzajuiqYtTUHPfH7b5m26BucR";
const scan = (addr) => `https://solscan.io/account/${addr}`;
const short = (addr) => `${addr.slice(0, 4)}…${addr.slice(-4)}`;
const potTxs = () => `${scan(POT)}#transfers`;

// Live-traced pump.fun fee path (see PotPumpTrace): swap fees stay with the
// pump.fun global vault + pool vaults; the previously recorded per-coin fee
// vaults (14fL…, GQr…) are CLOSED on-chain and were never the pot's route.
const DEAD_VAULTS = [
  { src: "$OTC", key: "14fL3h2oe5VKk7Jkh77ML2UFMKQeKGPxZy14ZLcqkQUd" },
  { src: "LAUNCHER", key: "GQr6Gu3X8TmAuwHugDX2W2Ub3HfeZoRUsv61rz8jDfmZ" },
];

// Revenue-classification programs (mirror base44/shared/potSources.ts).
const OTC_PROGRAM = "AjMx5My4YUDHMiCtLpTAtgkiUJgrpJnQqd5AcQnddHQW";
const PUMPFUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMPAMM_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const ME_V1_PROGRAM = "M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K";
const ME_V2_PROGRAM = "mmm3XBJg5gk8XJxEKBvdgptZz6SgK4tXvn36sodowMc";
const OTC_POOL = "DA4pM4xSDY4M9V4CgAKKBVH1pw1yscTQQa5nEkGHuKpt";

function RouteRow({ mark, markCls, label, value, valueCls, href = null, note = null }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 border border-green-500/15 px-2 py-1 font-mono text-[11px]">
      <span className={`shrink-0 ${markCls}`}>{mark}</span>
      <span className="min-w-0 flex-1 truncate uppercase text-green-400/80">{label}</span>
      {note && <span className="shrink-0 text-green-500/50">{note}</span>}
      <span className={`shrink-0 ${valueCls}`}>{value}</span>
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" className="shrink-0 text-cyan-300/70 underline hover:text-cyan-300">
          ↗
        </a>
      )}
    </div>
  );
}

function Detail({ label, children }) {
  return (
    <details className="border border-green-500/15 px-2 py-1 text-[11px]">
      <summary className="cursor-pointer select-none font-mono uppercase tracking-widest text-green-500/50 hover:text-green-400">
        {label}
      </summary>
      <div className="mt-1">{children}</div>
    </details>
  );
}

export default function PotRoutingPanel({ latest }) {
  const ps = latest?.pot_sources;
  const dayRows = Object.entries(ps?.days || {}).sort(([a], [b]) => a.localeCompare(b));
  const lastDay = dayRows[dayRows.length - 1];
  const last = lastDay?.[1] || {};
  const dayLbl = lastDay ? lastDay[0].slice(5) : null;
  const peak = dayRows.reduce(
    (best, [d, v]) => {
      const val = v?.launchpad || 0;
      return val > best.val ? { day: d, val } : best;
    },
    { day: null, val: 0 }
  );
  const launchToday = last.launchpad || 0;
  const dropPct = peak.val > 0 ? Math.round((1 - launchToday / peak.val) * 100) : null;
  const inflow = (last.mint || 0) + (last.royalty || 0) + (last.other || 0) + launchToday;

  const todayKey = new Date().toISOString().slice(0, 10);
  const lastClosed = (latest?.per_desk?.items || [])
    .filter((d) => String(d.day || "") < todayKey)
    .sort((a, b) => String(b.day || "").localeCompare(String(a.day || "")))[0];

  return (
    <div className="space-y-1.5">
      {/* one-line header */}
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[12px] uppercase tracking-widest text-green-500/70">
          POT_ROUTING :: {dayLbl ?? "—"} · IN +{fmtSol(inflow, 2)} SOL
        </span>
        <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] text-emerald-400">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          LIVE
        </span>
      </div>

      {/* live routing health: desks owed vs pot, config change detection */}
      <PotWatchStrip />

      {/* sankey overview */}
      <PotFlowDiagram latest={latest} />

      {/* live routes — one line each */}
      <RouteRow mark="✓" markCls="text-emerald-400" label="DESK_MINTS · MINT_SURCHARGE"
        value={`+${fmtSol(last.mint, 2)}`} valueCls="text-emerald-300" href={potTxs()} />
      <RouteRow mark="✓" markCls="text-emerald-400" label="ME_SALES · 5% ROYALTY"
        value={`+${fmtSol(last.royalty, 2)}`} valueCls="text-emerald-300" href={potTxs()} />
      <RouteRow mark="△" markCls="text-amber-300" label="SWEEPS · UNATTRIB"
        value={`+${fmtSol(last.other, 2)}`} valueCls="text-amber-300" href={potTxs()} />
      <RouteRow mark="▶" markCls="text-emerald-400" label="POT → DESK_HOLDERS · AUTO_DISTRIBUTE"
        note={`${latest?.desks_minted ?? "—"} desks`} valueCls="text-emerald-300"
        value={lastClosed?.per_desk_sol != null ? `${fmtSol(lastClosed.per_desk_sol, 3)}/DESK` : "—"}
        href={scan(OTC_PROGRAM)} />

      {/* broken route — single red line */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 border border-red-500/40 bg-red-500/5 px-2 py-1 font-mono text-[11px] text-red-400">
        <span>✖ CREATOR_FEES ($OTC·LAUNCHER) → PUMP GLOBAL/POOL VAULTS ≠ POT · DESK SHARE COLLAPSED</span>
        {dropPct != null && dropPct > 0 && (
          <span className="text-red-400/80">−{dropPct}% vs peak {peak.day?.slice(5)}</span>
        )}
        <a href={potTxs()} target="_blank" rel="noopener noreferrer" className="ml-auto text-cyan-300/80 underline hover:text-cyan-300">
          TXS↗
        </a>
      </div>

      {/* pump.fun fee path — traced live on-chain 2026-09-07 */}
      <PotPumpTrace />

      {/* everything else collapsed */}
      <Detail label="[+] EVIDENCE">
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-green-500/60">
          {[
            ["PGM:OTC_MINT/DISTRIBUTE", scan(OTC_PROGRAM)],
            ["PGM:PUMP_FUN", scan(PUMPFUN_PROGRAM)],
            ["PGM:PUMP_AMM", scan(PUMPAMM_PROGRAM)],
            ["PGM:ME_V1", scan(ME_V1_PROGRAM)],
            ["PGM:ME_V2", scan(ME_V2_PROGRAM)],
            ["POOL:$OTC_SWAP", scan(OTC_POOL)],
            ["TXS:POT_TRANSFERS", potTxs()],
            ["OFFICIAL FEE_MAP", "https://otcdesks.cash/analytics"],
          ].map(([label, url]) => (
            <a key={label} href={url} target="_blank" rel="noopener noreferrer" className="text-cyan-300/80 underline hover:text-cyan-300">
              {label} ↗
            </a>
          ))}
          {DEAD_VAULTS.map((v) => (
            <a key={v.key} href={scan(v.key)} target="_blank" rel="noopener noreferrer" className="text-amber-300/80 underline hover:text-amber-300">
              OLD_VAULT:{v.src} {short(v.key)} ↗
            </a>
          ))}
        </div>
        <p className="mt-1 leading-snug text-green-500/50">
          Green routes land directly in the pot. Live-traced 2026-09-07 on the $401jk launcher pool:
          pump.fun keeps its protocol fee in the global vault (34.6 SOL) and the LP share in the pool
          vault — the coin creator fee is 0% on sampled pools and both per-coin creators hold 0 SOL.
          The pot still receives collapsed per-swap micro-deposits (−85% vs the 09-01 peak), while
          fee-funded stock rewards flow overwhelmingly to launcher-coin holders (≈78% of everything
          distributed) instead of desks. The old vault addresses recorded earlier are CLOSED on-chain
          and were never the real route. Community tooling — verify on Solscan before drawing
          conclusions.
        </p>
      </Detail>
      <Detail label="[+] HISTORY & CONFIG">
        <PotMilestones latest={latest} />
      </Detail>
    </div>
  );
}