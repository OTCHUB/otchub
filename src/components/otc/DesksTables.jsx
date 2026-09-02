import React from "react";
import { fmtSol } from "@/lib/format";

const Th = ({ children, className = "" }) => (
  <th className={`whitespace-nowrap py-1.5 ${className}`}>{children}</th>
);

export default function DesksTables({ latest }) {
  const byStock = latest?.by_stock?.items || [];
  const perDesk = latest?.per_desk?.items || [];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="border border-green-500/30 bg-black p-3">
        <div className="text-[10px] uppercase tracking-widest text-green-500/70">
          BY_STOCK :: DISTRIBUTIONS
        </div>
        <div className="mt-2 max-h-72 overflow-auto">
          <table className="w-full font-mono text-[11px]">
            <thead className="sticky top-0 bg-black text-[9px] uppercase text-green-500/50">
              <tr className="border-b border-green-500/20">
                <Th className="text-left">SYMBOL</Th>
                <Th className="text-right">DIST_SOL</Th>
                <Th className="text-right">PER_DESK</Th>
              </tr>
            </thead>
            <tbody>
              {byStock.map((s) => (
                <tr key={s.symbol} className="border-b border-green-500/10">
                  <td className="py-1.5 text-green-300">{s.symbol}</td>
                  <td className="text-right text-green-400">{fmtSol(s.distributed_sol, 3)}</td>
                  <td className="text-right text-green-500/70">{fmtSol(s.per_desk_sol, 4)}</td>
                </tr>
              ))}
              {!byStock.length && (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-green-500/40">NO_DATA</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="border border-green-500/30 bg-black p-3">
        <div className="text-[10px] uppercase tracking-widest text-green-500/70">
          PER_DESK :: DAILY HISTORY
        </div>
        <div className="mt-2 max-h-72 overflow-auto">
          <table className="w-full font-mono text-[11px]">
            <thead className="sticky top-0 bg-black text-[9px] uppercase text-green-500/50">
              <tr className="border-b border-green-500/20">
                <Th className="text-left">DAY</Th>
                <Th className="text-right">PER_DESK</Th>
                <Th className="text-right">DESKS</Th>
              </tr>
            </thead>
            <tbody>
              {perDesk.map((d, i) => (
                <tr key={i} className="border-b border-green-500/10">
                  <td className="py-1.5 text-green-300">{d.day}</td>
                  <td className="text-right text-green-400">{fmtSol(d.per_desk_sol, 4)}</td>
                  <td className="text-right text-green-500/70">{d.desks}</td>
                </tr>
              ))}
              {!perDesk.length && (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-green-500/40">NO_DATA</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}