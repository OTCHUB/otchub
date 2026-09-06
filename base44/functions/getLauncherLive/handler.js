import { ApiError, errorResponse, requestParams, requestUrl, responseHeaders } from "../../shared/apiHttp.js";
import { decodeLauncherCurve, hasConfirmedAmmPair, launcherStatus, NEAR_THRESHOLD } from "../../shared/launcherCurve.js";

const COINS_URL = "https://otcdesks.cash/api/coins";
const DEX_URL = "https://api.dexscreener.com/latest/dex/tokens/";
const FRESH_MS = 30_000, MAX_AGE_MS = 120_000;
const numeric = (v) => Number.isFinite(v) ? v : null;
const nonnegative = (v) => Number.isFinite(v) && v >= 0 ? v : null;
const text = (v) => typeof v === "string" ? v.trim() : "";

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

function imageUrl(value) {
  try {
    const url = new URL(text(value));
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

function rosterRows(raw, at) {
  const coins = Array.isArray(raw) ? raw : raw?.coins ?? raw?.data ?? raw?.tokens;
  if (!Array.isArray(coins)) throw new Error("COINS_UNAVAILABLE");
  const seen = new Set(), rows = [];
  for (const coin of coins) {
    const mint = text(coin?.mint);
    if (!mint || seen.has(mint)) continue;
    seen.add(mint);
    const snapshot = coin?.snapshot;
    rows.push({
      mint, symbol: text(coin.symbol), name: text(coin.name), image: imageUrl(coin.image),
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
  clock = Date.now, probeTimeoutMs = 9000 }) {
  let cached = null, inflight = null, activeRpc = 0;

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
          }
        } catch { errors.add("DEXSCREENER_UNAVAILABLE"); }
      });
    }
    await runBounded(tasks);
    for (const c of candidates) {
      if (c.curve) Object.assign(c.row, c.curve);
      c.row.status = launcherStatus(c.curve, c.graduated);
      // Known statuses carry the time of their supporting evidence, not a later
      // empty check. Unknown rows can still have a successful no-account check.
      if (c.graduated) c.row.statusAt = c.dexAt;
      else if (c.curve) c.row.statusAt = c.curveAt;
      else c.row.statusAt = c.curveAt === null ? c.dexAt : Math.max(c.curveAt, c.dexAt ?? c.curveAt);
    }
    return {
      at, stale: false, ranked: rankLauncherRows(rows, "vol24"),
      candidateCount: candidates.length,
      statusChecked: candidates.filter((c) => c.curveAt !== null || c.dexAt !== null).length,
      statusError: errors.size ? [...errors].sort() : null, nearThreshold: NEAR_THRESHOLD,
    };
  }

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
      // Empty parameters only, including SDK POST {}. Never become an arbitrary
      // mint RPC proxy; reject params even on a warm cache without upstream work.
      await requestParams(req, requestUrl(req), []);
      const cacheAge = cached ? clock() - cached.at : Infinity;
      if (cached && cacheAge >= 0 && cacheAge < FRESH_MS) return respond(cached, "hit");
      if (!inflight) {
        inflight = build().then((body) => { cached = body; return body; })
          .finally(() => { inflight = null; });
      }
      try { return respond(await inflight, "miss"); }
      catch {
        // Recheck AFTER failure. A slow failed request must not extend the bound.
        const age = cached ? clock() - cached.at : Infinity;
        if (cached && age >= 0 && age <= MAX_AGE_MS) {
          return respond({ ...cached, stale: true, sourceError: "COINS_UNAVAILABLE" }, "stale");
        }
        headers.set("X-Launcher-Cache", "error");
        throw new ApiError(502, "COINS_UNAVAILABLE", "Launcher coins are temporarily unavailable.");
      }
    } catch (error) { return errorResponse(error, headers); }
  };
}