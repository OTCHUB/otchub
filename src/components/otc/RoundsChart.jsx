import React from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { fmtNum, fmtSol, fmtUsd } from "@/lib/format";
import HelpNote from "@/components/otc/HelpNote";

export default function RoundsChart({ latest }) {
  const raw = latest?.per_desk?.items || [];
  // Chronological left→right (oldest at left, newest at right): the feed
  // arrives oldest-first, so sort ascending — the old reverse made the chart
  // read backwards AND made the "today" metric read the OLDEST day.
  const data = raw
    .slice()
    .sort((a, b) => String(a.day).localeCompare(String(b.day)))
    .map((d) => ({ day: String(d.day), rounds: d.rounds || 0, desks: d.desks || 0 }));

  // Pending-pot metrics: today's round velocity, live SOL sitting in the pot,
  // and the owed backlog (desk earnings not yet pushed into vaults).
  const today = data[data.length - 1] || null;
  const prevDay = data[data.length - 2] || null;
  const last7 = data.slice(-7);
  const avg7 = last7.length
    ? Math.round(last7.reduce((a, d) => a + d.rounds, 0) / last7.length)
    : 0;
  const potSol = latest?.pot_sol_balance ?? null;
  const owedSol = latest?.protocol_owed_sol ?? null;
  const solUsd = latest?.sol_price_usd ?? null;

  return (
    <div className="flex h-full flex-col border border-green-500/30 bg-black p-3">
      <div className="shrink-0 text-[12px] uppercase tracking-widest text-green-500/70">
        ROUND_VELOCITY :: ROUNDS / DAY
      </div>
      <div className="mt-1 shrink-0 text-[11px] text-green-500/40">
        distribution rounds executed per day · tooltip also shows desk count
      </div>
      <div className="mt-2 grid shrink-0 grid-cols-3 gap-1 font-mono">
        <div className="border border-green-500/20 px-2 py-1">
          <div className="text-[10px] uppercase tracking-widest text-green-500/50">
            ROUNDS_TODAY
          </div>
          <div className="text-[12px] font-bold text-emerald-400">
            {today ? today.rounds : "—"}
            <span className="ml-1 text-[10px] font-normal text-green-500/50">
              {prevDay ? `YEST ${prevDay.rounds} · ` : ""}7D_AVG {avg7}
            </span>
          </div>
        </div>
        <div className="border border-green-500/20 px-2 py-1">
          <div className="text-[10px] uppercase tracking-widest text-green-500/50">
            POT_BAL (LIVE)
          </div>
          <div className="text-[12px] font-bold text-emerald-400">
            {potSol != null ? fmtSol(potSol, 3) : "—"}
            {potSol != null && solUsd != null && (
              <span className="ml-1 text-[10px] font-normal text-green-500/50">
                ≈ {fmtUsd(potSol * solUsd)}
              </span>
            )}
          </div>
        </div>
        <div
          className={`border px-2 py-1 ${
            owedSol != null && owedSol > 1 ? "border-amber-500/50 bg-amber-500/5" : "border-green-500/20"
          }`}
        >
          <div className="text-[10px] uppercase tracking-widest text-green-500/50">
            OWED_BACKLOG
          </div>
          <div
            className={`text-[12px] font-bold ${
              owedSol != null && owedSol > 1 ? "text-amber-400" : "text-emerald-400"
            }`}
          >
            {owedSol != null ? fmtSol(owedSol, 3) : "—"}
            {owedSol != null && solUsd != null && (
              <span className="ml-1 text-[10px] font-normal text-green-500/50">
                ≈ {fmtUsd(owedSol * solUsd)}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="shrink-0">
        <HelpNote label="[?] POT_BAL / OWED_LEGEND">
          POT_BAL = SOL sitting in the pot right now. OWED_BACKLOG = desk earnings
          not yet pushed into vaults — cleared by a permissionless distribute
          (runs automatically when claiming). Rounds are driven by buyback spend.
        </HelpNote>
      </div>
      <div className="mt-3 h-52 shrink-0 sm:h-64 lg:h-auto lg:min-h-0 lg:flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#0a3a1a" strokeDasharray="2 4" />
            <XAxis dataKey="day" stroke="#1a6b3a" fontSize={12} tick={{ fill: "#2a8b4a" }} />
            <YAxis
              stroke="#1a6b3a"
              fontSize={12}
              tick={{ fill: "#2a8b4a" }}
              tickFormatter={(v) => `${+v.toFixed(0)}`}
              width={56}
            />
            <Tooltip
              contentStyle={{ background: "#000", border: "1px solid #1a6b3a", borderRadius: 0, fontFamily: "monospace", fontSize: 13 }}
              labelStyle={{ color: "#22c55e" }}
              formatter={(v, n) => [fmtNum(v), n]}
            />
            <Bar dataKey="rounds" name="ROUNDS" fill="#0a3a1a" stroke="#1a6b3a" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}