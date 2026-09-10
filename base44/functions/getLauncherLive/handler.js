import { ApiError, assertKeys, errorResponse, invalidParams, readJsonBounded, requestUrl, responseHeaders } from "../../shared/apiHttp.js";
import { NEAR_THRESHOLD } from "../../shared/launcherCurve.js";
import { createLauncherLiveBuilder, rankLauncherRows } from "../../shared/launcherLiveBuilder.js";

// Re-exported for existing test/consumer imports of this module path.
export { rankLauncherRows, launcherCandidates } from "../../shared/launcherLiveBuilder.js";

const FRESH_MS = 30_000, MAX_AGE_MS = 120_000;
const DEFAULT_PAGE_SIZE = 50;
// Full-tape params. Any present param switches the response from the legacy
// bounded roster to a server-filtered/paged view of the ENTIRE roster.
const PAGE_KEYS = ["page", "pageSize", "sort", "status", "search", "maxAgeHours", "payout"];
const SORT_KEYS = ["vol24", "change24h", "mcap", "curveProgress", "newest", "oldest"];
const PAYOUT_KEYS = ["ALL", "SINGLE", "BASKET"];
const STATUS_KEYS = ["ALL", "GRADUATED", "BONDING", "ABOUT_TO_GRADUATE", "UNKNOWN"];

// Accepts query strings (numbers arrive as text) and JSON numbers alike.
const positiveInt = (value, min, max) => {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) return positiveInt(Number(value), min, max);
  return null;
};

// Unknown query keys are ignored (platform gateways append opaque markers to
// SDK POSTs; rejecting them broke the live feed with constant 400s). Body keys
// must be allowlisted and every provided value is type/range checked before
// any cache or upstream work — no unvalidated value is ever consumed, so the
// endpoint can never become an arbitrary mint RPC proxy.
export async function parseFeedParams(req, url) {
  try {
    const raw = {};
    for (const [key, value] of url.searchParams) {
      if (PAGE_KEYS.includes(key) && !(key in raw)) raw[key] = value;
    }
    if (req.method === "POST") {
      const body = await readJsonBounded(req);
      assertKeys(body, PAGE_KEYS);
      Object.assign(raw, body);
    }
    const params = {};
    for (const key of PAGE_KEYS) {
      if (!(key in raw)) continue;
      const value = raw[key];
      if (key === "sort") {
        if (!SORT_KEYS.includes(value)) throw invalidParams();
        params.sort = value;
      } else if (key === "status") {
        if (!STATUS_KEYS.includes(value)) throw invalidParams();
        params.status = value;
      } else if (key === "search") {
        if (typeof value !== "string" || value.length > 64) throw invalidParams();
        const query = value.trim().toLowerCase();
        if (query) params.search = query;
      } else if (key === "pageSize") {
        const size = positiveInt(value, 1, 100);
        if (size === null) throw invalidParams();
        params.pageSize = size;
      } else if (key === "page") {
        const page = positiveInt(value, 1, 10_000);
        if (page === null) throw invalidParams();
        params.page = page;
      } else if (key === "payout") {
        if (!PAYOUT_KEYS.includes(value)) throw invalidParams();
        params.payout = value;
      } else {
        const hours = positiveInt(value, 1, 8760);
        if (hours === null) throw invalidParams();
        params.maxAgeHours = hours;
      }
    }
    return params;
  } catch (error) {
    // Ops telemetry for the query/body shape actually arriving from gateways.
    console.log(`[launcher-live] params rejected: ${req.method} ${url.href} :: ${error?.code ?? error?.status ?? error?.message}`);
    throw error;
  }
}

export function createLauncherLiveHandler({ rpc, deriveCurveAddress, fetchImpl = fetch,
  clock = Date.now, probeTimeoutMs = 9000, riskService, riskOptions, graduationStore,
  coinsArchive = null, freshPages = 0, createClient }) {
  // One handler/cache per isolate; no auth, entity reads, or client-selected mints.
  // The graduation ledger is the shared DB layer: visitor-confirmed migrations
  // persist globally, so GRADUATED statuses survive isolate restarts and are
  // served to every visitor without re-probing each time. The coins archive
  // layer (Supabase) restores the full launch history behind the active set.
  const { build, attachRisks } = createLauncherLiveBuilder({ rpc, deriveCurveAddress, fetchImpl, clock, probeTimeoutMs, riskService, riskOptions, graduationStore, coinsArchive, freshPages });
  let cached = null, inflight = null;

  const statusKey = (row) => ["GRADUATED", "BONDING", "ABOUT_TO_GRADUATE"].includes(row.status) ? row.status : "UNKNOWN";

  // Source-reported payout shape: BASKET = rotating multi-token reward,
  // SINGLE = one reward mint/symbol, NONE = no payout metadata.
  const payoutKey = (row) => {
    const p = row.payoutInfo;
    if (!p) return "NONE";
    if (Array.isArray(p.rewardBasket) && p.rewardBasket.length > 1) return "BASKET";
    return p.rewardMint || p.rewardSymbol ? "SINGLE" : "NONE";
  };

  // One projection per request: the legacy bounded roster when no feed params
  // are given, otherwise the FULL tape filtered, sorted and paged server-side.
  const respondBody = (cache, params, stale, sourceError) => {
    const forceStale = stale ? { ...cache.riskCoverage, forceStale: true } : cache.riskCoverage;
    if (!Object.keys(params).length) {
      const ranked = cache.legacyRanked.map((row) => ({ ...row }));
      return { at: cache.at, stale, ranked, riskCoverage: attachRisks(ranked, forceStale),
        statusCounts: cache.statusCounts, rosterTotal: cache.rosterTotal,
        candidateCount: cache.candidateCount, statusChecked: cache.statusChecked,
        statusError: cache.statusError, nearThreshold: NEAR_THRESHOLD,
        rewardSymbols: cache.rewardSymbols || {},
        pendingGraduation: cache.pendingGraduation,
        ...(sourceError ? { sourceError } : {}) };
    }
    let scoped = cache.rows;
    if (params.maxAgeHours != null) scoped = scoped.filter((row) => row.ageH != null && row.ageH <= params.maxAgeHours);
    if (params.search) scoped = scoped.filter((row) => `${row.symbol} ${row.name} ${row.mint}`.toLowerCase().includes(params.search));
    // Faceted counts over the current search/timeframe scope: each tab shows
    // how many launches it holds; ALL counts every launch in scope.
    const statusCounts = { ALL: scoped.length, GRADUATED: 0, BONDING: 0, ABOUT_TO_GRADUATE: 0, UNKNOWN: 0 };
    for (const row of scoped) statusCounts[statusKey(row)]++;
    if (params.status && params.status !== "ALL") scoped = scoped.filter((row) => statusKey(row) === params.status);
    if (params.payout === "SINGLE" || params.payout === "BASKET") scoped = scoped.filter((row) => payoutKey(row) === params.payout);
    // newest = smallest age first, oldest = largest age first; nulls last.
    const sortField = params.sort === "newest" || params.sort === "oldest" ? "ageH" : (params.sort || "vol24");
    const sorted = rankLauncherRows(scoped, sortField, params.sort === "newest");
    const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
    const pageCount = Math.max(1, Math.ceil(scoped.length / pageSize));
    // Pages past the end are clamped to the last page, never empty.
    const page = Math.min(params.page ?? 1, pageCount);
    const ranked = sorted.slice((page - 1) * pageSize, page * pageSize).map((row) => ({ ...row }));
    return { at: cache.at, stale, ranked, riskCoverage: attachRisks(ranked, forceStale),
      statusCounts, matches: scoped.length, page, pageCount, pageSize,
      rosterTotal: cache.rosterTotal, candidateCount: cache.candidateCount,
      statusChecked: cache.statusChecked, statusError: cache.statusError, nearThreshold: NEAR_THRESHOLD,
      rewardSymbols: cache.rewardSymbols || {},
      pendingGraduation: cache.pendingGraduation,
      ...(sourceError ? { sourceError } : {}) };
  };

  return async function (req) {
    const headers = responseHeaders(["GET", "POST"]);
    headers.set("Access-Control-Expose-Headers", "X-Launcher-Cache");
    const respond = (body, cache) => {
      headers.set("X-Launcher-Cache", cache);
      return Response.json(body, { headers });
    };
    try {
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
      if (!["GET", "POST"].includes(req.method)) {
        headers.set("Allow", "GET, POST, OPTIONS");
        throw new ApiError(405, "METHOD_NOT_ALLOWED", "Use GET or POST.");
      }
      // All params validate before any cache or upstream work (parseFeedParams).
      const params = await parseFeedParams(req, requestUrl(req));
      const cacheAge = cached ? clock() - cached.at : Infinity;
      if (cached && cacheAge >= 0 && cacheAge < FRESH_MS) {
        return respond(respondBody(cached, params, false), "hit");
      }
      if (!inflight) {
        const getClient = graduationStore && typeof createClient === "function" ? () => createClient(req) : null;
        inflight = build(getClient).then((body) => { cached = body; return body; })
          .finally(() => { inflight = null; });
      }
      try {
        return respond(respondBody(await inflight, params, false), "miss");
      } catch {
        // Recheck AFTER failure. A slow failed request must not extend the bound.
        const age = cached ? clock() - cached.at : Infinity;
        if (cached && age >= 0 && age <= MAX_AGE_MS) {
          return respond(respondBody(cached, params, true, "COINS_UNAVAILABLE"), "stale");
        }
        headers.set("X-Launcher-Cache", "error");
        throw new ApiError(502, "COINS_UNAVAILABLE", "Launcher coins are temporarily unavailable.");
      }
    } catch (error) { return errorResponse(error, headers); }
  };
}