import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { priceOnlyRefresh, ingestOtcSnapshot } from "../../shared/otcSnapshot.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const reqArgs = await req.json().catch(() => ({}));

    // Force ingest is admin-only: it runs the full on-chain + market sweep and
    // rewrites the holdings table, so anonymous callers must not be able to
    // spam it (RPC quota burn / DB churn). The 5-minute scheduler invokes this
    // function WITHOUT force, and the Helius webhook ingests through
    // shared/otcSnapshot directly — both are unaffected by this gate. The
    // lightweight priceOnly path stays public.
    if (reqArgs.force === true) {
      let isAdmin = false;
      try {
        const user = await base44.auth.me();
        isAdmin = user?.role === "admin";
      } catch {
        isAdmin = false;
      }
      if (!isAdmin) {
        return Response.json({ error: "Force ingest is admin-only" }, { status: 403 });
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