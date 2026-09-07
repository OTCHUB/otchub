// Pre-aggregated dashboard payload — QUOTA FIX.
// getOtcDashboard used to read 1,000 OtcSnapshot + 2,500 NftHolding rows on
// EVERY rebuild (once a minute per server isolate), which is what exhausted
// the app-wide entity read quota ("App entity read traffic volume limit
// exceeded") under normal traffic. The aggregate is rebuilt ONCE per
// snapshot ingest — right after the data changes, reusing the in-memory
// holdings rows so the NftHolding table is not re-read at all — and stored
// as two compact records. The dashboard serves it with a single tiny read
// and only falls back to the full direct build when the aggregate is
// missing or older than DASH_AGGREGATE_FRESH_MS (e.g. before the first
// ingest after a deploy, or while rebuilds keep failing).

import { ADDRESSES, fetchDasTokenInfo } from "./otcSources.ts";

const CACHE_ENTITY = "OtcDashboardCache";
const CORE_KEY = "otc_dash_core"; // latest + history + addresses + counts
const HOLDINGS_KEY = "otc_dash_holdings"; // NFT holdings rows

// A rebuild happens on every ingest (5-min cadence); older than this and
// the dashboard falls back to its own direct build until a rebuild succeeds.
export const DASH_AGGREGATE_FRESH_MS = 10 * 60_000;

// The exact dashboard projection, shared by the aggregate rebuild (at ingest
// time) and the dashboard's direct-build fallback so both paths always serve
// identical payloads. `holdings` may be passed by an ingest run that just
// persisted the rows — skipping the expensive NftHolding re-read.
export async function buildDashboard(base44, { holdings: givenHoldings = null } = {}) {
  // Public read-only analytics — service role reads shared data.
  const [snapshots, storedHoldings] =
    givenHoldings != null
      ? [
          await base44.asServiceRole.entities.OtcSnapshot.list("-created_date", 1000),
          givenHoldings,
        ]
      : await Promise.all([
          base44.asServiceRole.entities.OtcSnapshot.list("-created_date", 1000),
          base44.asServiceRole.entities.NftHolding.list("-created_date", 2500),
        ]);

  const list = snapshots || [];
  const latest = list.length ? list[0] : null;

  // Bootstrap the full historical supply/burn series from the protocol's
  // daily per-desk history (stored on every snapshot). Each desk mint burns
  // its OTC deposit, so cumulative burn derives from cumulative desks and
  // circulating supply = TGE(1B) − burn. This reconstructs the on-chain
  // mint↔burn relationship across the protocol's entire life, before live
  // snapshots existed.
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

  // Exact on-chain supply via Helius DAS (keyed RPC), with the latest
  // snapshot as fallback.
  let liveSupply = latest?.token_total_supply ?? null;
  try {
    const das = await fetchDasTokenInfo(ADDRESSES.OTC_TOKEN_MINT);
    if (das?.supply != null) liveSupply = das.supply;
  } catch {
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

  // Cumulative burnt OTC from a desk count, applying the 1M→100k deposit
  // migration at D_mig (falls back to flat 100k/desk when migration unknown).
  const burntFromDesks = (D) => {
    if (D == null) return null;
    if (D_mig == null) return D * DEPOSIT_NEW;
    if (D <= D_mig) return D * DEPOSIT_OLD;
    return D_mig * DEPOSIT_OLD + (D - D_mig) * DEPOSIT_NEW;
  };

  const bootstrap = perDeskItems
    .filter((d) => d.day && d.desks != null)
    .map((d) => {
      const burnt = burntFromDesks(d.desks);
      return {
        t: d.day,
        desks_minted: d.desks,
        token_burnt: burnt,
        token_total_supply: burnt != null ? OTC_TGE_SUPPLY - burnt : null,
      };
    });

  const snapshotHistory = list
    .slice()
    .reverse()
    .map((s) => {
      // Backfill supply/burn from desks for snapshots that predate supply
      // fetching (or where a run failed mid-field), so the chart series is
      // complete — same migration logic as the daily bootstrap.
      let supply = s.token_total_supply;
      let burnt = s.token_burnt;
      if (supply == null && s.desks_minted != null) {
        burnt = burntFromDesks(s.desks_minted);
        if (burnt != null) supply = OTC_TGE_SUPPLY - burnt;
      }
      return {
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
        token_market_cap: s.token_market_cap,
        token_volume_24h: s.token_volume_24h,
        token_liquidity_usd: s.token_liquidity_usd,
        nft_listed_count: s.nft_listed_count,
        token_total_supply: supply,
        token_burnt: burnt,
        rounds_total: s.rounds_total,
        mint_cost_usd: s.mint_cost_usd,
        secondary_cost_usd: s.secondary_cost_usd,
        spread_usd: s.spread_usd,
        spread_pct: s.spread_pct,
        nft_total_supply: s.nft_total_supply,
      };
    });

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

  return {
    at: Date.now(),
    body: {
      addresses: ADDRESSES,
      latest,
      history,
      holdings: storedHoldings || [],
      snapshot_count: list.length,
    },
  };
}

async function upsertByKey(base44, key, payload) {
  const read = () => base44.asServiceRole.entities[CACHE_ENTITY].filter({ key });
  const rows = (await read()) || [];
  const current = rows[0] || null;
  if (current?.id) {
    await base44.asServiceRole.entities[CACHE_ENTITY].update(current.id, { payload });
  } else {
    await base44.asServiceRole.entities[CACHE_ENTITY].create({ key, payload });
  }
  // Prune duplicate rows a concurrent create-tie produced (newest wins) —
  // same pattern as the ingest lock in shared/dataLock.ts.
  const after = (await read()) || [];
  after.sort(
    (a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0)
  );
  if (after.length > 1) {
    await Promise.all(
      after
        .slice(1)
        .map((r) => base44.asServiceRole.entities[CACHE_ENTITY].delete(r.id))
    );
  }
}

// Rebuild + persist the aggregate. Called at the end of every successful
// snapshot ingest (5-min scheduler cadence and webhook bursts included);
// the in-memory holdings rows are reused so no NftHolding read happens.
export async function rebuildDashboardAggregate(base44, { holdings } = {}) {
  const { at, body } = await buildDashboard(
    base44,
    holdings != null ? { holdings } : {}
  );
  // Split across two records (core series vs holdings table) to keep each
  // payload bounded; both carry the same build timestamp.
  await upsertByKey(base44, CORE_KEY, {
    at,
    addresses: body.addresses,
    latest: body.latest,
    history: body.history,
    snapshot_count: body.snapshot_count,
  });
  await upsertByKey(base44, HOLDINGS_KEY, { at, holdings: body.holdings });
  return {
    ok: true,
    at,
    snapshot_count: body.snapshot_count,
    holdings_count: body.holdings.length,
  };
}

// One tiny read-set for the dashboard endpoint. Returns null when any
// record is missing (cold cache) so the caller falls back to a direct build.
export async function readDashboardAggregate(base44) {
  const [coreRows, holdingsRows] = await Promise.all([
    base44.asServiceRole.entities[CACHE_ENTITY].filter({ key: CORE_KEY }),
    base44.asServiceRole.entities[CACHE_ENTITY].filter({ key: HOLDINGS_KEY }),
  ]);
  const core = coreRows?.[0]?.payload;
  const held = holdingsRows?.[0]?.payload;
  if (!core || !held) return null;
  return {
    // Oldest of the two writes: freshness of the whole payload.
    at: Math.min(core.at || 0, held.at || 0),
    body: {
      addresses: core.addresses,
      latest: core.latest,
      history: core.history,
      holdings: held.holdings || [],
      snapshot_count: core.snapshot_count,
    },
  };
}