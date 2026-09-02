import React from "react";
import { fmtSol } from "@/lib/format";

const Row = ({ label, value }) => (
  <div className="flex items-center justify-between border-b border-slate-800 py-2 last:border-0">
    <span className="text-sm text-slate-400">{label}</span>
    <span className="text-sm font-medium text-slate-100">{value}</span>
  </div>
);

export default function ProtocolPanel({ latest }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <h3 className="text-sm font-semibold text-slate-200">Protocol Economics</h3>
      <div className="mt-2">
        <Row label="Pot Balance" value={fmtSol(latest?.pot_sol_balance)} />
        <Row label="Total Distributed" value={fmtSol(latest?.protocol_distributed_sol)} />
        <Row label="Earned" value={fmtSol(latest?.protocol_earned_sol)} />
        <Row label="Buyback (SOL)" value={fmtSol(latest?.protocol_buyback_sol)} />
        <Row label="Owed to Pot" value={fmtSol(latest?.protocol_owed_sol)} />
        <Row label="Rounds" value={latest?.rounds_total ?? "—"} />
      </div>
    </div>
  );
}