/* getLauncherAnalytics — serves the OTC_ANALYTICS cohort payload.
   The build lives in shared/launcherFeed.ts so the 5-min Supabase mirror
   (mirrorLauncherFeed) pushes the identical payload browsers fall back to
   when this endpoint is unreachable. Same 5-min in-memory cache +
   stale-on-error fallback as before. */

import { buildLauncherAnalyticsBody } from "../../shared/launcherFeed.ts";

const FRESH_MS = 5 * 60_000, STALE_MS = 30 * 60_000;
let mem = { at: 0, body: null };
let inflight = null;

const j = (o, cache) => Response.json(o, { headers: { "X-Launcher-Cache": cache } });

export default async function (payload) {
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
}