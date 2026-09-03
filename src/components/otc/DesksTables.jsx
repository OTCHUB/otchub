import React, { useState } from "react";
import { fmtSol } from "@/lib/format";
import Pager from "@/components/otc/Pager";

const PAGE_SIZE = 10;

const Th = ({ children, className = "" }) => (
  <th className={`whitespace-nowrap py-1.5 ${className}`}>{children}</th>
);

// One paginated table: the panel keeps a fixed, compact footprint as the
// dataset grows — pages replace an ever-taller scroll area, so both tables
// always occupy their allocated space on PC and mobile.
function PagedTable({ title, headers, rows }) {
  const [pageNo, setPageNo] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(pageNo, pages - 1);
  const slice = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="flex h-full flex-col border border-green-500/30 bg-black p-3">
      <div className="text-[10px] uppercase tracking-widest text-green-500/70">
        {title}
      </div>
      <div className="mt-2 overflow-auto">
        <table className="w-full font-mono text-[11px]">
          <thead className="text-[9px] uppercase text-green-500/50">
            <tr className="border-b border-green-500/20">{headers}</tr>
          </thead>
          <tbody>{slice}</tbody>
        </table>
        {!rows.length && (
          <div className="py-4 text-center text-[11px] text-green-500/40">NO_DATA</div>
        )}
      </div>
      <Pager page={page} pages={pages} onPage={setPageNo} total={rows.length} label="ROWS" />
    </div>
  );
}

export default function DesksTables({ latest }) {
  const byStock = latest?.by_stock?.items || [];
  const perDesk = latest?.per_desk?.items || [];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <PagedTable
        title="BY_STOCK :: DESK ROTATION (13) · DISTRIBUTIONS"
        headers={
          <>
            <Th className="text-left">SYMBOL</Th>
            <Th className="text-right">DIST_SOL</Th>
            <Th className="text-right">PER_DESK</Th>
          </>
        }
        rows={byStock.map((s) => (
          <tr key={s.symbol} className="border-b border-green-500/10">
            <td className="py-1.5 text-green-300">{s.symbol}</td>
            <td className="text-right text-green-400">{fmtSol(s.distributed_sol, 3)}</td>
            <td className="text-right text-green-500/70">{fmtSol(s.per_desk_sol, 4)}</td>
          </tr>
        ))}
      />
      <PagedTable
        title="PER_DESK :: DAILY HISTORY"
        headers={
          <>
            <Th className="text-left">DAY</Th>
            <Th className="text-right">PER_DESK</Th>
            <Th className="text-right">DESKS</Th>
          </>
        }
        rows={perDesk.map((d, i) => (
          <tr key={i} className="border-b border-green-500/10">
            <td className="py-1.5 text-green-300">{d.day}</td>
            <td className="text-right text-green-400">{fmtSol(d.per_desk_sol, 4)}</td>
            <td className="text-right text-green-500/70">{d.desks}</td>
          </tr>
        ))}
      />
    </div>
  );
}