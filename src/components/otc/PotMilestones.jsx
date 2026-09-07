import React from "react";
import { fmtSol } from "@/lib/format";

// Routing milestones + the on-chain fee config, as verified 2026-09-06.
// Keep addresses in sync with ADDRESSES in base44/shared/otcSources.ts.
const scan = (addr) => `https://solscan.io/account/${addr}`;
const short = (addr) => `${addr.slice(0, 4)}…${addr.slice(-4)}`;

const CONFIG_ACCOUNT = "9b5VLbpXedgXcjWyboXqHMbDgeHJtb5PBsy6TE18REU4";
const PROTOCOL_WALLET = "DqMAVQ1RcQath18PrSLBVZHjwWXXN8cFEua2XuQ2rbQh";
const POT = "BZcvtxDy4WihU24k3pezzajuiqYtTUHPfH7b5m26BucR";
const OTC_POOL = "DA4pM4xSDY4M9V4CgAKKBVH1pw1yscTQQa5nEkGHuKpt";
const PUMP_GLOBAL_VAULT = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1"; // 34.6 SOL live, traced 09-07
const DEAD_VAULTS = [
  { key: "14fL3h2oe5VKk7Jkh77ML2UFMKQeKGPxZy14ZLcqkQUd", note: "old $OTC fee-vault record · CLOSED account · never funded" },
  { key: "GQr6Gu3X8TmAuwHugDX2W2Ub3HfeZoRUsv61rz8jDfmZ", note: "old launcher fee-vault record · CLOSED account · never funded" },
];

const SEGMENTS = [
  ["mint", "MINT_SURCHARGE"],
  ["royalty", "ME_ROYALTY"],
  ["launchpad", "CREATOR_FEES"],
  ["other", "UNATTRIB"],
];

const d = (day) => (day ? day.slice(5) : "—");

const Row = ({ children, tone = "text-green-500/70" }) => (
  <div className={`font-mono text-[9px] leading-relaxed ${tone}`}>{children}</div>
);

export default function PotMilestones({ latest }) {
  const days = Object.entries(latest?.pot_sources?.days || {}).sort(([a], [b]) => a.localeCompare(b));
  const since = latest?.pot_sources?.since;

  // Channel ONLINE = first tracked day with a nonzero pot inflow.
  const online = SEGMENTS.map(([key, label]) => {
    const first = days.find(([, v]) => (v?.[key] || 0) > 0);
    return { key, label, day: first?.[0] ?? null, sol: first?.[1]?.[key] ?? null };
  });

  // CREATOR_FEES peak and largest single-day routing cliff (prev ≥ 50 SOL).
  let peak = { day: null, val: 0 };
  let cliff = null;
  for (let i = 1; i < days.length; i++) {
    const [pd, pv] = days[i - 1];
    const [cd, cv] = days[i];
    const prev = pv?.launchpad || 0;
    const cur = cv?.launchpad || 0;
    if (prev > peak.val) peak = { day: pd, val: prev };
    if (prev >= 50 && cur < prev) {
      const pct = Math.round((1 - cur / prev) * 100);
      if (!cliff || pct > cliff.pct) cliff = { day: cd, prev, cur, pct };
    }
  }
  const lastEntry = days[days.length - 1];
  const lastVal = lastEntry?.[1]?.launchpad || 0;
  if (lastVal > peak.val) peak = { day: lastEntry?.[0], val: lastVal };

  // Per-desk daily take: peak closed day vs latest closed day.
  const todayKey = new Date().toISOString().slice(0, 10);
  const deskRows = (latest?.per_desk?.items || [])
    .filter((r) => String(r.day || "") < todayKey && (r.per_desk_sol || 0) > 0)
    .sort((a, b) => String(a.day).localeCompare(String(b.day)));
  const deskPeak = deskRows.reduce(
    (best, r) => ((r.per_desk_sol || 0) > (best?.per_desk_sol || 0) ? r : best),
    null
  );
  const deskNow = deskRows[deskRows.length - 1] || null;
  const deskPct =
    deskPeak && deskNow && deskPeak.per_desk_sol > 0
      ? Math.round((1 - deskNow.per_desk_sol / deskPeak.per_desk_sol) * 100)
      : null;

  return (
    <div className="mt-3 space-y-2">
      {/* milestones timeline */}
      <div className="border border-green-500/20 px-2 py-1.5">
        <div className="text-[10px] uppercase tracking-widest text-green-500/70">
          MILESTONES :: ROUTING_TIMELINE{since ? ` · tracked since ${d(since)}` : ""}
        </div>
        <div className="mt-1 space-y-0.5">
          {online.map((m) => (
            <Row key={m.key}>
              {m.day
                ? `${d(m.day)} · ${m.label} ONLINE (first +${fmtSol(m.sol, 2)}/day)`
                : `${m.label} :: NOT_YET_SEEN on the pot`}
            </Row>
          ))}
          <Row>{`${d(peak.day)} · CREATOR_FEES PEAK ${fmtSol(peak.val, 1)}/day`}</Row>
          {cliff ? (
            <Row tone="text-red-400">
              {`${d(cliff.day)} · ROUTING CLIFF −${cliff.pct}% (${fmtSol(cliff.prev, 1)} → ${fmtSol(cliff.cur, 1)} SOL/day)`}
            </Row>
          ) : null}
          {deskNow ? (
            <Row tone="text-red-400">
              {`${d(deskNow.day)} · DESK TAKE ${fmtSol(deskNow.per_desk_sol, 3)}/desk${
                deskPct != null ? ` (−${deskPct}% vs peak ${d(deskPeak?.day)})` : ""
              }`}
            </Row>
          ) : null}
          <Row tone="text-emerald-400/80">{`${d(lastEntry?.[0])} · LATEST ${fmtSol(lastVal, 1)} SOL/day creator fees reaching the pot`}</Row>
        </div>
      </div>

      {/* verified on-chain fee config */}
      <div className="border border-green-500/20 px-2 py-1.5">
        <div className="text-[10px] uppercase tracking-widest text-green-500/70">
          CONFIG :: FEE ROUTING (VERIFIED ON-CHAIN 2026-09-06)
        </div>
        <div className="mt-1 space-y-0.5">
          <Row>
            OTC_CONFIG{" "}
            <a href={scan(CONFIG_ACCOUNT)} target="_blank" rel="noopener noreferrer" className="text-cyan-300/80 underline hover:text-cyan-300">
              {short(CONFIG_ACCOUNT)} ↗
            </a>{" "}
            · owned by the OTC program · no fee-vault routing entry found
          </Row>
          <Row tone="text-amber-300/90">
            PUMP_VAULT{" "}
            <a href={scan(PUMP_GLOBAL_VAULT)} target="_blank" rel="noopener noreferrer" className="text-cyan-300/80 underline hover:text-cyan-300">
              {short(PUMP_GLOBAL_VAULT)} ↗
            </a>{" "}
            · 34.6 SOL live · swap fees settle here + pool vaults (traced 09-07) · pot not a fee recipient
          </Row>
          {DEAD_VAULTS.map((v) => (
            <Row key={v.key} tone="text-amber-300/70">
              OLD_VAULT{" "}
              <a href={scan(v.key)} target="_blank" rel="noopener noreferrer" className="text-cyan-300/80 underline hover:text-cyan-300">
                {short(v.key)} ↗
              </a>{" "}
              · {v.note}
            </Row>
          ))}
          <Row>
            $OTC_POOL{" "}
            <a href={scan(OTC_POOL)} target="_blank" rel="noopener noreferrer" className="text-cyan-300/80 underline hover:text-cyan-300">
              {short(OTC_POOL)} ↗
            </a>{" "}
            · POT not referenced in the pool account
          </Row>
          <Row>
            PROTOCOL_WALLET{" "}
            <a href={scan(PROTOCOL_WALLET)} target="_blank" rel="noopener noreferrer" className="text-cyan-300/80 underline hover:text-cyan-300">
              {short(PROTOCOL_WALLET)} ↗
            </a>{" "}
            · POT{" "}
            <a href={scan(POT)} target="_blank" rel="noopener noreferrer" className="text-cyan-300/80 underline hover:text-cyan-300">
              {short(POT)} ↗
            </a>{" "}
            · mint &amp; royalty channels unchanged
          </Row>
        </div>
      </div>

      {/* the desk-owner ask */}
      <div className="border border-red-500/40 bg-red-500/5 px-2 py-1.5">
        <div className="text-[10px] uppercase tracking-widest text-red-400">ASK_THE_DEV :: THE DESK-OWNER CASE</div>
        <ul className="mt-1 list-inside list-decimal space-y-0.5 font-mono text-[9px] text-red-400/90 marker:text-red-400/60">
          <li>
            Which config change on {cliff ? d(cliff.day) : "the cliff date"} cut creator-fee inflow to the pot
            {cliff ? ` −${cliff.pct}% overnight` : ""} while $OTC trading volume stayed flat?
          </li>
          <li>
            Why is the 10% desk share of launchpad swap fees no longer routed to the pot (per-swap deposits
            −{cliff ? cliff.pct : 85}% vs peak) while launcher-coin holders received ≈78% of all distributed funds?
          </li>
          <li>Are vault balances swept to the pot on a schedule — where is it announced and auditable?</li>
          <li>
            Desk take is now {deskNow ? `${fmtSol(deskNow.per_desk_sol, 3)}/desk` : "—"}
            {deskPct != null ? ` (−${deskPct}% from peak)` : ""} while volume held — current routing favors
            recipients outside the pot. Ask in the official OTC Telegram.
          </li>
        </ul>
      </div>
    </div>
  );
}