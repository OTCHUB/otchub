import React from "react";
import { fmtSol, fmtNum, fmtUsd } from "@/lib/format";

const Row = ({ label, value, desc }) => (
  <div className="border-b border-green-500/10 py-1.5 last:border-0">
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-green-500/60">{label}</span>
      <span className="font-mono text-xs text-green-300">{value}</span>
    </div>
    {desc && <div className="text-[9px] leading-tight text-green-500/30">{desc}</div>}
  </div>
);

const Section = ({ title, children }) => (
  <div className="mt-3 border-t border-green-500/20 pt-2">
    <div className="text-[9px] uppercase tracking-widest text-green-500/50">{title}</div>
    {children}
  </div>
);

export default function ProtocolPanel({ latest }) {
  const tge = latest?.token_tge_supply ?? 1_000_000_000;
  const burnt = latest?.token_burnt;
  const burntPct =
    burnt != null && tge > 0 ? ((burnt / tge) * 100).toFixed(2) : null;

  return (
    <div className="border border-green-500/30 bg-black p-3">
      <div className="text-[10px] uppercase tracking-widest text-green-500/70">
        PROTOCOL_ECONOMICS
      </div>
      <div className="mt-2">
        <Row label="POT_BALANCE" value={fmtSol(latest?.pot_sol_balance)} desc="SOL held in the pot wallet" />
        <Row label="TOTAL_DISTRIBUTED" value={fmtSol(latest?.protocol_distributed_sol)} desc="SOL paid out to desks" />
        <Row label="EARNED" value={fmtSol(latest?.protocol_earned_sol)} desc="Gross SOL collected by protocol" />
        <Row label="OWED_TO_POT" value={fmtSol(latest?.protocol_owed_sol)} desc="Pending distribution to pot" />
        <Row label="ROUNDS" value={fmtNum(latest?.rounds_total)} desc="Distribution rounds completed" />
      </div>

      <Section title="SUPPLY :: BURN (ON-CHAIN)">
        <Row label="TGE_SUPPLY" value={`${fmtNum(latest?.token_tge_supply ?? tge)} OTC`} desc="Genesis total supply" />
        <Row label="CURRENT_SUPPLY" value={`${fmtNum(latest?.token_total_supply)} OTC`} desc="On-chain circulating supply" />
        <Row
          label="BURNT_FOREVER"
          value={burnt != null ? `${fmtNum(burnt)} OTC` : "—"}
          desc={`burned via minting + usage${burntPct != null ? ` · ${burntPct}% of TGE` : ""}`}
        />
      </Section>

      <Section title="BUYBACK TREASURY">
        <Row label="BUYBACK_SOL" value={fmtSol(latest?.protocol_buyback_sol)} desc="SOL in buyback treasury" />
        <Row label="BUYBACK_OTC" value={`${fmtNum(latest?.protocol_buyback_otc)} OTC`} desc="OTC held in buyback treasury" />
        <Row label="OTC_VALUE_SOL" value={fmtSol(latest?.protocol_buyback_otc_value_sol, 4)} desc="Treasury OTC valued in SOL" />
        <Row label="OTC_VALUE_USD" value={fmtUsd(latest?.protocol_buyback_otc_value_usd)} desc="Treasury OTC valued in USD" />
      </Section>
    </div>
  );
}