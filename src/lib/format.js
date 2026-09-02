const num = (v) => (v == null || v === "" || isNaN(v) ? null : Number(v));

export const fmtSol = (v, d = 3) => {
  const n = num(v);
  return n == null ? "—" : `${n.toFixed(d)} SOL`;
};

export const fmtUsd = (v, d = 2) => {
  const n = num(v);
  if (n == null) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
};

export const fmtPct = (v, d = 2) => {
  const n = num(v);
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;
};

export const fmtNum = (v) => {
  const n = num(v);
  return n == null ? "—" : n.toLocaleString();
};

export const fmtCompact = (v) => {
  const n = num(v);
  if (n == null) return "—";
  return Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 }).format(n);
};

export const timeAgo = (iso) => {
  if (!iso) return "—";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 0) return "just now";
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};