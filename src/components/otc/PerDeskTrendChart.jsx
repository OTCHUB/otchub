import React, { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { fmtSol, fmtUsd } from "@/lib/format";
import { useChartTheme, tipStyle, labelStyle } from "@/lib/chartTheme";

export default function PerDeskTrendChart({ latest }) {
  const T = useChartTheme();
  const [unit, setUnit] = useState("USD");
  const raw = latest?.per_desk?.items || [];
  const solUsd = latest?.sol_price_usd || 0;
  const toUnit = (sol) => (unit === "USD" ? sol * solUsd : sol);
  const fmt = (v) => (unit === "USD" ? fmtUsd(v, 3) : fmtSol(v, 4));

  // Chronological left→right (oldest at left, newest at right): the feed
  // arrives oldest-first — reversing it made the chart read backwards.
  // Only CLOSED (completed) UTC days: the newest feed day is the in-progress
  // working day whose partial numbers would distort the trend and the 7d avg.
  const todayKey = new Date().toISOString().slice(0, 10);
  // 2026-08-28 is a one-off bootstrap outlier (massive sweep dwarfing all later
  // days, flattening the whole trend): excluded from the chart and the 7d avg.
  const OUTLIER_DAY = "2026-08-28";
  const closed = raw.filter(
    (d) => String(d.day || "") < todayKey && String(d.day) !== OUTLIER_DAY
  );
  const data = closed
    .slice()
    .sort((a, b) => String(a.day).localeCompare(String(b.day)))
    .map((d) => ({ day: String(d.day), v: toUnit(d.per_desk_sol || 0) }));

  const sorted = [...closed].sort((a, b) =>
    String(b.day || "").localeCompare(String(a.day || ""))
  );
  const trailing = sorted.slice(0, 7).filter((d) => (d.per_desk_sol || 0) > 0);
  const avgSol = trailing.length
    ? trailing.reduce((a, d) => a + (d.per_desk_sol || 0), 0) / trailing.length
    : null;
  const avgVal = avgSol != null ? toUnit(avgSol) : null;

  return (
    <div className="flex h-full flex-col border border-green-500/30 bg-black p-3">
      <div className="flex shrink-0 items-center justify-between">
        <div>
          <div className="text-[12px] uppercase tracking-widest text-green-500/70">
            PER_DESK_EARN :: {unit}/DAY
          </div>
          <div className="mt-1 text-[11px] text-green-500/40">
            daily earning per activated desk · dashed = 7d avg
          </div>
        </div>
        <div className="flex gap-1">
          {["USD", "SOL"].map((u) => (
            <button
              key={u}
              onClick={() => setUnit(u)}
              className={`border px-2 py-0.5 font-mono text-[12px] ${
                unit === u ? "border-emerald-500/50 text-emerald-400" : "border-green-500/30 text-green-500/60"
              }`}
            >
              [{u}]
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 h-48 shrink-0 sm:h-56 lg:h-auto lg:min-h-0 lg:flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={T.grid} strokeDasharray="2 4" />
            <XAxis dataKey="day" stroke={T.axis} fontSize={12} tick={{ fill: T.tick }} />
            <YAxis
              stroke={T.axis}
              fontSize={12}
              tick={{ fill: T.tick }}
              tickFormatter={(v) => (unit === "USD" ? `$${+v.toFixed(2)}` : `${+v.toFixed(4)}`)}
              width={56}
            />
            <Tooltip
              contentStyle={tipStyle(T)}
              labelStyle={labelStyle(T)}
              formatter={(v) => [fmt(v), "PER_DESK"]}
            />
            {avgVal != null && (
              <ReferenceLine
                y={avgVal}
                stroke={T.secondary}
                strokeDasharray="4 3"
                label={{ value: `7d ${fmt(avgVal)}`, fill: T.secondary, fontSize: 13, position: "insideTopRight" }}
              />
            )}
            <Line type="monotone" dataKey="v" name="PER_DESK" stroke={T.primary} dot={{ r: 2, fill: T.primary }} strokeWidth={1.5} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}