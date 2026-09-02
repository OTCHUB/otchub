import React from "react";
import { fmtSol } from "@/lib/format";

const Th = ({ children, className = "" }) => (
  <th className={`py-2 ${className}`}>{children}</th>
);

export default function DesksTables({ latest }) {
  const byStock = latest?.by_stock?.items || [];
  const perDesk = latest?.per_desk?.items || [];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="text-sm font-semibold text-slate-200">By Stock</h3>
        <div className="mt-3 max-h-72 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-900/80 text-xs text-slate-500">
              <tr>
                <Th className="text-left">Symbol</Th>
                <Th className="text-right">Dist. SOL</Th>
                <Th className="text-right">Per Desk</Th>
              </tr>
            </thead>
            <tbody>
              {byStock.map((s) => (
                <tr key={s.symbol} className="border-t border-slate-800">
                  <td className="py-2 text-slate-200">{s.symbol}</td>
                  <td className="text-right text-slate-300">{fmtSol(s.distributed_sol, 3)}</td>
                  <td className="text-right text-slate-400">{fmtSol(s.per_desk_sol, 4)}</td>
                </tr>
              ))}
              {!byStock.length && (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-slate-500">No data</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="text-sm font-semibold text-slate-200">Per Desk (History)</h3>
        <div className="mt-3 max-h-72 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-900/80 text-xs text-slate-500">
              <tr>
                <Th className="text-left">Day</Th>
                <Th className="text-right">Per Desk</Th>
                <Th className="text-right">Desks</Th>
              </tr>
            </thead>
            <tbody>
              {perDesk.map((d, i) => (
                <tr key={i} className="border-t border-slate-800">
                  <td className="py-2 text-slate-200">{d.day}</td>
                  <td className="text-right text-slate-300">{fmtSol(d.per_desk_sol, 4)}</td>
                  <td className="text-right text-slate-400">{d.desks}</td>
                </tr>
              ))}
              {!perDesk.length && (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-slate-500">No data</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}