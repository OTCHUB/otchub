// Reliable, cached on-chain claim scan for a wallet's OTC desks.
//
// Why a backend function: the client scan was hanging on the rate-limited
// public Solana RPC ("Resolving token programs..." stuck). This runs the
// same PDA/account reads through Helius (server-side API key) which is far
// more reliable, AND caches the full per-wallet result in the ClaimCache
// entity so the next access is instant instead of re-hitting RPC.
//
// Flow:
//  - cacheOnly=true: return cached results if fresh, else empty (no scan).
//    Used by the claim panel on mount for instant claimable badges.
//  - force=true: always re-scan on-chain and refresh the cache.
//  - default: return fresh cache if within TTL, else scan + cache.
//
// Balances only move on protocol distributions / claims; a 5-min TTL matches
// the snapshot cadence, and the claim flow always simulates before signing,
// so a slightly stale cached balance is caught safely at sign time.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { acquireLock, releaseLock } from "../../shared/dataLock.ts";
import { readVaultStock } from "../../shared/vaultBalances.ts";



const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_VERSION = 2; // bump to invalidate stale caches (e.g. fixed PDA derivation)



async function saveCache(base44, existing, wallet, desks) {
  const payload = { items: desks, _v: CACHE_VERSION };
  if (existing?.id) {
    await base44.asServiceRole.entities.ClaimCache.update(existing.id, { desks: payload });
  } else {
    await base44.asServiceRole.entities.ClaimCache.create({ wallet, desks: payload });
  }
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const wallet = (body.wallet || body.address || "").trim();
    const force = body.force === true;
    const cacheOnly = body.cacheOnly === true;
    if (!wallet) return Response.json({ error: "wallet required" }, { status: 400 });

    // The caller already knows which desks the wallet owns (from the portfolio
    // fetch). Accept that list directly so the scan covers exactly the NFTs
    // shown in the panel — falling back to NftHolding-by-owner only when the
    // caller didn't pass assets.
    // Bounded, validated input: cap the caller-supplied desk list (defensive
    // against oversized payloads burning RPC quota) and require plausible
    // base58 asset ids so a malformed id can't reach the PDA derivation.
    const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    const assetsIn = Array.isArray(body.assets) ? body.assets.slice(0, 100) : null;
    let desks;
    if (assetsIn && assetsIn.length) {
      desks = assetsIn
        .filter((a) => a && a.asset_id && BASE58_RE.test(a.asset_id))
        .map((a) => ({ asset_id: a.asset_id, name: a.name, image_url: a.image_url }));
    } else {
      const holdings = await base44.asServiceRole.entities.NftHolding.filter({ owner: wallet });
      desks = (holdings || []).map((h) => ({
        asset_id: h.asset_id,
        name: h.name,
        image_url: h.image_url,
      }));
    }

    // Cache lookup — race-proof: concurrent creators can leave duplicate rows
    // for the same wallet; keep the most recently updated and prune the rest
    // so every read/write targets a single row.
    const cachedRows = (await base44.asServiceRole.entities.ClaimCache.filter({ wallet })) || [];
    cachedRows.sort((a, b) => new Date(b.updated_date || 0) - new Date(a.updated_date || 0));
    if (cachedRows.length > 1) {
      await Promise.all(
        cachedRows.slice(1).map((r) => base44.asServiceRole.entities.ClaimCache.delete(r.id))
      );
    }
    const cache = cachedRows[0] || null;
    const fresh =
      cache?.updated_date &&
      Date.now() - new Date(cache.updated_date).getTime() < CACHE_TTL_MS &&
      cache?.desks?._v === CACHE_VERSION;

    if (!force && cache && fresh) {
      return Response.json({
        ok: true,
        cached: true,
        desks: cache.desks?.items || [],
        wallet,
        desks_count: desks.length,
      });
    }
    if (cacheOnly) {
      return Response.json({
        ok: true,
        cached: false,
        empty: true,
        desks: [],
        wallet,
        desks_count: desks.length,
      });
    }

    // Scan lock: two concurrent scans for the same wallet (double connect,
    // claim + portfolio panels racing) would burn duplicate RPC reads and
    // interleave cache writes. First scan wins; the loser serves the existing
    // cache instead of double-scanning. A FORCE scan (the post-claim rescan)
    // retries once before falling back — serving the pre-claim cache there
    // would reset nothing and invite re-firing already-claimed desks.
    let lock = null;
    for (let attempt = 0; attempt < 2 && !lock?.acquired; attempt++) {
      lock = await acquireLock(base44, `wscan_${wallet}`, 90 * 1000);
      if (!lock.acquired && attempt === 0) await new Promise((r) => setTimeout(r, 3000));
    }
    if (!lock.acquired) {
      return Response.json({
        ok: true,
        locked: true,
        desks: cache?.desks?._v === CACHE_VERSION ? cache.desks.items || [] : [],
        wallet,
        desks_count: desks.length,
      });
    }
    try {
    if (!desks.length) {
      await saveCache(base44, cache, wallet, []);
      return Response.json({ ok: true, fresh: true, desks: [], wallet, desks_count: 0 });
    }

    // Real on-chain vault balances via the shared reader — one authoritative
    // implementation shared with the ingest's listing integrity check, so the
    // claim scan and the snapshot can never disagree on what a vault holds.
    const vaultStock = await readVaultStock(desks.map((d) => d.asset_id));
    const out = desks.map((d) => {
      const v = vaultStock.get(d.asset_id);
      return {
        asset_id: d.asset_id,
        name: d.name,
        image_url: d.image_url,
        tickers: v?.tickers || [],
        claimable: v?.claimable || [],
      };
    });

    await saveCache(base44, cache, wallet, out);
    return Response.json({ ok: true, fresh: true, desks: out, wallet, desks_count: desks.length });
    } finally {
      await releaseLock(base44, lock);
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}