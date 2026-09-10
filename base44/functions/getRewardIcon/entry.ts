// Public reward-icon proxy: serves the EXACT 1:1 official payout icons
// (otcdesks.cash/stocks/<icon> for picker-catalog stocks, the site's firebase
// rewards bucket keyed by reward mint for custom rewards) through the app's
// own origin. Some visitor browsers cannot load those hosts directly
// (regional/hotlink filtering), which blanked every payout icon to letter
// fallbacks; the app runtime egress reaches both reliably, so the feed's
// rewardCatalog points custom-reward icons here, and stock icons fall back
// to here only when their bundled public/stocks asset is missing (a catalog
// entry added since the last backfill).
//
// Bounded by construction: id is an exact catalog stock symbol or a base58
// mint, upstream hosts are fixed by resolveRewardMeta, fetches are time and
// size capped, and results are cached per isolate plus Cache-Control for
// the browser (a poll cycle costs zero upstream fetches after warm-up).
import { resolveRewardMeta } from "../../shared/rewardStockCatalog.js";
import { ApiError, errorResponse, readJsonBounded, requestUrl, responseHeaders } from "../../shared/apiHttp.js";

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const CACHE_MAX = 500;
const UPSTREAM_TIMEOUT_MS = 8000;
const MAX_BYTES = 512_000;
// Broken upstream icons are negative-cached so failed loads are not retried
// on every 30s poll; the browser only caches successful image responses.
const MISS_TTL_MS = 600_000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Per-isolate cache (same pattern as the launcher-live handler).
const cache = new Map();

async function fetchIcon(upstream) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    let res = await fetch(upstream, { signal: controller.signal, redirect: "follow",
      headers: { "User-Agent": UA, "Accept": "image/*,*/*;q=0.8" } });
    // Some reward uploads rotate their firebase download token; the catalog
    // token (the mint) then 403s. Retry once without the stale token.
    if (res.status === 403 && upstream.includes("firebasestorage.googleapis.com") && /[?&]token=/.test(upstream)) {
      res = await fetch(upstream.replace(/([?&])token=[^&]*$/, "$1"), { signal: controller.signal, redirect: "follow",
        headers: { "User-Agent": UA, "Accept": "image/*,*/*;q=0.8" } });
    }
    const type = res.headers.get("content-type") || "";
    if (!res.ok || !type.startsWith("image/")) return null;
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > MAX_BYTES) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return null;
    return { buf, type };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export default async function (req) {
  const headers = responseHeaders(["GET", "POST"]);
  try {
    if (!["GET", "POST"].includes(req.method)) {
      headers.set("Allow", "GET, POST");
      throw new ApiError(405, "METHOD_NOT_ALLOWED", "Use GET or POST.");
    }
    const url = requestUrl(req);
    let id = url.searchParams.get("id");
    if (!id && req.method === "POST") {
      // SDK invocations arrive as POST bodies; unknown platform-added keys
      // are ignored (same allowlist-approach as the launcher-live handler).
      try {
        const body = await readJsonBounded(req);
        if (body && typeof body === "object" && typeof body.id === "string") id = body.id;
      } catch { /* empty body: fall through to the 400 below */ }
    }
    if (!id || id.length > 64) throw new ApiError(400, "INVALID_ID", "Provide ?id=<reward mint or stock symbol>.");
    // Fixed upstream derivation only — never a caller-supplied URL.
    const meta = MINT_RE.test(id) ? resolveRewardMeta(id, null) : resolveRewardMeta(null, id);
    const upstream = meta?.icon;
    if (!upstream) throw new ApiError(404, "ICON_UNAVAILABLE", "No official icon for this reward.");

    const hit = cache.get(id);
    if (hit?.buf) {
      headers.set("Content-Type", hit.type || "image/png");
      headers.set("Cache-Control", "public, max-age=86400");
      return new Response(hit.buf, { status: 200, headers });
    }
    if (hit && Date.now() - hit.at < MISS_TTL_MS) {
      throw new ApiError(404, "ICON_UNAVAILABLE", "No official icon for this reward.");
    }

    const loaded = await fetchIcon(upstream);
    cache.set(id, loaded ? { buf: loaded.buf, type: loaded.type, at: Date.now() } : { buf: null, type: null, at: Date.now() });
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    if (!loaded) throw new ApiError(404, "ICON_UNAVAILABLE", "No official icon for this reward.");
    headers.set("Content-Type", loaded.type || "image/png");
    headers.set("Cache-Control", "public, max-age=86400");
    return new Response(loaded.buf, { status: 200, headers });
  } catch (error) {
    return errorResponse(error, headers);
  }
}