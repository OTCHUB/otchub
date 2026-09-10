// Launcher feed Supabase mirror — fallback source for the OTC launcher panel.
// mirrorLauncherFeed (scheduled every 5 min) builds the full launcher tape and
// the analytics cohort and upserts them into the same public Supabase KV table
// the dashboard uses. When the live getLauncherLive / getLauncherAnalytics
// functions are down (quota storms, upstream outages), the panel falls back
// to the mirrored payload: rows are filtered, sorted and paged locally with
// the exact same contract the server applies.

const ENV = (typeof import.meta !== "undefined" && import.meta.env) || {};
const SUPABASE_URL = (ENV.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_ANON_KEY = ENV.VITE_SUPABASE_ANON_KEY || "";
const LIVE_KEY = "launcher_live";
const ANALYTICS_KEY = "launcher_analytics";
const MIRROR_TTL_MS = 30_000; // one shared read per poll window

const STATUS_KEYS = ["GRADUATED", "BONDING", "ABOUT_TO_GRADUATE"];
const statusKeyOf = (row) => (STATUS_KEYS.includes(row.status) ? row.status : "UNKNOWN");
// Source-reported payout shape — same contract as the server's payoutKey.
const payoutKeyOf = (row) => {
  const p = row.payoutInfo;
  if (!p) return "NONE";
  if (Array.isArray(p.rewardBasket) && p.rewardBasket.length > 1) return "BASKET";
  return p.rewardMint || p.rewardSymbol ? "SINGLE" : "NONE";
};

// Null-last stable ranking — same ordering contract as the server's
// rankLauncherRows (duplicated here because the server module can't be
// bundled into the client).
function rankRows(rows, key, ascending = false) {
  return [...rows].sort((a, b) => {
    const av = Number.isFinite(a[key]) ? a[key] : null;
    const bv = Number.isFinite(b[key]) ? b[key] : null;
    if (av === null) return bv === null ? 0 : 1;
    if (bv === null) return -1;
    if (av === bv) return 0;
    return (av < bv ? -1 : 1) * (ascending ? 1 : -1);
  });
}

async function fetchMirrorRow(key) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/otc_dashboard?select=key,payload&key=eq.${key}`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    }
  );
  if (!res.ok) throw new Error(`supabase read ${res.status}`);
  const rows = await res.json();
  if (!rows?.length) throw new Error("supabase launcher row missing");
  return rows[0].payload;
}

// Shared 30s cache: a page/filter flip inside one poll window reuses the read.
let liveCache = { at: 0, payload: null };

export async function fetchLauncherLiveMirror() {
  if (liveCache.payload && Date.now() - liveCache.at < MIRROR_TTL_MS) return liveCache.payload;
  const payload = await fetchMirrorRow(LIVE_KEY);
  if (!Array.isArray(payload?.rows) || !Number.isFinite(payload.at)) {
    throw new Error("launcher mirror unavailable");
  }
  liveCache = { at: Date.now(), payload };
  return payload;
}

export async function fetchLauncherAnalyticsMirror() {
  return await fetchMirrorRow(ANALYTICS_KEY);
}

// Client-side twin of the server's respondBody projection: identical field
// shape so the panel renders the mirrored view without special cases.
export function projectLauncherView(mirror, params = {}) {
  let scoped = mirror.rows;
  if (params.maxAgeHours != null) {
    scoped = scoped.filter((row) => row.ageH != null && row.ageH <= params.maxAgeHours);
  }
  if (params.search) {
    scoped = scoped.filter((row) => `${row.symbol} ${row.name} ${row.mint}`.toLowerCase().includes(params.search));
  }
  const statusCounts = { ALL: scoped.length, GRADUATED: 0, BONDING: 0, ABOUT_TO_GRADUATE: 0, UNKNOWN: 0 };
  for (const row of scoped) statusCounts[statusKeyOf(row)]++;
  if (params.status && params.status !== "ALL") {
    scoped = scoped.filter((row) => statusKeyOf(row) === params.status);
  }
  if (params.payout === "SINGLE" || params.payout === "BASKET") {
    scoped = scoped.filter((row) => payoutKeyOf(row) === params.payout);
  }
  const sortField = params.sort === "newest" || params.sort === "oldest" ? "ageH" : (params.sort || "vol24");
  const sorted = rankRows(scoped, sortField, params.sort === "newest");
  const pageSize = params.pageSize ?? 50;
  const pageCount = Math.max(1, Math.ceil(scoped.length / pageSize));
  const page = Math.min(params.page ?? 1, pageCount);
  const ranked = sorted.slice((page - 1) * pageSize, page * pageSize).map((row) => ({ ...row }));
  return {
    at: mirror.at,
    stale: true,
    ranked,
    riskCoverage: { ...(mirror.riskCoverage || {}), forceStale: true },
    statusCounts,
    matches: scoped.length,
    page,
    pageCount,
    pageSize,
    rosterTotal: mirror.rosterTotal,
    rewardSymbols: mirror.rewardSymbols || {},
    rewardCatalog: mirror.rewardCatalog || { byMint: {}, bySymbol: {} },
    candidateCount: mirror.candidateCount,
    statusChecked: mirror.statusChecked,
    statusError: mirror.statusError,
    nearThreshold: mirror.nearThreshold,
    pendingGraduation: mirror.pendingGraduation || [],
    sourceError: "LIVE_FUNCTION_UNAVAILABLE",
  };
}