import React from "react";

const ACCENTS = {
  emerald: "text-emerald-400",
  violet: "text-violet-400",
  amber: "text-amber-400",
  sky: "text-sky-400",
};

export default function StatCard({ label, value, sub, accent = "emerald", icon: Icon }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-slate-400">{label}</span>
        {Icon && <Icon className={`h-4 w-4 ${ACCENTS[accent] || ACCENTS.emerald}`} />}
      </div>
      <div className="mt-2 text-xl font-semibold text-slate-100">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}