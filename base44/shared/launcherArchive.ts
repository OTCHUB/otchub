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

const TABLE = "otc_dashboard";
const ARCHIVE_KEY = "launcher_archive";
const COINS_URL = "https://otcdesks.cash/api/coins";
const CACHE_MS = 300_000; // in-isolate archive read cache: one sweep per 5 min

const text = (v) => (typeof v === "string" ? v.trim() : "");

// Only the fields the roster projection consumes — trimmed coins keep the
// archive row small (~300B each, ~2.5MB for the full ~9k-launch tape).
export function trimLauncherCoin(coin) {
  const snapshot = coin?.snapshot && typeof coin.snapshot === "object" ? coin.snapshot : {};
  const socials = coin?.socials && typeof coin.socials === "object" && !Array.isArray(coin.socials) ? coin.socials : {};
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
    rewardMint: text(coin?.rewardMint),
    rewardSymbol: text(coin?.rewardSymbol),
    rewardCycle: Number.isSafeInteger(coin?.rewardCycle) ? coin.rewardCycle : null,
    rewardBasket: Array.isArray(coin?.rewardBasket) ? coin.rewardBasket.map(text).filter(Boolean) : [],
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

export async function fetchLauncherCoinsPage(page, { fetchImpl = fetch, timeoutMs = 12_000 } = {}) {
  const res = await fetchImpl(`${COINS_URL}?page=${page}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`launcher coins page ${page} -> ${res.status}`);
  const raw = await res.json();
  const coins = Array.isArray(raw?.coins) ? raw.coins : [];
  return { coins, total: Number.isFinite(raw?.total) ? raw.total : null };
}

// Read the archived tape from Supabase. Returns [] when the archive is
// missing/unreachable — the caller degrades to the bare active set.
export async function readLauncherCoinsArchive({ fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
  const url = (secrets.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const serviceKey = secrets.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return [];
  const res = await fetchImpl(`${url}/rest/v1/${TABLE}?select=payload&key=eq.${ARCHIVE_KEY}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
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
export function createLauncherCoinsArchiveLoader({ cacheMs = CACHE_MS, clock = Date.now } = {}) {
  let cache = null, inflight = null;
  return async function loadCoins() {
    if (cache && clock() - cache.at < cacheMs) return cache.coins;
    if (!inflight) {
      inflight = readLauncherCoinsArchive()
        .then((coins) => { cache = { at: clock(), coins }; return coins; })
        .catch(() => [])
        .finally(() => { inflight = null; });
    }
    return inflight;
  };
}

// Mirror-cycle refresh: sweep upstream pages (newest-first), stop early once a
// page is fully archived (caught up), capped at `pages`. Fresh sweeps win by
// mint; new launches append. Self-healing after downtime: a longer outage just
// means the next cycles sweep deeper until caught up.
export async function refreshLauncherCoinsArchive({ pages = 40, fetchImpl = fetch } = {}) {
  const archived = await readLauncherCoinsArchive({ fetchImpl });
  const byMint = new Map();
  for (const coin of archived) {
    const mint = text(coin?.mint);
    if (mint && !byMint.has(mint)) byMint.set(mint, coin);
  }
  let swept = 0, added = 0, refreshed = 0;
  for (let page = 1; page <= pages; page++) {
    let result;
    try { result = await fetchLauncherCoinsPage(page, { fetchImpl }); }
    catch { continue; }
    if (!result.coins.length) break;
    const pageKnown = result.coins.every((c) => byMint.has(text(c?.mint)));
    for (const coin of result.coins) {
      const trimmed = trimLauncherCoin(coin);
      if (!trimmed.mint) continue;
      if (byMint.has(trimmed.mint)) refreshed++;
      else added++;
      byMint.set(trimmed.mint, trimmed);
      swept++;
    }
    if (pageKnown) break;
  }
  const coins = [...byMint.values()];
  await writeLauncherCoinsArchive(coins);
  return { total: coins.length, swept, added, refreshed };
}