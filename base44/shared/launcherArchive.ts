// Persistent launcher coins archive — FULL LAUNCH HISTORY.
// The upstream coins API returns only a small active/featured set on the bare
// endpoint; the full launch DB (~9k launches) is only reachable through the
// paginated ?page=N endpoint (12 per page, newest-first). This module sweeps
// those pages, keeps a mint-deduped archive of every launch ever seen, and
// stores it in the public Supabase KV table (otc_dashboard, key
// "launcher_archive"). The live tape build merges the archive behind the fresh
// coins, so the panel serves the complete launch history and an upstream feed
// reset can never erase the tape again. Reads/writes are best-effort: a failed
// archive must never fail the feed.

import { secrets } from "base44:runtime";
import { pushDashboardToSupabase } from "./supabaseDashboard.ts";
import { decodeLauncherCurve } from "./launcherCurve.js";

const TABLE = "otc_dashboard";
const ARCHIVE_KEY = "launcher_archive";
const COINS_URL = "https://otcdesks.cash/api/coins";
const CACHE_MS = 300_000; // in-isolate archive read cache: one sweep per 5 min

const text = (v) => (typeof v === "string" ? v.trim() : "");

// Only the fields the roster projection consumes — trimmed coins keep the
// archive row small (~300B each, ~2.5MB for the full ~9k-launch tape).
export function trimLauncherCoin(coin) {
  const snapshot = coin?.snapshot && typeof coin.snapshot === "object"
    ? coin.snapshot
    : {};
  const socials = coin?.socials && typeof coin.socials === "object" &&
      !Array.isArray(coin.socials)
    ? coin.socials
    : {};
  const num = (v) => (Number.isFinite(v) ? v : null);
  return {
    mint: text(coin?.mint),
    symbol: text(coin?.symbol),
    name: text(coin?.name),
    image: text(coin?.image),
    createdAt: num(coin?.createdAt),
    socials: {
      twitter: text(socials.twitter),
      telegram: text(socials.telegram),
      website: text(socials.website),
    },
    venue: text(coin?.venue) || "pump.fun",
    pairMint: text(coin?.pairMint),
    pairSymbol: text(coin?.pairSymbol),
    rewardMint: text(coin?.rewardMint),
    rewardSymbol: text(coin?.rewardSymbol),
    rewardCycle: Number.isSafeInteger(coin?.rewardCycle)
      ? coin.rewardCycle
      : null,
    rewardBasket: Array.isArray(coin?.rewardBasket)
      ? coin.rewardBasket.map(text).filter(Boolean)
      : [],
    snapshot: {
      volume24h: num(snapshot.volume24h),
      marketCap: num(snapshot.marketCap),
      liquidity: num(snapshot.liquidity),
      change24h: num(snapshot.change24h),
      holders: num(snapshot.holders),
      at: num(snapshot.at),
    },
  };
}

export async function fetchLauncherCoinsPage(
  page,
  { fetchImpl = fetch, timeoutMs = 12_000 } = {},
) {
  const res = await fetchImpl(`${COINS_URL}?page=${page}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`launcher coins page ${page} -> ${res.status}`);
  const raw = await res.json();
  const coins = Array.isArray(raw?.coins) ? raw.coins : [];
  return { coins, total: Number.isFinite(raw?.total) ? raw.total : null };
}

// Bounded on-chain curve sweep over the archived tape: probes bonding-curve
// accounts for launches the live candidate scan never covers (~12k launches,
// ~150 live probes), persisting { complete, progress, at } per mint so the
// tape's UNKNOWN share converges to real statuses over successive mirror
// cycles (each cycle re-checks the never-checked first, then the stalest).
// Absent curve accounts are recorded as checked-but-unknown (absence is not
// evidence of graduation) so they stop displacing fresh checks in priority.
export async function sweepLauncherCurveStatuses(
  coins,
  { rpc, deriveCurveAddress, chunks = 20, chunkSize = 100, clock = Date.now } =
    {},
) {
  if (
    typeof rpc !== "function" || typeof deriveCurveAddress !== "function" ||
    !Array.isArray(coins)
  ) return 0;
  // Only pump.fun launches have a bonding-curve PDA under this program;
  // Meteora (and future Raydium) mints would never resolve to a real
  // account, so skip them rather than spend RPC budget on guaranteed misses.
  const targets = coins
    .filter((coin) =>
      text(coin?.mint) && (!coin.venue || coin.venue === "pump.fun")
    )
    .sort((a, b) => (a.curve?.at ?? 0) - (b.curve?.at ?? 0))
    .slice(0, chunks * chunkSize);
  let checked = 0;
  for (let i = 0; i < targets.length; i += chunkSize) {
    const chunk = targets.slice(i, i + chunkSize);
    const accounts = [], valid = [];
    for (const coin of chunk) {
      try {
        accounts.push(deriveCurveAddress(coin.mint));
        valid.push(coin);
      } catch { /* non-canonical mint: stays unchecked */ }
    }
    if (!valid.length) continue;
    let value;
    try {
      const result = await rpc("getMultipleAccounts", [accounts, {
        encoding: "base64",
        commitment: "confirmed",
        dataSlice: { offset: 0, length: 49 },
      }]);
      value =
        Array.isArray(result?.value) && result.value.length === valid.length
          ? result.value
          : null;
    } catch {
      continue;
    }
    if (!value) continue;
    const at = clock();
    valid.forEach((coin, index) => {
      if (value[index] === null) {
        coin.curve = { complete: null, progress: null, at };
        checked++;
        return;
      }
      try {
        const decoded = decodeLauncherCurve(value[index]);
        if (decoded) {
          coin.curve = {
            complete: decoded.curveComplete,
            progress: decoded.curveProgress,
            at,
          };
          checked++;
        }
      } catch { /* invalid account: stays unchecked, retried next cycle */ }
    });
  }
  return checked;
}

// Read the archived tape from Supabase. Returns [] when the archive is
// missing/unreachable — the caller degrades to the bare active set.
export async function readLauncherCoinsArchive(
  { fetchImpl = fetch, timeoutMs = 20_000 } = {},
) {
  const url = (secrets.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const serviceKey = secrets.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return [];
  const res = await fetchImpl(
    `${url}/rest/v1/${TABLE}?select=payload&key=eq.${ARCHIVE_KEY}`,
    {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  if (!res.ok) return [];
  const rows = await res.json();
  const coins = rows?.[0]?.payload?.coins;
  return Array.isArray(coins) ? coins : [];
}

export async function writeLauncherCoinsArchive(coins, at = Date.now()) {
  await pushDashboardToSupabase({ key: ARCHIVE_KEY, payload: { at, coins } });
}

// In-isolate cached loader for the live build (same pattern as the graduation
// store). Failures resolve to [] — the feed never breaks on the archive.
export function createLauncherCoinsArchiveLoader(
  { cacheMs = CACHE_MS, clock = Date.now } = {},
) {
  let cache = null, inflight = null;
  return async function loadCoins() {
    if (cache && clock() - cache.at < cacheMs) return cache.coins;
    if (!inflight) {
      inflight = readLauncherCoinsArchive()
        .then((coins) => {
          cache = { at: clock(), coins };
          return coins;
        })
        .catch(() => [])
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  };
}

// Pages are fetched in bounded-concurrency batches instead of one at a time.
// A sequential 40-page sweep at up to 12s/page could take minutes once the
// upstream API is slow, risking overlap with the next 5-min mirror cycle and
// starving deep catch-up sweeps of their page budget — exactly the kind of
// stall that leaves real launches missing from the archive far longer than
// the "every 5 minutes" design intends. Batching bounds worst-case wall time
// to `ceil(pages / PAGE_CONCURRENCY)` timeouts instead of `pages` timeouts.
const PAGE_CONCURRENCY = 8;

// Mirror-cycle refresh: sweep upstream pages (newest-first) in parallel
// batches, stop early once a whole batch is fully archived (caught up),
// capped at `pages`. Fresh sweeps win by mint; new launches append.
// Self-healing after downtime: a longer outage just means the next cycles
// sweep deeper until caught up.
export async function refreshLauncherCoinsArchive(
  { pages = 40, fetchImpl = fetch, curveSweep = null } = {},
) {
  const archived = await readLauncherCoinsArchive({ fetchImpl });
  const byMint = new Map();
  for (const coin of archived) {
    const mint = text(coin?.mint);
    if (mint && !byMint.has(mint)) byMint.set(mint, coin);
  }
  let swept = 0, added = 0, refreshed = 0;
  for (let start = 1; start <= pages; start += PAGE_CONCURRENCY) {
    const batch = [];
    for (
      let page = start;
      page < start + PAGE_CONCURRENCY && page <= pages;
      page++
    ) {
      batch.push(page);
    }
    const results = await Promise.all(
      batch.map((page) =>
        fetchLauncherCoinsPage(page, { fetchImpl }).catch(() => null)
      ),
    );
    // A page fetch failing is NOT evidence of being caught up — treat it like
    // the sequential version's `continue` (keep sweeping) rather than letting
    // a network blip masquerade as "every remaining page is already known".
    let batchFullyKnown = true, batchExhausted = false;
    for (const result of results) {
      if (!result) {
        batchFullyKnown = false;
        continue;
      }
      if (!result.coins.length) {
        batchExhausted = true;
        continue;
      }
      if (!result.coins.every((c) => byMint.has(text(c?.mint)))) {
        batchFullyKnown = false;
      }
      for (const coin of result.coins) {
        const trimmed = trimLauncherCoin(coin);
        if (!trimmed.mint) continue;
        // Persisted curve checks survive fresh upstream overwrites — the sweep
        // below refreshes them on its own schedule.
        const prev = byMint.get(trimmed.mint);
        if (prev?.curve) trimmed.curve = prev.curve;
        if (byMint.has(trimmed.mint)) refreshed++;
        else added++;
        byMint.set(trimmed.mint, trimmed);
        swept++;
      }
    }
    if (batchExhausted || batchFullyKnown) break;
  }
  const coins = [...byMint.values()];
  let curveChecked = 0;
  if (curveSweep) {
    try {
      curveChecked = await sweepLauncherCurveStatuses(coins, curveSweep);
    } catch { /* sweep is best-effort — the archive still refreshes */ }
  }
  await writeLauncherCoinsArchive(coins);
  return { total: coins.length, swept, added, refreshed, curveChecked };
}
