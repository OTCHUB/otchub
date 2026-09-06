import { ApiError } from "./apiHttp.js";

// Consume the default handler's Response, including its cache header. No second
// cache, upstream fetcher, clock rewrite, or stale-fallback implementation here.
export async function readAnalyticsSnapshot(getAnalytics) {
  try {
    const response = await getAnalytics();
    if (!response.ok) throw new Error();
    const cache = response.headers.get("X-Launcher-Cache");
    const body = await response.json();
    if (!Number.isSafeInteger(body.at) || body.at < 0 || !Array.isArray(body.ranked)
      || !["hit", "miss", "stale"].includes(cache)
      || (body.stale !== undefined && typeof body.stale !== "boolean")) throw new Error();
    return { at: body.at, ranked: body.ranked.slice(0, 60), cache,
      stale: body.stale === true || cache === "stale" };
  } catch {
    throw new ApiError(502, "PROVIDER_ERROR", "Analytics data is unavailable.");
  }
}