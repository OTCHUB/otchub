import React, { useMemo } from "react";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";

const TGE = 1_000_000_000;
const DESK_CAP = 5000;

const SUPPLY_COLOR = "#4ade80";
const DESKS_COLOR = "#22d3ee";
const RED = "#f87171";

const fmtM = (v) => (v == null ? "—" : `${(v / 1e6).toFixed(0)}M`);
const fmtK = (v) => (v == null ? "—" : v.toLocaleString());

// Metric tiles styled like the other panels' inline stat tiles
function MetricCard({ label, value, sub, subRed = false }) {
  return (
    <div className="flex-1 border border-green-500/20 bg-black px-2 py-1">
      <div className="text-[10px] uppercase tracking-widest text-green-500/50">{label}</div>
      <div className="mt-0.5 font-mono text-[12px] font-bold leading-none text-emerald-400">{value}</div>
      {sub != null && (
        <div className={`mt-0.5 font-mono text-[10px] ${subRed ? "text-red-400" : "text-green-500/50"}`}>{sub}</div>
      )}
    </div>
  );
}

export default function SupplyChart({ history, latest }) {
  // Daily datapoints: collapse the dense snapshot history to ONE point per UTC
  // day (the day's last snapshot = end-of-day reading), so the chart shows a
  // clean smooth supply-burn vs desk-mint trend instead of a jagged intraday
  // series.
  const data = useMemo(() => {
    const byDay = new Map();
    for (const h of history || []) {
      if (!h.t) continue;
      const d = new Date(h.t);
      const key = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
      const prev = byDay.get(key);
      if (!prev || new Date(h.t) > new Date(prev.t)) byDay.set(key, h);
    }
    return [...byDay.values()]
      .sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime())
      .map((h) => ({
        t: h.t,
        label: new Date(h.t).toLocaleDateString([], { month: "short", day: "2-digit", timeZone: "UTC" }),
        supply: h.token_total_supply ?? null,
        desks: h.desks_minted ?? null,
      }));
  }, [history]);

  const supplyNow = latest?.token_total_supply ?? null;
  const desksNow = latest?.desks_minted ?? null;
  const totalBurned = supplyNow != null ? TGE - supplyNow : null;
  const burnPct = supplyNow != null ? ((totalBurned / TGE) * 100).toFixed(1) : null;
  const deskDeposits = desksNow != null ? desksNow * 100_000 : null;
  const desksPct = desksNow != null ? ((desksNow / DESK_CAP) * 100).toFixed(0) : null;

  const { supplyDomain, desksDomain } = useMemo(() => {
    const sv = data.map((d) => d.supply).filter((v) => v != null);
    const dv = data.map((d) => d.desks).filter((v) => v != null);
    let sDom = [0, TGE];
    if (sv.length) {
      const min = Math.min(...sv), max = Math.max(...sv);
      const pad = (max - min) * 0.08 || 20e6;
      sDom = [
        Math.floor((min - pad) / 25e6) * 25e6,
        Math.ceil((max + pad) / 25e6) * 25e6,
      ];
    }
    // Auto-scale the desks axis around its own min/max (like the supply axis)
    // so the desks line uses the full plot height instead of pinning flat near
    // the top of a 0..cap range — keeps both lines visually balanced.
    let dDom = [0, 500];
    if (dv.length) {
      const dMin = Math.min(...dv);
      const dMax = Math.max(...dv);
      const dPad = (dMax - dMin) * 0.08 || dMax * 0.02 || 25;
      dDom = [
        Math.max(0, Math.floor((dMin - dPad) / 25) * 25),
        Math.ceil((dMax + dPad) / 25) * 25,
      ];
      if (dDom[0] >= dDom[1]) dDom = [dDom[0], dDom[0] + 25];
    }
    return { supplyDomain: sDom, desksDomain: dDom };
  }, [data]);

  const launchLabel = useMemo(() => {
    const first = data[0]?.t;
    if (!first) return "";
    return (
      new Date(first).toLocaleString([], {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
      }) + " UTC"
    );
  }, [data]);

  const asOf = latest?.created_date
    ? new Date(latest.created_date).toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" })
    : "";

  return (
    <div className="flex h-full flex-col border border-green-500/30 bg-black p-3">
      {/* Header — same panel title style as the other charts */}
      <div className="shrink-0 text-[12px] uppercase tracking-widest text-green-500/70">
        SUPPLY :: $OTC_BURN vs DESK_MINT
      </div>
      <div className="mt-1 shrink-0 text-[11px] text-green-500/40">
        DAILY $OTC SUPPLY vs CUMULATIVE DESK NFTs SINCE LAUNCH{launchLabel ? ` (${launchLabel})` : ""}
      </div>

      {/* Metric cards */}
      <div className="mt-2 flex shrink-0 flex-wrap gap-2">
        <MetricCard label="SUPPLY_NOW" value={supplyNow != null ? `${fmtM(supplyNow)} OTC` : "—"} sub={burnPct != null ? `-${burnPct}%` : null} subRed />
        <MetricCard label="TOTAL_BURNED" value={fmtM(totalBurned)} sub={deskDeposits != null ? `${fmtM(deskDeposits)} desk_deposits` : null} />
        <MetricCard label="DESKS" value={fmtK(desksNow)} sub={desksPct != null ? `${desksPct}% of ${DESK_CAP.toLocaleString()}` : null} />
      </div>

      {/* Chart — same axis/legend treatment as the other charts */}
      <div className="mt-3 h-64 shrink-0 sm:h-72 lg:h-auto lg:min-h-0 lg:flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 6, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="#0a3a1a" strokeDasharray="2 4" />
            <XAxis
              dataKey="label"
              stroke="#1a6b3a"
              fontSize={12}
              tick={{ fill: "#2a8b4a" }}
              minTickGap={20}
              interval="preserveStartEnd"
            />
            <YAxis
              yAxisId="supply"
              orientation="left"
              domain={supplyDomain}
              allowDataOverflow
              stroke={SUPPLY_COLOR}
              fontSize={12}
              tick={{ fill: SUPPLY_COLOR }}
              tickFormatter={(v) => fmtM(v)}
              width={44}
            />
            <YAxis
              yAxisId="desks"
              orientation="right"
              domain={desksDomain}
              allowDataOverflow
              stroke={DESKS_COLOR}
              fontSize={12}
              tick={{ fill: DESKS_COLOR }}
              tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}K` : `${v}`)}
              width={38}
            />
            <Tooltip
              contentStyle={{ background: "#000", border: "1px solid #1a6b3a", borderRadius: 0, fontFamily: "monospace", fontSize: 13 }}
              labelStyle={{ color: "#22c55e" }}
              itemStyle={{ color: "#4ade80" }}
              formatter={(v, n) => [
                n === "OTC_SUPPLY" ? `${fmtM(v)} OTC` : n === "DESKS" ? `${fmtK(v)}` : v,
                n,
              ]}
            />
            <Legend wrapperStyle={{ fontSize: 12, fontFamily: "monospace", color: "#2a8b4a" }} />
            <Line yAxisId="supply" type="monotone" dataKey="supply" name="OTC_SUPPLY" stroke={SUPPLY_COLOR} strokeWidth={2} dot={{ r: 2, strokeWidth: 0, fill: "auto" }} connectNulls />
            <Line yAxisId="desks" type="monotone" dataKey="desks" name="DESKS" stroke={DESKS_COLOR} strokeWidth={2} dot={{ r: 2, strokeWidth: 0, fill: "auto" }} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Footer */}
      <div className="mt-3 shrink-0 border-t border-green-500/20 pt-2">
        <div className="text-[11px] leading-tight text-green-500/50">DATA_AS_OF: {asOf}</div>
      </div>
    </div>
  );
}