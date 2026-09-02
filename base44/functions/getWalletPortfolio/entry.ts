import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { ADDRESSES, fetchTokenAccountsByOwner } from "../../shared/otcSources.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const address = (body.address || "").trim();
    if (!address) return Response.json({ error: "address required" }, { status: 400 });

    const [snapshots, accounts] = await Promise.all([
      base44.asServiceRole.entities.OtcSnapshot.list("-created_date", 1),
      fetchTokenAccountsByOwner(address, ADDRESSES.OTC_TOKEN_MINT),
    ]);

    const latest = snapshots?.[0] || null;
    const solPriceUsd = latest?.sol_price_usd ?? null;
    const tokenPriceUsd = latest?.token_price_usd ?? null;

    let otcBalance = 0;
    for (const a of accounts || []) {
      otcBalance += a.amount || 0;
    }
    const otcValueUsd = tokenPriceUsd != null ? otcBalance * tokenPriceUsd : null;

    const holdings = await base44.asServiceRole.entities.NftHolding.filter({
      owner: address,
    });

    let totalEarningSol = 0;
    let listedCount = 0;
    for (const h of holdings || []) {
      totalEarningSol += h.accrued_value_sol || 0;
      if (h.is_listed) listedCount++;
    }
    const totalEarningUsd = solPriceUsd != null ? totalEarningSol * solPriceUsd : null;

    return Response.json({
      address,
      otc_balance: otcBalance,
      otc_value_usd: otcValueUsd,
      sol_price_usd: solPriceUsd,
      token_price_usd: tokenPriceUsd,
      desks_owned: (holdings || []).length,
      listed_count: listedCount,
      total_earning_sol: totalEarningSol,
      total_earning_usd: totalEarningUsd,
      holdings: holdings || [],
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}