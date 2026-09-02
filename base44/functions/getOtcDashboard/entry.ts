import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { ADDRESSES, fetchTokenSupply } from "../../shared/otcSources.ts";

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
    // Accurate on-chain-grounded bootstrap of the full supply/burn history.
    // Mint deposit started at 1,000,000 OTC/desk and was later cut to
    // 100,000 OTC/desk, so a flat 100k/desk assumption understates early
    // burns. We anchor to the real on-chain current supply (live RPC, falling
    // back to the latest snapshot) to derive the migration point D_mig — the
    // cumulative desk count at which the deposit changed — analytically:
    //   currentBurnt = D_mig*1M + (D_total - D_mig)*100k
    // Then each day's cumulative burn is reconstructed with the correct
    // per-desk deposit before/after the migration.
    const OTC_TGE_SUPPLY = 1_000_000_000;
    const DEPOSIT_OLD = 1_000_000;
    const DEPOSIT_NEW = 100_000;

    let liveSupply = latest?.token_total_supply ?? null;
    try {
      const live = await fetchTokenSupply(ADDRESSES.OTC_TOKEN_MINT);
      if (live != null) liveSupply = live;
    } catch (e) {
      /* keep snapshot/null anchor */
    }
    const currentBurnt = liveSupply != null ? OTC_TGE_SUPPLY - liveSupply : null;
    const perDeskItems = latest?.per_desk?.items || [];
    const D_total =
      latest?.desks_minted ?? perDeskItems[perDeskItems.length - 1]?.desks ?? null;

    let D_mig = null;
    if (currentBurnt != null && D_total != null) {
      D_mig = (currentBurnt - D_total * DEPOSIT_NEW) / (DEPOSIT_OLD - DEPOSIT_NEW);
      if (D_mig < 0) D_mig = 0;
      if (D_mig > D_total) D_mig = D_total;
    }

    const bootstrap = perDeskItems
      .filter((d) => d.day && d.desks != null)
      .map((d) => {
        const D_d = d.desks;
        let burnt;
        if (D_mig == null) {
          burnt = D_d * DEPOSIT_NEW;
        } else if (D_d <= D_mig) {
          burnt = D_d * DEPOSIT_OLD;
        } else {
          burnt = D_mig * DEPOSIT_OLD + (D_d - D_mig) * DEPOSIT_NEW;
        }
        return {
          t: d.day,
          desks_minted: D_d,
          token_burnt: burnt,
          token_total_supply: OTC_TGE_SUPPLY - burnt,
        };
      });

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

    // Inject true on-chain supply/burn into the served latest so the protocol
    // panel always reflects real on-chain state, even if the stored snapshot
    // predates the supply-fetch addition or a run failed mid-field.
    if (latest && liveSupply != null) {
      latest.token_total_supply = liveSupply;
      latest.token_burnt = OTC_TGE_SUPPLY - liveSupply;
      latest.token_tge_supply = OTC_TGE_SUPPLY;
    }

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