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
  // Base44 serializes datetimes as naive UTC (no "Z"/offset), which the JS
  // Date parser misreads as local time — skewing the relative value by the
  // viewer's timezone offset (e.g. 7h in UTC+7). Force UTC parsing when the
  // timestamp carries no explicit offset.
  let s = iso;
  if (
    typeof s === "string" &&
    s.includes("T") &&
    !s.endsWith("Z") &&
    !/[+-]\d\d:?\d\d$/.test(s)
  ) {
    s = s + "Z";
  }
  const diff = (Date.now() - new Date(s).getTime()) / 1000;
  if (diff < 0) return "just now";
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};