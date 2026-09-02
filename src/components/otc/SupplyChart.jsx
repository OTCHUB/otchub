import React, { useMemo } from "react";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { TreePine, ArrowRight } from "lucide-react";

const TGE = 1_000_000_000;
const DESK_CAP = 5000;

const SUPPLY_COLOR = "#5d8a70";
const DESKS_COLOR = "#3a696c";
const RED = "#a63f3f";
const PAPER = "#e3dfd6";
const INK = "#1a1a1a";
const GRID = "#d1ccc0";

const fmtM = (v) => (v == null ? "—" : `${(v / 1e6).toFixed(0)}M`);
const fmtK = (v) => (v == null ? "—" : v.toLocaleString());

function MetricCard({ label, value, sub, subRed }) {
  return (
    <div className="flex-1 rounded-sm border px-2.5 py-2" style={{ borderColor: INK, background: PAPER }}>
      <div className="text-[8px] uppercase tracking-[0.18em] text-neutral-700">{label}</div>
      <div className="mt-0.5 font-mono text-lg font-bold leading-none" style={{ color: INK }}>{value}</div>
      {sub != null && (
        <div className="mt-0.5 font-mono text-[10px]" style={{ color: subRed ? RED : "#555" }}>{sub}</div>
      )}
    </div>
  );
}

export default function SupplyChart({ history, latest }) {
  const data = useMemo(
    () =>
      (history || [])
        .map((h) => ({
          t: h.t,
          label: h.t ? new Date(h.t).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "",
          supply: h.token_total_supply ?? null,
          desks: h.desks_minted ?? null,
        }))
        .filter((d) => d.t),
    [history]
  );

  const supplyNow = latest?.token_total_supply ?? null;
  const desksNow = latest?.desks_minted ?? null;
  const totalBurned = supplyNow != null ? TGE - supplyNow : null;
  const burnPct = supplyNow != null ? ((totalBurned / TGE) * 100).toFixed(1) : null;
  const deskDeposits = desksNow != null ? desksNow * 100_000 : null;
  const desksPct = desksNow != null ? ((desksNow / DESK_CAP) * 100).toFixed(0) : null;

  // Burn during the first recorded hour (hourly snapshot granularity).
  const firstHourBurn = useMemo(() => {
    const iso = (history || [])
      .filter((p) => p.t && /T/.test(p.t))
      .sort((a, b) => String(a.t).localeCompare(String(b.t)));
    if (iso.length < 2) return null;
    const t0 = new Date(iso[0].t).getTime();
    const s0 = iso[0].token_total_supply;
    const p1 = iso.find((p) => new Date(p.t).getTime() >= t0 + 3600 * 1000);
    if (p1 && s0 != null && p1.token_total_supply != null) return s0 - p1.token_total_supply;
    return null;
  }, [history]);

  // Axis domains — supply auto-zoomed to its data range (padded), desks 0→nice cap.
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
    const maxD = dv.length ? Math.max(...dv) : 0;
    const dTop = Math.max(500, Math.ceil((maxD * 1.05) / 500) * 500);
    return { supplyDomain: sDom, desksDomain: [0, dTop] };
  }, [data]);

  const launchLabel = useMemo(() => {
    const first = data[0]?.t;
    if (!first) return "";
    return new Date(first).toLocaleString([], {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }) + " UTC";
  }, [data]);

  const asOf = latest?.created_date
    ? new Date(latest.created_date).toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" })
    : "";

  return (
    <div className="rounded-sm border p-3 font-mono" style={{ background: PAPER, color: INK, borderColor: INK }}>
      {/* Header */}
      <div className="flex items-start gap-2">
        <TreePine className="mt-0.5 h-5 w-5 shrink-0" style={{ color: INK }} strokeWidth={2.2} />
        <div>
          <h3 className="text-base font-bold leading-tight" style={{ color: INK }}>Every Desk Eats Supply</h3>
          <p className="text-[10px] text-neutral-700">
            Hourly $OTC supply vs cumulative desk NFTs since token launch{launchLabel ? ` (${launchLabel})` : ""}
          </p>
        </div>
      </div>
      <div className="my-2 flex items-center gap-1">
        <div className="h-px flex-1" style={{ background: INK }} />
        <ArrowRight className="h-3 w-3" style={{ color: INK }} />
      </div>

      {/* Metric cards */}
      <div className="flex flex-wrap gap-2">
        <MetricCard label="Supply Now" value={supplyNow != null ? `${fmtM(supplyNow)} OTC` : "—"} sub={burnPct != null ? `-${burnPct}%` : null} subRed />
        <MetricCard label="Total Burned" value={fmtM(totalBurned)} sub={deskDeposits != null ? `${fmtM(deskDeposits)} desk deposits` : null} />
        <MetricCard label="Desks" value={fmtK(desksNow)} sub={desksPct != null ? `${desksPct}% of ${DESK_CAP.toLocaleString()}` : null} />
        <MetricCard label="First Hour" value={firstHourBurn != null ? `${fmtM(firstHourBurn)} burned` : "—"} />
      </div>

      {/* Chart + legend */}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <div className="h-64 flex-1 sm:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 6, right: 6, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="2 3" vertical={false} />
              <XAxis
                dataKey="label"
                stroke={INK}
                fontSize={9}
                tick={{ fill: "#3d3d3d" }}
                angle={-30}
                textAnchor="end"
                height={48}
                minTickGap={20}
                interval="preserveStartEnd"
              />
              <YAxis
                yAxisId="supply"
                orientation="left"
                domain={supplyDomain}
                allowDataOverflow
                stroke={SUPPLY_COLOR}
                fontSize={9}
                tick={{ fill: SUPPLY_COLOR }}
                tickFormatter={(v) => fmtM(v)}
                width={42}
              />
              <YAxis
                yAxisId="desks"
                orientation="right"
                domain={desksDomain}
                allowDataOverflow
                stroke={DESKS_COLOR}
                fontSize={9}
                tick={{ fill: DESKS_COLOR }}
                tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}K` : `${v}`)}
                width={34}
              />
              <Tooltip
                contentStyle={{ background: PAPER, border: `1px solid ${INK}`, borderRadius: 0, fontFamily: "monospace", fontSize: 11, color: INK }}
                labelStyle={{ color: INK }}
                formatter={(v, n) => [
                  n === "OTC Supply" ? `${fmtM(v)} OTC` : n === "Desks" ? `${fmtK(v)}` : v,
                  n,
                ]}
              />
              <Line yAxisId="supply" type="monotone" dataKey="supply" name="OTC Supply" stroke={SUPPLY_COLOR} strokeWidth={2} dot={false} connectNulls />
              <Line yAxisId="desks" type="monotone" dataKey="desks" name="Desks" stroke={DESKS_COLOR} strokeWidth={2} dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="w-full shrink-0 sm:w-36">
          <div className="text-[9px] uppercase tracking-[0.18em] text-neutral-700">Metrics</div>
          <div className="my-1 flex items-center gap-1">
            <div className="h-px flex-1" style={{ background: INK }} />
            <ArrowRight className="h-2.5 w-2.5" style={{ color: INK }} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: SUPPLY_COLOR }} />
              <span className="text-[11px]" style={{ color: INK }}>OTC Supply</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: DESKS_COLOR }} />
              <span className="text-[11px]" style={{ color: INK }}>Desks</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-3 flex items-end justify-between gap-2 border-t pt-2" style={{ borderColor: "#9a948a" }}>
        <div className="text-[9px] leading-tight text-neutral-700">
          <div>Data as of: {asOf}</div>
          <div>Source: OTC Pulse — on-chain (mint/burn actions + distribution)</div>
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold text-white" style={{ background: INK }}>
          <TreePine className="h-3 w-3" />
          OTC Pulse
        </div>
      </div>
    </div>
  );
}