import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { priceOnlyRefresh, ingestOtcSnapshot } from "../../shared/otcSnapshot.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const reqArgs = await req.json().catch(() => ({}));

    // Force ingest is PUBLIC, but rate-limited: a full sweep burns RPC quota
    // and rewrites the holdings table, so anyone can force it at most once per
    // FORCE_MIN_MS globally. Duplicate/racing tasks are impossible two ways:
    //  - two force calls within the window: the second is served the snapshot
    //    the first one just wrote (rate gate below);
    //  - two force calls at the same instant: the ingest lock in
    //    shared/otcSnapshot.ts ("otc_ingest") lets only one run — the loser
    //    returns immediately with the latest snapshot instead of duplicating
    //    the sweep or the holdings rewrite.
    const FORCE_MIN_MS = 2 * 60 * 1000;
    if (reqArgs.force === true) {
      const recent = await base44.asServiceRole.entities.OtcSnapshot.list("-created_date", 1);
      const last = recent?.[0] || null;
      const ageMs = last?.created_date
        ? Date.now() - new Date(last.created_date).getTime()
        : Infinity;
      if (ageMs < FORCE_MIN_MS) {
        return Response.json({
          ok: true,
          cached: true,
          rate_limited: true,
          snapshot_id: last.id,
          age_ms: ageMs,
          retry_in_ms: FORCE_MIN_MS - ageMs,
        });
      }
    }

    // Lightweight price-only refresh: recompute price-derived fields on the
    // latest snapshot in place (see shared/otcSnapshot.ts). Falls through to a
    // full fetch when no snapshot exists yet.
    if (reqArgs.priceOnly === true) {
      const res = await priceOnlyRefresh(base44);
      if (res) return Response.json(res);
    }

    const result = await ingestOtcSnapshot(base44, { force: reqArgs.force === true });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}