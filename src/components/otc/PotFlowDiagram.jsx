import React from "react";
import { Rectangle, ResponsiveContainer, Sankey, Tooltip } from "recharts";
import { fmtSol } from "@/lib/format";

// Horizontal one-day flow diagram: where the pot's SOL came from and where it
// went. Left → right: inflow sources → POT → desk distribution + retained
// balance. Ribbon width = SOL of the last CLOSED tracked day (inflow segments
// from the on-chain pot scan; outflow = that day's desk distribution).

function DiagramNode({ x, y, width, height, index, payload, potIndex }) {
  const name = payload?.name ?? "";
  const value = Number.isFinite(payload?.value) ? payload.value : null;
  const isPot = index === potIndex;
  const isOut = index > potIndex;
  const fill = isPot ? "#34d399" : isOut ? "#22d3ee" : "#10b981";
  return (
    <g>
      <Rectangle x={x} y={y} width={width} height={height} fill={fill} fillOpacity={isPot ? 0.95 : 0.7} />
      <text
        x={isOut ? x + width + 6 : x - 6}
        y={y + height / 2 - 2}
        textAnchor={isOut ? "start" : "end"}
        dominantBaseline="middle"
        fill={isOut ? "#67e8f9" : "#4ade80"}
        fontSize="9"
        fontFamily="ui-monospace, monospace"
        letterSpacing="1.5"
      >
        {name}
      </text>
      {value != null && value > 0 && (
        <text
          x={isOut ? x + width + 6 : x - 6}
          y={y + height / 2 + 10}
          textAnchor={isOut ? "start" : "end"}
          dominantBaseline="middle"
          fill="#86efac"
          fontSize="8"
          fontFamily="ui-monospace, monospace"
        >
          {fmtSol(value, 2)} SOL
        </text>
      )}
    </g>
  );
}

function DiagramLink({ sourceX, sourceY, sourceControlX, targetControlX, targetX, targetY, targetControlY, linkWidth }) {
  return (
    <path
      d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY} L${targetX},${targetY + linkWidth} C${targetControlX},${targetY + linkWidth} ${sourceControlX},${sourceY + linkWidth} ${sourceX},${sourceY + linkWidth} Z`}
      fill="rgba(52,211,153,0.16)"
      stroke="rgba(52,211,153,0.45)"
      strokeWidth={0.5}
    />
  );
}

export default function PotFlowDiagram({ latest }) {
  const todayKey = new Date().toISOString().slice(0, 10);
  const dayRows = Object.entries(latest?.pot_sources?.days || {}).sort(([a], [b]) => a.localeCompare(b));
  const closedRows = dayRows.filter(([d]) => d < todayKey);
  const [day, seg] = closedRows.at(-1) || dayRows.at(-1) || [];
  const mint = seg?.mint || 0;
  const royalty = seg?.royalty || 0;
  const launchpad = seg?.launchpad || 0;
  const other = seg?.other || 0;

  const deskRows = (latest?.per_desk?.items || [])
    .filter((r) => String(r.day || "") < todayKey)
    .sort((a, b) => String(a.day).localeCompare(String(b.day)));
  const sameDayDesk = deskRows.find((r) => r.day === day);
  const dist = (sameDayDesk || deskRows.at(-1) || {}).total_earned_sol || 0;

  const inflow = mint + royalty + launchpad + other;
  const retained = Math.max(0, inflow - dist);

  const sources = [
    ["DESK_MINTS", mint],
    ["ME_SALES", royalty],
    ["SWEEPS·MISC", other],
  ].filter(([, v]) => v > 0);

  const nodes = sources.map(([name]) => ({ name }));
  const potIndex = nodes.length;
  nodes.push({ name: "POT" });
  const links = sources.map(([name, value], i) => ({ source: i, target: potIndex, value }));
  let outIndex = potIndex + 1;
  if (dist > 0) {
    nodes.push({ name: "DESK_HOLDERS" });
    links.push({ source: potIndex, target: outIndex++, value: dist });
  }
  if (retained > 0.005) {
    nodes.push({ name: "RETAINED" });
    links.push({ source: potIndex, target: outIndex, value: retained });
  }

  const names = nodes.map((n) => n.name);
  const FlowTip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const l = payload[0]?.payload;
    if (l == null || !Number.isFinite(l.value)) return null;
    return (
      <div className="border border-green-500/40 bg-black px-2 py-1 font-mono text-[9px] text-green-300">
        {names[l.source]} → {names[l.target]} · {fmtSol(l.value, 3)} SOL
      </div>
    );
  };

  return (
    <div className="border border-green-500/20 px-2 py-1.5">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <span className="text-[10px] uppercase tracking-widest text-green-500/70">
          FLOW DIAGRAM :: {day ? day.slice(5) : "—"} (CLOSED DAY · RIBBON = SOL)
        </span>
        <span className="font-mono text-[9px] text-green-500/60">
          IN {fmtSol(inflow, 1)} · DIST {fmtSol(dist, 1)} · RETAINED {fmtSol(retained, 1)}
        </span>
      </div>
      {links.length ? (
        <div className="mt-1 h-52 w-full sm:h-60">
          <ResponsiveContainer width="100%" height="100%">
            <Sankey
              data={{ nodes, links }}
              nodeWidth={10}
              nodePadding={28}
              margin={{ top: 6, right: 100, left: 100, bottom: 6 }}
              node={<DiagramNode potIndex={potIndex} />}
              link={<DiagramLink />}
            >
              <Tooltip content={FlowTip} />
            </Sankey>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="py-4 text-center text-[10px] text-green-500/50">
          NO FLOW DATA FOR THE LAST CLOSED DAY
        </div>
      )}
      {launchpad <= 0 && (
        <div className="mt-0.5 text-center font-mono text-[9px] text-red-400">
          ✖ CREATOR_FEES :: 0.00 SOL reached the pot this day — route broken (see VAULT → POT below)
        </div>
      )}
    </div>
  );
}