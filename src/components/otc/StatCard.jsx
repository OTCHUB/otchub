import React from "react";

const COLOR = {
  green: "text-green-400",
  amber: "text-amber-400",
  red: "text-red-400",
  cyan: "text-cyan-400",
};

export default function StatCard({ label, value, sub, desc, accent = "green" }) {
  return (
    <div className="border border-green-500/30 bg-black p-3">
      <div className="text-[10px] uppercase tracking-widest text-green-500/60">{label}</div>
      <div className={`mt-1 font-mono text-base font-bold sm:text-lg ${COLOR[accent] || COLOR.green}`}>
        {value}
      </div>
      {sub && <div className="font-mono text-[10px] text-green-600/80">{sub}</div>}
      {desc && (
        <div className="mt-1 text-[10px] leading-tight text-green-500/40">{desc}</div>
      )}
    </div>
  );
}