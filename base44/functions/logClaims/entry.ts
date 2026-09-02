// Records successful OTC desk claims (stock moved from a desk vault into the
// claiming wallet) so the dashboard can show per-NFT lifetime-claimed value
// for the wallet that holds/activated each desk.
//
// The client computes each claim's human amount and claim-time USD/SOL value
// from a post-claim re-scan delta (authoritative on-chain state) plus live
// DexScreener prices, then submits the records here. Anonymous wallet users
// log claims too (the app is public community tooling), so there is no login
// gate — abuse is bounded by the per-call record cap and field whitelisting.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const wallet = (body.wallet || "").trim();
    const claims = (Array.isArray(body.claims) ? body.claims : []).slice(0, 200);
    if (!wallet) return Response.json({ error: "wallet required" }, { status: 400 });
    if (!claims.length) return Response.json({ ok: true, logged: 0 });

    const records = claims
      .map((c) => ({
        wallet,
        asset_id: String(c?.asset_id || ""),
        symbol: String(c?.symbol || ""),
        mint: String(c?.mint || ""),
        amount: Number(c?.amount) || 0,
        value_usd: Number(c?.value_usd) || 0,
        value_sol: Number(c?.value_sol) || 0,
        tx_sig: String(c?.tx_sig || ""),
      }))
      .filter((r) => r.asset_id);
    if (!records.length) return Response.json({ ok: true, logged: 0 });

    await base44.asServiceRole.entities.ClaimLog.bulkCreate(records);
    return Response.json({ ok: true, logged: records.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}