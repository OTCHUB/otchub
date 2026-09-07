import React from "react";
import { fmtSol } from "@/lib/format";
import HelpNote from "@/components/otc/HelpNote";

// Fee-routing map verified on-chain 2026-09-06 by RPC account inspection.
// Keep addresses in sync with ADDRESSES in base44/shared/otcSources.ts.
const POT = "BZcvtxDy4WihU24k3pezzajuiqYtTUHPfH7b5m26BucR";
const scan = (addr) => `https://solscan.io/account/${addr}`;
const short = (addr) => `${addr.slice(0, 4)}…${addr.slice(-4)}`;

// pump.fun creator-fee vaults: per-swap creator fees accrue here. The vault
// authorities are neither the pot nor the protocol wallet, and the pot is not
// referenced in the pool/vault accounts — no on-chain vault→pot route exists.
const FEE_VAULTS = [
  { src: "$OTC SWAPS", key: "14fL3h2oe5VKk7Jkh77ML2UFMKQeKGPxZy14ZLcqkQUd" },
  { src: "LAUNCHER COINS", key: "GQr6Gu3X8TmAuwHugDX2W2Ub3HfeZoRUsv61rz8jDfmZ" },
];

function Node({ title, sub, href, tone = "src" }) {
  const toneCls =
    tone === "pot"
      ? "border-emerald-400/60 text-emerald-300"
      : tone === "warn"
        ? "border-amber-500/50 text-amber-300"
        : "border-green-500/30 text-green-300";
  return (
    <div className={`border bg-black px-2 py-1.5 text-center ${toneCls}`}>
      <div className="text-[10px] font-bold uppercase tracking-widest">{title}</div>
      {sub && (
        <div className="mt-0.5 font-mono text-[9px] text-green-500/60">
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="underline hover:text-green-400">
              {sub} ↗
            </a>
          ) : (
            sub
          )}
        </div>
      )}
    </div>
  );
}

function FlowEdge({ label, live, broken = false, amber = false }) {
  const labelCls = broken
    ? "text-red-400"
    : amber
      ? "text-amber-300/80"
      : "text-green-500/70";
  const head = broken ? "✖" : "▶";
  const headCls = broken ? "text-red-400" : amber ? "text-amber-400" : "text-emerald-400";
  return (
    <div className="flex flex-col items-center justify-center gap-0.5 text-center">
      <span className={`text-[9px] uppercase tracking-widest ${labelCls}`}>{label}</span>
      {live && <span className="font-mono text-[9px] text-emerald-300">{live}</span>}
      {/* horizontal route (sm+) */}
      <div className="relative hidden h-2 w-full min-w-20 sm:block">
        <div className={`absolute top-[3px] h-0.5 w-full ${broken ? "pot-flow-x pot-flow-broken" : "pot-flow-x"}`} />
        <span className={`absolute -right-0.5 -top-[6px] text-[10px] ${headCls}`}>{head}</span>
      </div>
      {/* stacked route (mobile) */}
      <div className="flex flex-col items-center sm:hidden">
        <div className={`h-5 w-0.5 ${broken ? "pot-flow-y pot-flow-broken-y" : "pot-flow-y"}`} />
        <span className={`text-[10px] ${headCls}`}>{broken ? "✖" : "▼"}</span>
      </div>
    </div>
  );
}

function FlowRow({ src, edge, dst }) {
  return (
    <div className="grid grid-cols-1 items-center gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(130px,auto)_minmax(0,1.15fr)]">
      <div>{src}</div>
      <div className="flex justify-center">{edge}</div>
      <div>{dst}</div>
    </div>
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

  const todayKey = new Date().toISOString().slice(0, 10);
  const lastClosed = (latest?.per_desk?.items || [])
    .filter((d) => String(d.day || "") < todayKey)
    .sort((a, b) => String(b.day || "").localeCompare(String(a.day || "")))[0];

  const live = (v) => (v == null ? null : `+${fmtSol(v, 2)} · ${dayLbl}`);
  const potChip = (
    <div className="border border-emerald-400/50 bg-emerald-400/5 px-2 py-1.5 text-center text-emerald-300">
      <div className="text-[10px] font-bold uppercase tracking-widest">POT ✓</div>
      <a
        href={scan(POT)}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-[9px] text-green-500/60 underline hover:text-green-400"
      >
        {short(POT)} ↗
      </a>
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <span className="text-[10px] uppercase tracking-widest text-green-500/70">
          POT_ROUTING :: SOURCE → VAULT → POT → DESKS
        </span>
        <span className="flex items-center gap-1.5 text-[9px] text-emerald-400">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          LIVE · latest tracked day {dayLbl ?? "—"}
        </span>
      </div>

      {/* stage A — fee origins and where they land */}
      <FlowRow
        src={<Node title="DESK_MINTS" sub="0.45 SOL surcharge/mint" />}
        edge={<FlowEdge label="MINT_SURCHARGE" live={live(last.mint)} />}
        dst={potChip}
      />
      <FlowRow
        src={<Node title="ME_DESK_SALES" sub="5% creator royalty" />}
        edge={<FlowEdge label="ME_ROYALTY" live={live(last.royalty)} />}
        dst={potChip}
      />
      <FlowRow
        src={<Node title="SWEEPS · MISC" sub="$OTC tax sweeps, unattributed" />}
        edge={<FlowEdge label="UNATTRIB" amber live={live(last.other)} />}
        dst={potChip}
      />
      {FEE_VAULTS.map((v) => (
        <FlowRow
          key={v.key}
          src={<Node title={v.src} sub="per-swap creator fees" />}
          edge={<FlowEdge label="CREATOR_FEES" live="ACCRUING · BALANCE NOT VISIBLE" />}
          dst={
            <Node
              title="FEE VAULT ⚠"
              sub={short(v.key)}
              href={scan(v.key)}
              tone="warn"
            />
          }
        />
      ))}

      {/* broken bridge — vaults to pot */}
      <div className="border border-red-500/40 bg-red-500/5 px-2 py-1.5 text-center">
        <span className="font-mono text-[9px] text-red-400">
          ✖ VAULT → POT :: NO ON-CHAIN ROUTE — vault authorities ≠ POT ≠ PROTOCOL_WALLET
        </span>
        {dropPct != null && dropPct > 0 && (
          <div className="mt-0.5 font-mono text-[9px] text-red-400/80">
            CREATOR_FEE inflow −{dropPct}% vs peak {peak.day?.slice(5)} ({fmtSol(peak.val, 1)} →{" "}
            {fmtSol(launchToday, 1)} SOL/day)
          </div>
        )}
      </div>

      {/* stage B — pot to desk holders */}
      <FlowRow
        src={<Node title="POT" sub={fmtSol(latest?.pot_sol_balance ?? null, 2)} href={scan(POT)} tone="pot" />}
        edge={
          <FlowEdge
            label="AUTO_DISTRIBUTE"
            live={
              lastClosed?.per_desk_sol != null
                ? `${fmtSol(lastClosed.per_desk_sol, 3)} SOL/DESK · ${String(lastClosed.day).slice(5)}`
                : null
            }
          />
        }
        dst={<Node title="DESK HOLDERS" sub={`${latest?.desks_minted ?? "—"} desks · ${fmtSol(latest?.protocol_distributed_sol ?? null, 1)} distributed total`} />}
      />

      <HelpNote label="[?] ROUTE_LEGEND">
        On-chain fee map, verified by account inspection 2026-09-06. Green routes land directly in the
        pot (mint surcharge, Magic Eden 5% royalty, sweeps). Amber UNATTRIB covers off-chain sweeps
        ($OTC trading tax). Creator fees on $OTC and launcher coins accrue inside pump.fun fee vaults
        controlled by the keys shown — those keys are neither the pot nor the protocol wallet, and the
        pot is not referenced in the vault or pool accounts, so vault balances reach desks only if
        manually swept. The launchpad pass-through (~10% of launcher creator fees) is the
        pot&apos;s largest historical inflow; the drop banner shows its decline against the tracked
        peak. Community tooling — verify on Solscan before drawing conclusions.
      </HelpNote>
    </div>
  );
}