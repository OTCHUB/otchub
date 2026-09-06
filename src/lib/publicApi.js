// Browser-safe display helpers only; no SDK, credentials, or backend runtime.
export const PUBLIC_PROBE_TIMEOUT_MS = 8000;
export const PUBLIC_SNAPSHOT_TTL_MS = 300000;

export function getPublicApiBaseUrl(origin) {
  try {
    const url = new URL(origin);
    if (url.protocol === "https:" || url.protocol === "http:") {
      return `${url.origin}/functions/`;
    }
  } catch { /* Non-browser rendering uses a same-origin relative path. */ }
  return "/functions/";
}

// A 200 response (including an SPA fallback) alone is not API evidence.
// Validate the requested metrics envelope before deriving any read status.
export function readPublicMetricsSnapshot(payload) {
  const nullableNumber = (value) => value === null || (typeof value === "number" && Number.isFinite(value));
  const validRow = (row) => row && typeof row === "object"
    && typeof row.mint === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(row.mint)
    && typeof row.symbol === "string" && typeof row.name === "string"
    && [row.vol24, row.mcap, row.change24h].every(nullableNumber);
  if (!payload || payload.schemaVersion !== 1
    || !Number.isSafeInteger(payload.at) || payload.at < 0 || payload.at > 8640000000000000 - PUBLIC_SNAPSHOT_TTL_MS
    || typeof payload.stale !== "boolean" || !["hit", "miss", "stale"].includes(payload.cache)
    || payload.scope !== "top_60_by_volume" || payload.sort !== "change24h" || payload.limit !== 1
    || !Number.isSafeInteger(payload.total) || payload.total < 0
    || !Array.isArray(payload.data) || payload.data.length > 1 || payload.data.length > payload.total
    || !payload.data.every(validRow)) return null;
  return { at: payload.at, stale: payload.stale, cache: payload.cache };
}

export function isPublicSnapshotStale(snapshot, now) {
  return snapshot.stale || snapshot.cache === "stale" || now >= snapshot.at + PUBLIC_SNAPSHOT_TTL_MS;
}

export function getPublicApiStatus(endpoint, probe, now = Date.now()) {
  if (endpoint.access !== "public") return "GATED / NOT PROBED";
  if (endpoint.name !== "getPublicMetrics") return "KNOWN / NOT PROBED";
  if (probe.phase === "loading") return "CHECKING PUBLIC READ";
  if (probe.phase === "error") return "ERROR / LAST CHECK";
  if (probe.phase !== "success" || !probe.snapshot) return "KNOWN / NOT PROBED";
  return isPublicSnapshotStale(probe.snapshot, now) ? "STALE / LAST READ" : "READ OK / LAST CHECK";
}