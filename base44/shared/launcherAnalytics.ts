/* Shared cached launcher-analytics handler. Functions may not import each
   other's entry.ts (the runtime bundles only files inside the function
   folder), so getLauncherAnalytics, getPublicMetrics, and ruFomoSignals each
   bundle this module locally. Each bundle gets its own isolate-local 5-min
   in-memory cache — identical semantics to the former cross-import. */

import { buildLauncherAnalyticsBody } from "./launcherFeed.ts";

const FRESH_MS = 5 * 60_000, STALE_MS = 30 * 60_000;

export function createLauncherAnalyticsHandler() {
  let mem = { at: 0, body: null };
  let inflight = null;
  const j = (o, cache) => Response.json(o, { headers: { "X-Launcher-Cache": cache } });

  return async function (payload) {
    const force = payload?.force === true;
    const now = Date.now();
    if (!force && mem.body && now - mem.at < FRESH_MS) return j(mem.body, "hit");
    if (!inflight) {
      inflight = buildLauncherAnalyticsBody().then((body) => { mem = { at: Date.now(), body }; return body; })
        .finally(() => { inflight = null; });
    }
    try {
      return j(await inflight, "miss");
    } catch (e) {
      if (mem.body && now - mem.at < STALE_MS) return j({ ...mem.body, stale: true }, "stale");
      return Response.json({ error: e.message }, { status: 502 });
    }
  };
}