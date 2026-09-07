import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import {
  buildDashboard,
  DASH_AGGREGATE_FRESH_MS,
  readDashboardAggregate,
} from "../../shared/dashboardAggregate.ts";

/* QUOTA FIX: this handler used to read up to 3,500 entity rows (1,000
   OtcSnapshot + 2,500 NftHolding) on EVERY rebuild — under traffic that
   exhausted the app's Base44 entity read quota and the whole dashboard 500'd
   ("App entity read traffic volume limit exceeded") — blank NFT floor,
   NET_SECONDARY, LISTED. The payload is identical for every visitor, so:
     - the snapshot ingest (shared/otcSnapshot.ts) now pre-aggregates the
       payload into two compact OtcDashboardCache records once per 5-min
       ingest; this handler serves that with a single tiny read and only
       falls back to the full direct build while the aggregate is missing
       or stale (e.g. right after a deploy, before the first ingest)
     - 60s in-isolate cache collapses bursts; single-flight dedupes
       concurrent refreshes behind one rebuild
     - stale-while-revalidate serves the last good payload for up to 30 min
       when a refresh fails (quota/DB hiccup) instead of erroring the page
     - CDN hint lets the edge cache across isolates between cold starts */
const FRESH_MS = 60_000;
const STALE_MS = 30 * 60_000;
let mem = { at: 0, body: null };
let inflight = null;

const jsonOut = (body, cacheState) =>
  Response.json(body, {
    headers: {
      // The payload changes at most once per 5-min ingest; 60s edge caching
      // keeps the 60s client poll from reaching this isolate at all in
      // steady state.
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      "X-Dash-Cache": cacheState,
    },
  });

export default async function (req) {
  const now = Date.now();
  if (mem.body && now - mem.at < FRESH_MS) return jsonOut(mem.body, "hit");
  if (!inflight) {
    inflight = build(req)
      .then(({ body, src }) => {
        mem = { at: Date.now(), body };
        return { body, src };
      })
      .finally(() => { inflight = null; });
  }
  try {
    const { body, src } = await inflight;
    return jsonOut(body, `miss:${src}`);
  } catch (e) {
    if (mem.body && now - mem.at < STALE_MS) return jsonOut({ ...mem.body, stale: true }, "stale");
    return Response.json({ error: e.message }, { status: 500 });
  }
}

async function build(req) {
  const base44 = createClientFromRequest(req);
  // Pre-aggregated path first: one tiny read of the ingest-built records.
  try {
    const agg = await readDashboardAggregate(base44);
    if (agg && Date.now() - agg.at < DASH_AGGREGATE_FRESH_MS) {
      return { body: agg.body, src: "agg" };
    }
  } catch {
    /* aggregate unavailable — fall back to the direct build below */
  }
  // Legacy direct build: full 1,000 + 2,500 row read. Only runs before the
  // first ingest-built aggregate exists, or while one stays stale.
  const { body } = await buildDashboard(base44);
  return { body, src: "direct" };
}