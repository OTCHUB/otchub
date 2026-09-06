// Public GET contract reviewed 2026-09-06; no history, bulk, auth or reporting POSTs.
const ORIGIN = "https://api.rugcheck.xyz";
const FRESH_MS = 300_000, STALE_MS = 1_800_000, RETRY_MS = 60_000, WINDOW_MS = 30_000;
const MAX_BYTES = 524_288, MAX_FACTORS = 64, MAX_EVIDENCE = 16;
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const LAUNCHER_RISK_REFERENCES = Object.freeze([
  Object.freeze({ mint: "6sPYBcVxbudw4V2bgDrGvtAQ38mccTtcVUasEDhZ78qt", label: "ETF", outcome: "MALICIOUS_REPORTED" }),
  Object.freeze({ mint: "ANM35KbUcfKdEVBXzSjZBoT6ceSwYRs3fuc79fp7kRqP", label: "pumpcat", outcome: "SUCCESS_REPORTED" }),
]);
const referenceMints = new Set(LAUNCHER_RISK_REFERENCES.map((r) => r.mint));
const finite = (value) => Number.isFinite(value) ? value : null;
const boundedText = (value, max) => typeof value === "string"
  ? value.slice(0, max).replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const timestamp = (value) => Number.isSafeInteger(value) && value >= 0;
const age = (at, now) => timestamp(at) && timestamp(now) && now >= at ? now - at : Infinity;
const cap = (value, fallback, max, min = 1) => Number.isFinite(value)
  ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;

// Canonical 32-byte base58, not just a URL-safe regular expression. No SDK needed.
export function isLauncherRiskMint(value) {
  if (typeof value !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  let n = 0n, bytes = 0;
  for (const char of value) n = n * 58n + BigInt(BASE58.indexOf(char));
  while (n > 0n) { bytes++; n >>= 8n; }
  return bytes + (value.match(/^1*/)?.[0].length || 0) === 32;
}

export function emptyLauncherRisk(state = "NOT_CHECKED", error = null) {
  return { state, checkedAt: null, reportedAt: null, score: null, scoreNormalised: null,
    level: "UNKNOWN", factors: [], rugged: null, deployer: null, top15Pct: null,
    holderSampleSize: 0, holderConcentrationHigh: null, highRisk: null,
    reputation: { status: "UNKNOWN", evidence: [] }, error };
}

class RiskFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = (code) => { throw new RiskFailure(code); };
function factorLevel(value) {
  switch (typeof value === "string" ? value.toLowerCase() : "") {
    case "danger": return "DANGER";
    case "warn": case "warning": return "WARNING";
    case "info": return "INFO";
    default: return "UNKNOWN";
  }
}

function holders(report) {
  const unknown = { top15Pct: null, holderSampleSize: 0, holderConcentrationHigh: null };
  if (!Array.isArray(report.topHolders) || report.topHolders.length > 100) return unknown;
  const accounts = new Map();
  for (const holder of report.topHolders) {
    if (!object(holder) || !isLauncherRiskMint(holder.address) || !isLauncherRiskMint(holder.owner)
      || !Number.isFinite(holder.pct) || holder.pct < 0 || holder.pct > 100) return unknown;
    const previous = accounts.get(holder.address);
    if (previous && (previous.owner !== holder.owner || previous.pct !== holder.pct)) return unknown;
    accounts.set(holder.address, { owner: holder.owner, pct: holder.pct });
  }
  const sorted = [...accounts.values()].map((h) => h.pct).sort((a, b) => b - a);
  const sum = sorted.reduce((a, b) => a + b, 0), count = sorted.length;
  const total = Number.isSafeInteger(report.totalHolders) && report.totalHolders >= 0 ? report.totalHolders : null;
  if (!Number.isFinite(sum) || sum > 100 || (total === 0 && count > 0)) return unknown;
  // Empty/missing samples are never evidence of low concentration. A short sample
  // is usable only when all available holders are covered by the unique sample.
  if (!count || (count < 15 && (total === null || total > count))) return { ...unknown, holderSampleSize: count };
  const top15Pct = sorted.slice(0, 15).reduce((a, b) => a + b, 0);
  return { top15Pct, holderSampleSize: count, holderConcentrationHigh: top15Pct > 35 };
}

export function normalizeLauncherRiskReport(report, mint, checkedAt) {
  if (!timestamp(checkedAt) || !isLauncherRiskMint(mint) || !object(report) || report.mint !== mint
    || Object.hasOwn(report, "error") || Object.hasOwn(report, "errors") || Object.hasOwn(report, "message")
    || report.success === false || report.ok === false || ["error", "failed", "fail"].includes(report.status)
    || (Number.isFinite(report.status) && report.status >= 400)
    || typeof report.rugged !== "boolean" || !Number.isFinite(report.score)
    || (report.risks != null && !Array.isArray(report.risks))
    || (Array.isArray(report.risks) && report.risks.length > MAX_FACTORS)) fail("INVALID_REPORT");
  const factors = (report.risks || []).map((risk) => ({
    name: boundedText(risk?.name, 128), description: boundedText(risk?.description, 1024),
    value: typeof risk?.value === "string" ? boundedText(risk.value, 256)
      : typeof risk?.value === "boolean" ? risk.value : finite(risk?.value),
    level: factorLevel(risk?.level), score: finite(risk?.score),
  }));
  const scoreNormalised = Number.isFinite(report.score_normalised)
    && report.score_normalised >= 0 && report.score_normalised <= 100 ? report.score_normalised : null;
  // >=50 is our local normalized-score policy. Raw score has NO local threshold.
  const level = report.rugged || factors.some((r) => r.level === "DANGER")
    || (scoreNormalised !== null && scoreNormalised >= 50) ? "DANGER"
    : factors.some((r) => r.level === "WARNING") ? "WARNING"
      : Array.isArray(report.risks) && factors.every((r) => r.level === "INFO") ? "NONE" : "UNKNOWN";
  const detected = typeof report.detectedAt === "string" && report.detectedAt.length <= 64
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(report.detectedAt)
    ? Date.parse(report.detectedAt) : NaN;
  const risk = { ...emptyLauncherRisk("READY"), checkedAt,
    reportedAt: timestamp(detected) && detected <= checkedAt ? detected : null,
    score: report.score, scoreNormalised, rugged: report.rugged, level, factors,
    deployer: isLauncherRiskMint(report.creator) ? report.creator : null, ...holders(report) };
  risk.highRisk = highRisk(risk);
  return risk;
}

function highRisk(risk) {
  if (["DANGER", "WARNING"].includes(risk.level) || risk.holderConcentrationHigh === true
    || risk.reputation.status === "MALICIOUS_REPORTED") return true;
  return risk.state === "READY" && risk.level !== "UNKNOWN" && risk.top15Pct !== null ? false : null;
}

async function readReport(response, guard) {
  const size = response.headers?.get("content-length");
  if (size && /^\d+$/.test(size) && Number(size) > MAX_BYTES) fail("PAYLOAD_TOO_LARGE");
  if (!response.body?.getReader) fail("INVALID_REPORT");
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let length = 0, text = "";
  try {
    while (true) {
      guard();
      const { done, value } = await reader.read();
      guard();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) fail("PAYLOAD_TOO_LARGE");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    guard();
    let report;
    try { report = JSON.parse(text); } catch { fail("INVALID_REPORT"); }
    guard();
    return report;
  } finally { reader.releaseLock(); }
}

function retryAfter(value, now) {
  let until = now + RETRY_MS;
  if (typeof value !== "string" || value.length > 128) return until;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const delay = BigInt(trimmed) * 1000n + BigInt(now);
    until = Math.max(until, Number(delay > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : delay));
  } else {
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) until = Math.max(until, parsed);
  }
  return until;
}

export function createLauncherRiskService({ fetchImpl = fetch, clock = Date.now,
  monotonicClock = () => performance.now(), budgetMs = 2500, timeoutMs = 2500,
  maxRequests = 12, concurrency = 2, maxEntries = 512 } = {}) {
  // Injection may LOWER limits for tests, never increase production ceilings.
  const budget = cap(budgetMs, 2500, 2500), timeout = cap(timeoutMs, 2500, 2500);
  const requestLimit = cap(maxRequests, 12, 12, 0), slots = cap(concurrency, 2, 2);
  const capacity = cap(maxEntries, 512, 512, 2), cache = new Map(), active = new Set();
  let starts = [], cooldownUntil = 0, cursor = 0, lastClock = null, epoch = 0, inflight = null;

  function observe() {
    const now = clock();
    if (!timestamp(now)) { cache.clear(); epoch++; return null; }
    if (lastClock !== null && now < lastClock) {
      // Invalidate future evidence and all outstanding writes. Preserve pressure
      // limits after rollback, rather than treating a backwards jump as expiry.
      cache.clear(); epoch++;
      starts = starts.map(() => now);
      cooldownUntil = now + Math.max(RETRY_MS, cooldownUntil - lastClock);
    }
    lastClock = now;
    starts = starts.filter((at) => age(at, now) < WINDOW_MS);
    for (const [mint, entry] of cache) {
      if (age(entry.attemptAt, now) > STALE_MS) cache.delete(mint);
    }
    return now;
  }

  function store(mint, entry) {
    cache.delete(mint);
    cache.set(mint, entry);
    while (cache.size > capacity) {
      const evict = [...cache.keys()].find((key) => !referenceMints.has(key)) || cache.keys().next().value;
      cache.delete(evict);
    }
  }

  const fresh = (entry, now) => entry?.data && !entry.error && age(entry.data.checkedAt, now) < FRESH_MS;
  const due = (mint, now) => {
    const entry = cache.get(mint);
    return !active.has(mint) && !fresh(entry, now) && (!entry || entry.retryAt <= now);
  };

  function plan(rows, priority, now) {
    // Stable mint order keeps API/ranking reorderings from resetting fair rotation.
    const roster = [...new Set(rows.map((r) => r.mint).filter(isLauncherRiskMint))].sort();
    if (!roster.length) return [];
    const rosterSet = new Set(roster), selected = new Set(), queue = [];
    const add = (mint, nextCursor) => {
      if (!selected.has(mint) && due(mint, now)) {
        selected.add(mint); queue.push({ mint, nextCursor }); return true;
      }
      return false;
    };
    const available = Math.max(0, requestLimit - starts.length);
    for (const ref of LAUNCHER_RISK_REFERENCES) {
      if (queue.length < available) add(ref.mint);
    }
    const remaining = available - queue.length;
    const preferred = priority.map((r) => r.mint).filter((mint) => rosterSet.has(mint));
    let p = 0, scanned = 0, preferredAdded = 0;
    // Alternate preferred and reserved full-roster slots. Advance the persistent
    // rotor only when a rotating request actually starts (not when merely queued).
    while (queue.length < available && (p < preferred.length || scanned < roster.length)) {
      if (preferredAdded < Math.ceil(remaining / 2)) {
        while (p < preferred.length) {
          if (add(preferred[p++])) { preferredAdded++; break; }
        }
      } else p = preferred.length;
      while (queue.length < available && scanned < roster.length) {
        const index = (cursor + scanned++) % roster.length;
        if (add(roster[index], (index + 1) % roster.length)) break;
      }
    }
    return queue;
  }

  async function fetchOne(mint, stageEnd) {
    const startedAt = observe();
    if (startedAt === null || startedAt < cooldownUntil || starts.length >= requestLimit
      || active.size >= slots || active.has(mint) || monotonicClock() >= stageEnd) return false;
    const generation = epoch, controller = new AbortController();
    const end = Math.min(stageEnd, monotonicClock() + timeout);
    let expired = false, timer;
    const guard = () => {
      if (expired || generation !== epoch || monotonicClock() >= end) fail("TIMEOUT");
    };
    starts.push(startedAt); active.add(mint);
    // Slot covers fetch AND body processing. Abort-ignoring work retains its slot
    // until settlement; late work cannot commit data or change global cooldown.
    const pending = Promise.resolve().then(async () => {
      guard();
      const response = await fetchImpl(`${ORIGIN}/v1/tokens/${mint}/report`, {
        method: "GET", redirect: "error", credentials: "omit", signal: controller.signal,
      });
      guard();
      if (response.status === 429) {
        const now = observe();
        guard();
        if (now === null) fail("CLOCK_INVALID");
        cooldownUntil = Math.max(cooldownUntil, retryAfter(response.headers?.get("retry-after"), now));
        fail("RATE_LIMITED");
      }
      if (!response.ok) fail(response.status === 403 ? "FORBIDDEN" : response.status === 404
        ? "NOT_FOUND" : response.status >= 500 ? "UPSTREAM_UNAVAILABLE" : "HTTP_ERROR");
      const report = await readReport(response, guard);
      const now = observe();
      guard();
      if (now === null) fail("CLOCK_INVALID");
      const data = normalizeLauncherRiskReport(report, mint, now);
      guard();
      return data;
    }).finally(() => { active.delete(mint); });
    try {
      const data = await Promise.race([pending, new Promise((_, reject) => {
        timer = setTimeout(() => {
          expired = true; controller.abort(); reject(new RiskFailure("TIMEOUT"));
        }, Math.max(0, end - monotonicClock()));
      })]);
      guard();
      const previous = cache.get(mint);
      store(mint, { data, attemptAt: data.checkedAt, retryAt: 0, error: null,
        negatives: previous?.data?.deployer === data.deployer ? previous.negatives : [] });
    } catch (error) {
      const now = observe();
      if (generation === epoch && now !== null) {
        const previous = cache.get(mint), code = error instanceof RiskFailure ? error.code : "NETWORK_ERROR";
        store(mint, { data: previous?.data || null, negatives: previous?.negatives || [],
          attemptAt: now, retryAt: Math.max(now + RETRY_MS, code === "RATE_LIMITED" ? cooldownUntil : 0), error: code });
      }
    } finally { expired = true; clearTimeout(timer); controller.abort(); }
    return true;
  }

  function reputationIndex(now) {
    const index = new Map();
    const add = (creator, evidence) => {
      if (!creator) return;
      const entries = index.get(creator) || [];
      // References first, then warm-cache reports. Negative evidence can displace
      // positives at the bound, so a long history cannot hide a negative result.
      entries.push(evidence);
      entries.sort((a, b) => Number(b.outcome === "MALICIOUS_REPORTED") - Number(a.outcome === "MALICIOUS_REPORTED"));
      index.set(creator, entries.slice(0, MAX_EVIDENCE));
    };
    for (const ref of LAUNCHER_RISK_REFERENCES) {
      const entry = cache.get(ref.mint);
      if (fresh(entry, now)) add(entry.data.deployer, { ...ref, source: "USER_REFERENCE", checkedAt: entry.data.checkedAt });
    }
    for (const [mint, entry] of cache) {
      if (fresh(entry, now) && entry.data.rugged === true) add(entry.data.deployer, {
        mint, label: "RugCheck rugged report", outcome: "MALICIOUS_REPORTED", source: "RUGCHECK_RUGGED",
        checkedAt: entry.data.checkedAt,
      });
    }
    return index;
  }

  function attach(rows, { requested = 0, limited = false, forceStale = false } = {}) {
    const now = observe(), index = now === null ? new Map() : reputationIndex(now);
    const coverage = { total: rows.length, checked: 0, stale: 0, unavailable: 0, notChecked: 0,
      requested, limited, nextRetryAt: null };
    for (const row of rows) {
      let risk = emptyLauncherRisk();
      const valid = isLauncherRiskMint(row.mint), entry = cache.get(row.mint);
      if (now === null || !valid) risk = emptyLauncherRisk("UNAVAILABLE", valid ? "CLOCK_INVALID" : "INVALID_MINT");
      else if (entry?.data && age(entry.data.checkedAt, now) <= STALE_MS) {
        risk = { ...entry.data, factors: entry.data.factors.map((f) => ({ ...f })),
          state: fresh(entry, now) && !forceStale ? "READY" : "STALE",
          error: entry.error || (forceStale ? "FEED_STALE" : fresh(entry, now) ? null : "STALE_REPORT") };
        const evidence = index.get(risk.deployer) || [];
        const negative = evidence.filter((e) => e.outcome === "MALICIOUS_REPORTED");
        // Retain previously observed negatives only for this same cached creator;
        // expired/error seeds cannot propagate to a newly observed creator match.
        const remembered = entry.negatives.filter((e) => age(e.checkedAt, now) <= STALE_MS);
        const merged = [...new Map([...remembered, ...negative].map((e) => [`${e.source}:${e.mint}`, e])).values()];
        entry.negatives = merged.sort((a, b) => b.checkedAt - a.checkedAt).slice(0, MAX_EVIDENCE);
        const staleEvidence = entry.negatives.some((e) => !negative.some((n) => n.source === e.source
          && n.mint === e.mint && n.checkedAt === e.checkedAt));
        if (staleEvidence) { risk.state = "STALE"; risk.error ||= "STALE_EVIDENCE"; }
        const chosen = entry.negatives.length ? entry.negatives : risk.state === "READY" ? evidence : [];
        risk.reputation = { status: chosen.length ? chosen[0].outcome : "UNKNOWN", evidence: chosen.map((e) => ({ ...e })) };
        risk.highRisk = highRisk(risk);
      } else if (entry) risk = emptyLauncherRisk("UNAVAILABLE", entry.error || "STALE_EXPIRED");
      row.risk = risk;
      coverage[{ READY: "checked", STALE: "stale", UNAVAILABLE: "unavailable", NOT_CHECKED: "notChecked" }[risk.state]]++;
    }
    if (now !== null) {
      const retryTimes = [...cache.values()].filter((e) => e.retryAt > now).map((e) => e.retryAt);
      if (starts.length >= requestLimit && starts.length) retryTimes.push(starts[0] + WINDOW_MS);
      if (retryTimes.length) coverage.nextRetryAt = Math.min(...retryTimes);
      if (cooldownUntil > now) coverage.nextRetryAt = Math.max(coverage.nextRetryAt || 0, cooldownUntil);
      coverage.limited ||= rows.some((r) => isLauncherRiskMint(r.mint) && due(r.mint, now));
    }
    return coverage;
  }

  async function enrich(rows, priority = rows) {
    if (!inflight) {
      inflight = (async () => {
        const now = observe(), end = monotonicClock() + budget;
        if (now === null || now < cooldownUntil) return 0;
        const queue = plan(rows, priority, now);
        let next = 0, requested = 0;
        await Promise.all(Array.from({ length: slots }, async () => {
          while (next < queue.length && monotonicClock() < end) {
            const item = queue[next++];
            const pending = fetchOne(item.mint, end);
            if (active.has(item.mint) && item.nextCursor !== undefined) cursor = item.nextCursor;
            if (!await pending) break;
            requested++;
          }
        }));
        return requested;
      })().finally(() => { inflight = null; });
    }
    const requested = await inflight;
    return attach(rows, { requested });
  }

  return { enrich, attach, inspect: () => ({ cacheSize: cache.size, activeRequests: active.size,
    rollingStarts: starts.length, cooldownUntil }) };
}