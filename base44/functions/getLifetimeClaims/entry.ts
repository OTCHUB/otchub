// Aggregates a single wallet's lifetime claimed value per desk NFT, from the
// ClaimLog records written by logClaims. Returns per-desk USD/SOL totals and
// per-ticker amounts, plus an overall total — the "relationship" between a
// wallet and the NFTs it holds/activates and has claimed from.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const wallet = (body.wallet || "").trim();
    if (!wallet) return Response.json({ error: "wallet required" }, { status: 400 });

    const logs = await base44.asServiceRole.entities.ClaimLog.filter({ wallet });
    const byDesk = {};
    let totalUsd = 0;
    let totalSol = 0;
    let count = 0;
    for (const l of logs || []) {
      const key = l.asset_id;
      if (!byDesk[key]) {
        byDesk[key] = { asset_id: key, value_usd: 0, value_sol: 0, count: 0, tickers: {} };
      }
      const entry = byDesk[key];
      entry.value_usd += Number(l.value_usd) || 0;
      entry.value_sol += Number(l.value_sol) || 0;
      entry.count += 1;
      const sym = l.symbol || l.mint || "?";
      entry.tickers[sym] = (entry.tickers[sym] || 0) + (Number(l.amount) || 0);
      totalUsd += Number(l.value_usd) || 0;
      totalSol += Number(l.value_sol) || 0;
      count += 1;
    }
    const by_desk = Object.values(byDesk).sort((a, b) => b.value_usd - a.value_usd);
    return Response.json({
      ok: true,
      wallet,
      by_desk,
      total_usd: totalUsd,
      total_sol: totalSol,
      count,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}