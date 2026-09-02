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
      // Records without a tx signature can't be deduped against the
      // authoritative on-chain scan in getLifetimeClaims (which finds the
      // same claims with signatures), so they'd double-count lifetime
      // earnings — drop them.
      .filter((r) => r.asset_id && r.tx_sig);
    if (!records.length) return Response.json({ ok: true, logged: 0 });

    // Server-side dedupe: never insert a claim that is already logged for
    // this wallet (same tx signature + ticker + desk). Client retries and
    // racing panels must not be able to double-count lifetime earnings.
    const existing = await base44.asServiceRole.entities.ClaimLog.filter(
      { wallet },
      "-created_date",
      1000
    );
    const seen = new Set();
    for (const r of existing || []) {
      if (r.tx_sig) seen.add(`${r.tx_sig}|${r.symbol}|${r.asset_id}`);
    }
    const unique = [];
    for (const r of records) {
      const key = `${r.tx_sig}|${r.symbol}|${r.asset_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(r);
    }
    if (!unique.length) {
      return Response.json({ ok: true, logged: 0, duplicates: records.length });
    }
    await base44.asServiceRole.entities.ClaimLog.bulkCreate(unique);
    return Response.json({
      ok: true,
      logged: unique.length,
      duplicates: records.length - unique.length,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}