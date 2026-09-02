import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { priceOnlyRefresh, ingestOtcSnapshot } from "../../shared/otcSnapshot.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const reqArgs = await req.json().catch(() => ({}));

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