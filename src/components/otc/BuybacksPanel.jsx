import React from "react";
import { fmtSol, fmtNum } from "@/lib/format";

export default function BuybacksPanel({ latest }) {
  const buybacks = latest?.buybacks?.items || [];
  const totalSol = buybacks.reduce((a, b) => a + (b.sol || 0), 0);
  const totalOtc = buybacks.reduce((a, b) => a + (b.otc || 0), 0);

  return (
    <div className="flex h-full flex-col border border-green-500/30 bg-black p-3">
      <div className="shrink-0 text-[12px] uppercase tracking-widest text-green-500/70">
        BUYBACKS :: TREASURY
      </div>
      <div className="mt-2 grid shrink-0 grid-cols-2 gap-2">
        <div className="border border-green-500/20 p-2">
          <div className="text-[11px] uppercase text-green-500/50">SOL_BUYBACK</div>
          <div className="mt-1 font-mono text-sm font-bold text-emerald-400">{fmtSol(totalSol, 3)}</div>
        </div>
        <div className="border border-green-500/20 p-2">
          <div className="text-[11px] uppercase text-green-500/50">OTC_BURNED</div>
          <div className="mt-1 font-mono text-sm font-bold text-emerald-400">{fmtNum(totalOtc)}</div>
        </div>
      </div>
      <div className="mt-2 min-h-0 flex-1 overflow-auto lg:max-h-none max-h-48">
        <table className="w-full font-mono text-[13px]">
          <thead className="sticky top-0 bg-black text-[11px] uppercase text-green-500/50">
            <tr className="border-b border-green-500/20">
              <th className="py-1 text-left">DATE</th>
              <th className="text-right">SOL</th>
              <th className="text-right">OTC</th>
            </tr>
          </thead>
          <tbody>
            {buybacks.map((b, i) => (
              <tr key={i} className="border-b border-green-500/10">
                <td className="py-1 text-green-300">{b.date}</td>
                <td className="text-right text-green-400">{fmtSol(b.sol, 3)}</td>
                <td className="text-right text-green-500/70">{fmtNum(b.otc)}</td>
              </tr>
            ))}
            {!buybacks.length && (
              <tr>
                <td colSpan={3} className="py-4 text-center text-green-500/40">NO_BUYBACKS</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}