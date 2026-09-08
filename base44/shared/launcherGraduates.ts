// Global graduation ledger for launcher tokens, shared by getLauncherLive
// (read: GRADUATED statuses stay persistent for every visitor and across
// isolates) and reportLauncherGraduation (write: visitor-nominated AMM
// migrations, re-verified on-chain before they are persisted). One
// LauncherGraduate row per mint, written at most once in practice; load()
// dedupes any cross-isolate create-tie duplicates.
import { decodeLauncherCurve } from "./launcherCurve.js";

const GRADUATE_ENTITY = "LauncherGraduate";
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const LEDGER_ROWS = 1000; // newest ledger rows tracked; launcher rosters rotate
const CACHE_MS = 300_000; // in-isolate read cache: one DB sweep per 5 minutes

export function createLauncherGraduationStore({ clock = Date.now, cacheMs = CACHE_MS, limit = LEDGER_ROWS } = {}) {
  let cache = null;
  let inflight = null;

  const ledger = (getClient) => {
    const client = typeof getClient === "function" ? getClient() : null;
    const entities = client?.asServiceRole?.entities;
    if (!entities?.[GRADUATE_ENTITY]) throw new Error("GRADUATION_LEDGER_UNAVAILABLE");
    return entities[GRADUATE_ENTITY];
  };

  // Map<mint, { graduated_at, source }> over the newest `limit` ledger rows.
  // Rows arrive newest-first, so the first occurrence of a duplicate mint
  // carries the newest graduation time.
  const load = async (getClient) => {
    if (cache && clock() - cache.at < cacheMs) return cache.entries;
    if (!inflight) {
      inflight = (async () => {
        const rows = (await ledger(getClient).list("-graduated_at", limit)) || [];
        const entries = new Map();
        for (const row of rows) {
          if (MINT.test(row?.mint || "") && !entries.has(row.mint)) {
            // name/symbol/launched_at power the historical-tape rows the live
            // build serves for ledger mints the upstream roster dropped.
            entries.set(row.mint, {
              graduated_at: row.graduated_at, source: row.source,
              name: typeof row.name === "string" ? row.name : "",
              symbol: typeof row.symbol === "string" ? row.symbol : "",
              launched_at: Number.isFinite(row.launched_at) ? row.launched_at : null,
            });
          }
        }
        cache = { at: clock(), entries };
        return entries;
      })().finally(() => { inflight = null; });
    }
    return inflight;
  };

  // Idempotent append: re-checks the (cached) ledger first, so repeat reports
  // from concurrent visitors or isolates write each mint at most once.
  const save = async (getClient, graduates) => {
    const existing = await load(getClient);
    const at = clock(), fresh = [];
    for (const graduate of graduates || []) {
      const mintValue = typeof graduate?.mint === "string" ? graduate.mint : "";
      if (!MINT.test(mintValue) || existing.has(mintValue) || fresh.some((g) => g.mint === mintValue)) continue;
      fresh.push({ mint: mintValue, symbol: graduate.symbol || "", name: graduate.name || "",
        graduated_at: Number.isFinite(graduate.graduated_at) ? graduate.graduated_at : at,
        source: graduate.source || "browser_amm" });
    }
    if (!fresh.length) return 0;
    await ledger(getClient).bulkCreate(fresh);
    for (const g of fresh) existing.set(g.mint, {
      graduated_at: g.graduated_at, source: g.source,
      name: g.name || "", symbol: g.symbol || "", launched_at: null,
    });
    return fresh.length;
  };

  return { load, save };
}

// Server-side verification gate: only mints whose on-chain bonding curve shows
// the COMPLETE flag may enter the ledger. A report claim alone is never
// trusted; RPC failures leave the mint unverified (rejected), never saved.
export function createGraduationVerifier({ rpc, deriveCurveAddress }) {
  return async function verifyComplete(mints) {
    const targets = [];
    for (const mintValue of new Set(Array.isArray(mints) ? mints : [])) {
      if (typeof mintValue !== "string" || !MINT.test(mintValue)) continue;
      try { targets.push([mintValue, deriveCurveAddress(mintValue)]); }
      catch { /* not a canonical address: skip */ }
    }
    const verified = new Set();
    for (let i = 0; i < targets.length; i += 100) {
      const chunk = targets.slice(i, i + 100);
      try {
        const result = await rpc("getMultipleAccounts", [chunk.map(([, address]) => address), {
          encoding: "base64", commitment: "confirmed", dataSlice: { offset: 0, length: 49 },
        }]);
        const accounts = result?.value;
        if (!Array.isArray(accounts) || accounts.length !== chunk.length) continue;
        chunk.forEach(([mintValue], index) => {
          try {
            if (decodeLauncherCurve(accounts[index])?.curveComplete === true) verified.add(mintValue);
          } catch { /* invalid account: not complete */ }
        });
      } catch { /* batch unavailable: mints stay unverified */ }
    }
    return verified;
  };
}