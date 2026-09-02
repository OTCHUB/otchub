import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { ADDRESSES } from "../../shared/otcSources.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    // Public read-only analytics — no auth required; service role reads shared data.

    const [snapshots, holdings] = await Promise.all([
      base44.asServiceRole.entities.OtcSnapshot.list("-created_date", 500),
      base44.asServiceRole.entities.NftHolding.list("-created_date", 1000),
    ]);

    const latest = snapshots && snapshots.length ? snapshots[0] : null;
    // history ascending for charts
    const history = (snapshots || []).slice().reverse().map((s) => ({
      t: s.created_date,
      token_price_usd: s.token_price_usd,
      token_price_sol: s.token_price_sol,
      sol_price_usd: s.sol_price_usd,
      nft_floor_sol: s.nft_floor_sol,
      nft_floor_usd: s.nft_floor_usd,
      mint_cost_usd: s.mint_cost_usd,
      secondary_cost_usd: s.secondary_cost_usd,
      spread_pct: s.spread_pct,
      pot_token_balance: s.pot_token_balance,
      pot_token_value_usd: s.pot_token_value_usd,
      nft_total_supply: s.nft_total_supply,
      nft_listed_count: s.nft_listed_count,
    }));

    return Response.json({
      addresses: ADDRESSES,
      latest,
      history,
      holdings: holdings || [],
      snapshot_count: (snapshots || []).length,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}