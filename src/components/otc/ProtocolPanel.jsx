import React from "react";
import { fmtSol, fmtNum } from "@/lib/format";

const Row = ({ label, value, desc }) => (
  <div className="border-b border-green-500/10 py-1.5 last:border-0">
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-green-500/60">{label}</span>
      <span className="font-mono text-xs text-green-300">{value}</span>
    </div>
    {desc && <div className="text-[9px] leading-tight text-green-500/30">{desc}</div>}
  </div>
);

export default function ProtocolPanel({ latest }) {
  return (
    <div className="border border-green-500/30 bg-black p-3">
      <div className="text-[10px] uppercase tracking-widest text-green-500/70">
        PROTOCOL_ECONOMICS
      </div>
      <div className="mt-2">
        <Row label="POT_BALANCE" value={fmtSol(latest?.pot_sol_balance)} desc="SOL held in the pot wallet" />
        <Row label="TOTAL_DISTRIBUTED" value={fmtSol(latest?.protocol_distributed_sol)} desc="SOL paid out to desks" />
        <Row label="EARNED" value={fmtSol(latest?.protocol_earned_sol)} desc="Gross SOL collected by protocol" />
        <Row label="BUYBACK_SOL" value={fmtSol(latest?.protocol_buyback_sol)} desc="SOL spent on OTC buybacks" />
        <Row label="OWED_TO_POT" value={fmtSol(latest?.protocol_owed_sol)} desc="Pending distribution to pot" />
        <Row label="ROUNDS" value={fmtNum(latest?.rounds_total)} desc="Distribution rounds completed" />
      </div>
    </div>
  );
}