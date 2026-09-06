import { ApiError, assertKeys, errorResponse, invalidParams, readJsonBounded, requestUrl, responseHeaders } from "../../shared/apiHttp.js";
import { decodeLauncherCurve, hasConfirmedAmmPair, launcherStatus, NEAR_THRESHOLD } from "../../shared/launcherCurve.js";
import { createLauncherRiskService, emptyLauncherRisk } from "../../shared/launcherRisk.js";

const COINS_URL = "https://otcdesks.cash/api/coins";
const DEX_URL = "https://api.dexscreener.com/latest/dex/tokens/";
const FRESH_MS = 30_000, MAX_AGE_MS = 120_000;
const DEFAULT_PAGE_SIZE = 50;
// Full-tape params. Any present param switches the response from the legacy
// bounded roster to a server-filtered/paged view of the ENTIRE roster.
const PAGE_KEYS = ["page", "pageSize", "sort", "status", "search", "maxAgeHours"];
const SORT_KEYS = ["vol24", "change24h", "mcap", "curveProgress"];
const STATUS_KEYS = ["ALL", "GRADUATED", "BONDING", "ABOUT_TO_GRADUATE", "UNKNOWN"];

// Accepts query strings (numbers arrive as text) and JSON numbers alike.
const positiveInt = (value, min, max) => {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) return positiveInt(Number(value), min, max);
  return null;
};
const numeric = (v) => Number.isFinite(v) ? v : null;
const nonnegative = (v) => Number.isFinite(v) && v >= 0 ? v : null;
const text = (v) => typeof v === "string" ? v.trim() : "";
const SOCIAL_KEYS = ["twitter", "telegram", "website"];
const reportedMint = (v) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text(v)) ? text(v) : null;

// Stable, finite-only, null-last comparison, including all-negative momentum.
export function rankLauncherRows(rows, key, ascending = false) {
  return [...rows].sort((a, b) => {
    const av = numeric(a[key]), bv = numeric(b[key]);
    if (av === null) return bv === null ? 0 : 1;
    if (bv === null) return -1;
    if (av === bv) return 0;
    return (av < bv ? -1 : 1) * (ascending ? 1 : -1);
  });
}

function ageHours(createdAt, at) {
  if (!Number.isFinite(createdAt) || createdAt <= 0) return null;
  const ms = createdAt < 1e12 ? createdAt * 1000 : createdAt;
  return ms <= at ? nonnegative((at - ms) / 3_600_000) : null;
}

function sourceTime(value, at) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const ms = value < 1e12 ? value * 1000 : value;
  return ms <= at ? ms : null;
}

function httpUrl(value) {
  try {
    const url = new URL(text(value));
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

function sourceSocials(coin) {
  const nested = coin.socials && typeof coin.socials === "object" && !Array.isArray(coin.socials) ? coin.socials : {};
  return Object.fromEntries(SOCIAL_KEYS.map((key) => [key, httpUrl(nested[key]) || httpUrl(coin[key])]));
}

function payoutInfo(coin) {
  const rewardMint = reportedMint(coin.rewardMint), rewardSymbol = text(coin.rewardSymbol) || null;
  const rewardCycle = Number.isSafeInteger(coin.rewardCycle) && coin.rewardCycle >= 0 ? coin.rewardCycle : null;
  const rewardBasket = [...new Set((Array.isArray(coin.rewardBasket) ? coin.rewardBasket : [])
    .map(reportedMint).filter(Boolean))];
  // These are source-reported settings, not verified distributions or a schedule.
  return rewardMint !== null || rewardSymbol !== null || rewardCycle !== null || rewardBasket.length
    ? { rewardMint, rewardSymbol, rewardCycle, rewardBasket } : null;
}

function dexMetadata(pair) {
  const info = pair.info, links = Array.isArray(info?.socials) ? info.socials : [];
  const websites = Array.isArray(info?.websites) ? info.websites : [];
  const firstUrl = (entries) => entries.map((entry) => httpUrl(entry?.url)).filter(Boolean).sort()[0] || "";
  const socials = Object.fromEntries(SOCIAL_KEYS.map((key) => [key, firstUrl(key === "website"
    ? websites : links.filter((entry) => text(entry?.type).toLowerCase() === key))]));
  const logoUrl = httpUrl(info?.imageUrl);
  // A total, locale-independent tie break makes fallback independent of API order,
  // including duplicate/missing pair addresses and duplicate social entries.
  const key = JSON.stringify([text(pair.pairAddress), logoUrl, ...SOCIAL_KEYS.map((name) => socials[name])]);
  return { liquidity: numeric(pair.liquidity?.usd), key, logoUrl, socials };
}

function fillDexMetadata(row, pairs) {
  // DEX info belongs to the BASE token, unlike the base-or-quote status check.
  const matching = pairs.filter((pair) => pair?.chainId === "solana" && pair.baseToken?.address === row.mint)
    .map(dexMetadata).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  for (const metadata of rankLauncherRows(matching, "liquidity")) {
    row.logoUrl ||= metadata.logoUrl;
    for (const key of SOCIAL_KEYS) row.socials[key] ||= metadata.socials[key];
  }
}

function rosterRows(raw, at) {
  const coins = Array.isArray(raw) ? raw : raw?.coins ?? raw?.data ?? raw?.tokens;
  if (!Array.isArray(coins)) throw new Error("COINS_UNAVAILABLE");
  const seen = new Set(), rows = [];
  for (const coin of coins) {
    const mint = text(coin?.mint);
    if (!mint || seen.has(mint)) continue;
    seen.add(mint);
    const snapshot = coin?.snapshot, image = httpUrl(coin.image);
    rows.push({
      mint, symbol: text(coin.symbol), name: text(coin.name), image,
      logoUrl: image, socials: sourceSocials(coin), payoutInfo: payoutInfo(coin),
      vol24: nonnegative(snapshot?.volume24h), mcap: nonnegative(snapshot?.marketCap),
      liquidity: nonnegative(snapshot?.liquidity), change24h: numeric(snapshot?.change24h),
      ageH: ageHours(coin.createdAt, at), metricsAt: sourceTime(snapshot?.at, at),
      curveProgress: null, status: "UNKNOWN", curveComplete: null, statusAt: null,
    });
  }
  if (coins.length && !rows.length) throw new Error("COINS_UNAVAILABLE");
  return rows;
}

export function launcherCandidates(rows) {
  const union = [
    ...rankLauncherRows(rows, "vol24").slice(0, 60),
    ...rankLauncherRows(rows, "change24h").slice(0, 60),
    ...rankLauncherRows(rows, "ageH", true).slice(0, 30),
  ];
  return [...new Map(union.map((row) => [row.mint, row])).values()].slice(0, 150);
}

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

async function withDeadline(task, ms) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => task(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("UPSTREAM_TIMEOUT")); }, ms);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

async function runBounded(tasks) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, tasks.length) }, async () => {
    while (next < tasks.length) await tasks[next++]();
  }));
}

export function createLauncherLiveHandler({ rpc, deriveCurveAddress, fetchImpl = fetch,
  clock = Date.now, probeTimeoutMs = 9000, riskService, riskOptions }) {
  let cached = null, inflight = null, activeRpc = 0;
  const risks = riskService ?? createLauncherRiskService({ ...riskOptions, fetchImpl, clock });

  // The risk stage is best-effort enrichment: a failing or throwing risk service
  // must never empty the feed. Degrade to explicit NOT_CHECKED rows instead.
  const enrichRisks = (rows, priority) => Promise.resolve()
    .then(() => risks.enrich(rows, priority)).catch(() => undefined);
  function attachRisks(rows, coverage) {
    try { return risks.attach(rows, coverage); }
    catch {
      for (const row of rows) row.risk ||= emptyLauncherRisk();
      return { total: rows.length, checked: 0, stale: 0, unavailable: 0,
        notChecked: rows.length, requested: 0, limited: false, nextRetryAt: null };
    }
  }

  const fetchJson = (url, timeoutMs) => withDeadline(async (signal) => {
    const res = await fetchImpl(url, { signal });
    if (!res.ok) throw new Error("UPSTREAM_UNAVAILABLE");
    return res.json();
  }, timeoutMs);

  async function readAccounts(addresses) {
    // heliusRpc has no AbortSignal argument. Timed-out calls retain their slot
    // until settled, so repeated refreshes cannot accumulate unbounded RPCs.
    if (activeRpc >= 2 || typeof rpc !== "function") throw new Error("CURVE_RPC_UNAVAILABLE");
    activeRpc++;
    const pending = Promise.resolve().then(() => rpc("getMultipleAccounts", [addresses, {
      encoding: "base64", commitment: "confirmed", dataSlice: { offset: 0, length: 49 },
    }])).finally(() => { activeRpc--; });
    return withDeadline(() => pending, probeTimeoutMs);
  }

  async function build() {
    const raw = await fetchJson(COINS_URL, 15_000);
    // Observation time, not a claim about the upstream snapshot's own update time.
    const at = clock(), rows = rosterRows(raw, at), errors = new Set();
    const candidates = launcherCandidates(rows).map((row) => ({
      row, address: null, curve: null, curveAt: null, dexAt: null, graduated: false,
    }));
    for (const candidate of candidates) {
      try { candidate.address = deriveCurveAddress(candidate.row.mint); }
      catch { errors.add("INVALID_MINT"); }
    }
    const valid = candidates.filter((c) => c.address), tasks = [];
    for (let i = 0; i < valid.length; i += 100) {
      const chunk = valid.slice(i, i + 100);
      tasks.push(async () => {
        try {
          const result = await readAccounts(chunk.map((c) => c.address));
          if (!Array.isArray(result?.value) || result.value.length !== chunk.length) throw new Error();
          const checkedAt = clock();
          chunk.forEach((c, index) => {
            try {
              c.curve = decodeLauncherCurve(result.value[index]);
              c.curveAt = checkedAt;
              if (c.curve && c.curve.curveProgress === null) errors.add("CURVE_RESERVES_INVALID");
            } catch { errors.add("CURVE_ACCOUNT_INVALID"); }
          });
        } catch { errors.add("CURVE_RPC_UNAVAILABLE"); }
      });
    }
    for (let i = 0; i < valid.length; i += 30) {
      const chunk = valid.slice(i, i + 30);
      tasks.push(async () => {
        try {
          const data = await fetchJson(DEX_URL + chunk.map((c) => c.row.mint).join(","), probeTimeoutMs);
          if (!Array.isArray(data?.pairs) && data?.pairs !== null) throw new Error();
          const checkedAt = clock();
          for (const c of chunk) {
            c.graduated = hasConfirmedAmmPair(c.row.mint, data.pairs || []);
            c.dexAt = checkedAt;
            fillDexMetadata(c.row, data.pairs || []);
          }
        } catch { errors.add("DEXSCREENER_UNAVAILABLE"); }
      });
    }
    // Await the bounded risk stage alongside existing probes, never after them.
    const [, enrichmentCoverage] = await Promise.all([
      runBounded(tasks), enrichRisks(rows, candidates.map((c) => c.row)),
    ]);
    // Probes may outlast risk enrichment. Re-project freshness at response time.
    const riskCoverage = attachRisks(rows, enrichmentCoverage);
    for (const c of candidates) {
      if (c.curve) Object.assign(c.row, c.curve);
      c.row.status = launcherStatus(c.curve, c.graduated);
      // Known statuses carry the time of their supporting evidence, not a later
      // empty check. Unknown rows can still have a successful no-account check.
      if (c.graduated) c.row.statusAt = c.dexAt;
      else if (c.curve) c.row.statusAt = c.curveAt;
      else c.row.statusAt = c.curveAt === null ? c.dexAt : Math.max(c.curveAt, c.dexAt ?? c.curveAt);
    }
    // The full roster is ~3000 launches (~3.5MB JSON) — far too large for a
    // 30s poll (client delivery failures). Ship a bounded roster: every
    // status-checked candidate plus top-mcap rows (MARKET_CAP rank mode), and
    // exact full-roster status counts so the client's tabs stay true counts.
    const shipped = candidates.map((c) => c.row);
    for (const row of rankLauncherRows(rows, "mcap").slice(0, 60)) {
      if (!shipped.includes(row)) shipped.push(row);
    }
    const statusCounts = { ALL: rows.length };
    for (const row of rows) {
      const s = ["GRADUATED", "BONDING", "ABOUT_TO_GRADUATE"].includes(row.status) ? row.status : "UNKNOWN";
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    }
    return {
      at, rows, legacyRanked: rankLauncherRows(shipped, "vol24"), riskCoverage,
      statusCounts, rosterTotal: rows.length,
      candidateCount: candidates.length,
      statusChecked: candidates.filter((c) => c.curveAt !== null || c.dexAt !== null).length,
      statusError: errors.size ? [...errors].sort() : null, nearThreshold: NEAR_THRESHOLD,
    };
  }

  const statusKey = (row) => ["GRADUATED", "BONDING", "ABOUT_TO_GRADUATE"].includes(row.status) ? row.status : "UNKNOWN";

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
    const sorted = rankLauncherRows(scoped, params.sort || "vol24");
    const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
    const pageCount = Math.max(1, Math.ceil(scoped.length / pageSize));
    // Pages past the end are clamped to the last page, never empty.
    const page = Math.min(params.page ?? 1, pageCount);
    const ranked = sorted.slice((page - 1) * pageSize, page * pageSize).map((row) => ({ ...row }));
    return { at: cache.at, stale, ranked, riskCoverage: attachRisks(ranked, forceStale),
      statusCounts, matches: scoped.length, page, pageCount, pageSize,
      rosterTotal: cache.rosterTotal, candidateCount: cache.candidateCount,
      statusChecked: cache.statusChecked, statusError: cache.statusError, nearThreshold: NEAR_THRESHOLD,
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
        inflight = build().then((body) => { cached = body; return body; })
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