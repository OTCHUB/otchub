// Launcher live-tape builder — shared by the getLauncherLive handler and the
// 5-min Supabase mirror push (shared/launcherFeed.ts → mirrorLauncherFeed).
// Owns the upstream roster fetch, the on-chain curve probes, the persisted
// graduation ledger, risk enrichment and the full-body projection. One
// instance per caller; the live handler and the mirror run the same build.

import { decodeLauncherCurve, hasConfirmedAmmPair, launcherStatus, NEAR_THRESHOLD } from "./launcherCurve.js";
import { createLauncherRiskService, emptyLauncherRisk } from "./launcherRisk.js";

const COINS_URL = "https://otcdesks.cash/api/coins";
const DEX_URL = "https://api.dexscreener.com/latest/dex/tokens/";

// Accepts query strings (numbers arrive as text) and JSON numbers alike.
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

export function createLauncherLiveBuilder({ rpc, deriveCurveAddress, fetchImpl = fetch,
  clock = Date.now, probeTimeoutMs = 9000, riskService, riskOptions, graduationStore }) {
  let activeRpc = 0;
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

  async function build(getClient) {
    const raw = await fetchJson(COINS_URL, 15_000);
    // Observation time, not a claim about the upstream snapshot's own update time.
    const at = clock(), rows = rosterRows(raw, at), errors = new Set();
    // Global graduation ledger: visitor-confirmed AMM migrations persisted in
    // the DB, shared by every isolate and visitor. Best-effort by design — an
    // unavailable ledger must never fail the live feed.
    let persisted = new Map();
    if (graduationStore) {
      try { persisted = await graduationStore.load(getClient); }
      catch { errors.add("GRADUATION_LEDGER_UNAVAILABLE"); }
    }
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
      const persistedGrad = persisted.get(c.row.mint);
      c.graduated = c.graduated || persistedGrad != null;
      c.row.status = launcherStatus(c.curve, c.graduated);
      // Known statuses carry the time of their supporting evidence, not a later
      // empty check. Unknown rows can still have a successful no-account check.
      if (c.graduated) c.row.statusAt = persistedGrad?.graduated_at ?? c.dexAt;
      else if (c.curve) c.row.statusAt = c.curveAt;
      else c.row.statusAt = c.curveAt === null ? c.dexAt : Math.max(c.curveAt, c.dexAt ?? c.curveAt);
    }
    // Ledger-backed roster rows outside the candidate set keep their persisted
    // GRADUATED status with no live probe: every ledger entry was verified
    // on-chain (curve complete) before it was written, so the status is sticky
    // even after the mint drops out of the probed candidate ranking.
    if (persisted.size) {
      const candidateMints = new Set(candidates.map((c) => c.row.mint));
      for (const row of rows) {
        if (candidateMints.has(row.mint)) continue;
        const persistedGrad = persisted.get(row.mint);
        if (!persistedGrad) continue;
        row.status = "GRADUATED";
        row.curveComplete = true;
        row.curveProgress = 100;
        row.statusAt = persistedGrad.graduated_at;
      }
      // FULL LAUNCH HISTORY: ledger graduations the current upstream roster no
      // longer lists (feed resets, curation, rotations) are still served as
      // verified historical launches. The on-chain curve-complete flag was
      // re-verified before the ledger write, so their GRADUATED status stays
      // authoritative — the tape can no longer be reset away upstream.
      const rosterMints = new Set(rows.map((row) => row.mint));
      for (const [mint, entry] of persisted) {
        if (rosterMints.has(mint)) continue;
        rows.push({
          mint, symbol: entry.symbol || "", name: entry.name || "",
          image: "", logoUrl: "", socials: sourceSocials({}), payoutInfo: null,
          vol24: null, mcap: null, liquidity: null, change24h: null,
          ageH: ageHours(entry.launched_at, at), metricsAt: null,
          curveProgress: 100, curveComplete: true,
          status: "GRADUATED", statusAt: entry.graduated_at,
          historical: true,
        });
      }
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
    // Completed-but-unconfirmed curves for the client to verify: DexScreener
    // rate-limits the shared function-runtime egress IP, so AMM-migration
    // evidence is confirmed from the visitor's own browser and reported once;
    // the persisted result is then global for every visitor.
    const pendingGraduation = graduationStore
      ? candidates.filter((c) => c.curve?.curveComplete === true && !c.graduated)
        .map((c) => c.row.mint).slice(0, 90)
      : [];
    return {
      at, rows, legacyRanked: rankLauncherRows(shipped, "vol24"), riskCoverage,
      statusCounts, rosterTotal: rows.length, pendingGraduation,
      candidateCount: candidates.length,
      statusChecked: candidates.filter((c) => c.curveAt !== null || c.dexAt !== null).length,
      statusError: errors.size ? [...errors].sort() : null, nearThreshold: NEAR_THRESHOLD,
    };
  }

  return { build, attachRisks, risks };
}