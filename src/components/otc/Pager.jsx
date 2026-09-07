import React from "react";

// Shared pager for paged panels (gallery, distribution tables): large datasets
// page inside their allocated panel space instead of stretching the layout.
export default function Pager({ page, pages, onPage, total, label = "ROWS" }) {
  if (pages <= 1) {
    return (
      <div className="mt-2 text-center font-mono text-[11px] text-green-500/40">
        {total} {label}
      </div>
    );
  }
  const btn =
    "min-h-[36px] border border-green-500/40 px-2.5 font-mono text-[12px] text-green-400 hover:bg-green-500/10 disabled:opacity-30";
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-2 font-mono text-[12px]">
      <button className={btn} disabled={page === 0} onClick={() => onPage(page - 1)}>
        [◀ PREV]
      </button>
      <span className="text-green-500/60">
        PAGE {page + 1}/{pages} · {total} {label}
      </span>
      <button className={btn} disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>
        [NEXT ▶]
      </button>
    </div>
  );
}