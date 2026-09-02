import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { ADDRESSES } from "../../shared/otcSources.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    // Public read-only analytics — no auth required; service role reads shared data.

    const [snapshots, holdings] = await Promise.all([
      base44.asServiceRole.entities.OtcSnapshot.list("-created_date", 1000),
      base44.asServiceRole.entities.NftHolding.list("-created_date", 2500),
    ]);

    const list = snapshots || [];
    const latest = list.length ? list[0] : null;

    // Bootstrap the full historical supply/burn series from the protocol's
    // daily per-desk history (stored on every snapshot). Each desk mint burns
    // exactly 100,000 OTC, so cumulative burn = cumulative desks × 100k and
    // circulating supply = TGE(1B) − burn. This reconstructs the on-chain
    // mint↔burn relationship across the protocol's entire life (≈5 days),
    // before live snapshots existed.
    const OTC_TGE_SUPPLY = 1_000_000_000;
    const OTC_BURN_PER_DESK = 100000;
    const perDeskItems = latest?.per_desk?.items || [];
    const bootstrap = perDeskItems
      .filter((d) => d.day && d.desks != null)
      .map((d) => ({
        t: d.day,
        desks_minted: d.desks,
        token_burnt: d.desks * OTC_BURN_PER_DESK,
        token_total_supply: OTC_TGE_SUPPLY - d.desks * OTC_BURN_PER_DESK,
      }));

    const snapshotHistory = list
      .slice()
      .reverse()
      .map((s) => ({
        t: s.created_date,
        token_price_usd: s.token_price_usd,
        token_price_sol: s.token_price_sol,
        sol_price_usd: s.sol_price_usd,
        nft_floor_sol: s.nft_floor_sol,
        nft_floor_usd: s.nft_floor_usd,
        pot_sol_balance: s.pot_sol_balance,
        protocol_distributed_sol: s.protocol_distributed_sol,
        protocol_buyback_sol: s.protocol_buyback_sol,
        desks_minted: s.desks_minted,
        token_total_supply: s.token_total_supply,
        token_burnt: s.token_burnt,
        rounds_total: s.rounds_total,
        mint_cost_usd: s.mint_cost_usd,
        secondary_cost_usd: s.secondary_cost_usd,
        spread_usd: s.spread_usd,
        spread_pct: s.spread_pct,
        nft_total_supply: s.nft_total_supply,
      }));

    // Merge the daily bootstrap (full history) with live snapshot points
    // (recent granularity), sorted chronologically. The supply/desks chart
    // connects nulls so partial series render cleanly.
    const history = [...bootstrap, ...snapshotHistory].sort((a, b) =>
      String(a.t || "").localeCompare(String(b.t || ""))
    );

    return Response.json({
      addresses: ADDRESSES,
      latest,
      history,
      holdings: holdings || [],
      snapshot_count: list.length,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}