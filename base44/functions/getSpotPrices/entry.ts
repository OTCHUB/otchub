// Public spot-price feed backed by the app's GLOBAL cache: one upstream
// DexScreener round-trip per TTL window serves every user and every price
// consumer (see shared/spotPrices.ts). Read-only, no auth needed — prices are
// public market data and the cache bounds upstream usage no matter how many
// users or bots call this.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { getSpotPrices } from "../../shared/spotPrices.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const r = await getSpotPrices(base44);
    return Response.json({ ok: true, ...r });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}