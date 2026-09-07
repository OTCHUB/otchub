// Shared OTC snapshot ingestion — used by BOTH the 5-minute scheduler
// (fetchOtcData backend function) and the Helius webhook (otcWebhook backend
// function), so the ingest logic lives in exactly one place.

import {
  ADDRESSES,
  fetchDasTokenInfo,
  fetchAccountBalanceLamports,
  fetchCollectionAssets,
  fetchMagicEdenStats,
  fetchMagicEdenListings,
  fetchProtocolStats,
} from "./otcSources.ts";
import { acquireLock, releaseLock } from "./dataLock.ts";
import { rebuildDashboardAggregate } from "./dashboardAggregate.ts";
import { STOCKS } from "./otcIdl.ts";
import { scanPotSources } from "./potSources.ts";
import { readVaultStock } from "./vaultBalances.ts";
import { getSpotPrices, SOL_MINT } from "./spotPrices.ts";

const LAMPORTS_PER_SOL = 1e9;
const OTC_DECIMALS = 6;
const OTC_DEPOSIT = 100000; // OTC burned per mint
const SURCHARGE_SOL = 0.5; // SOL surcharge per mint (0.45 pot + 0.05 protocol)
const ME_BUYER_FEE_PCT = 0.02; // Magic Eden 2% platform/taker fee paid by the BUYER on top of listing price
const ME_ROYALTY_PCT = 0.05; // Creator royalty (5% for OTC desks) paid by the BUYER on top of listing price
const ME_TOTAL_MARKUP = 1 + ME_BUYER_FEE_PCT + ME_ROYALTY_PCT; // 1.07 — true buyer cost multiplier
const OTC_TGE_SUPPLY = 1_000_000_000;
const FRESH_MS = 4 * 60 * 1000; // 4 minutes (5-min cadence, allow jitter)

const latestSnapshot = async (base44) => {
  const recent = await base44.asServiceRole.entities.OtcSnapshot.list("-created_date", 1);
  return recent?.[0] || null;
};

// Lightweight price-only refresh: pull OTC + SOL spot prices from the GLOBAL
// shared price cache (shared/spotPrices.ts), then recompute the price-derived
// fields on the latest snapshot in place. Skips all heavy on-chain / Magic
// Eden / otcdesks calls so it can run every minute without rate-limiting.
// created_date is NOT touched (only updated_date
// bumps), so the 5-min full-snapshot cadence + history stay intact and the
// full-fetch freshness gate still works. Returns the response payload, or
// null when no snapshot exists yet (caller should fall through to a full fetch).
export async function priceOnlyRefresh(base44) {
  // All prices come from the GLOBAL shared price cache (shared/spotPrices.ts):
  // one upstream round-trip per TTL window serves every refresh, every user
  // and every backend consumer — this path adds ZERO extra DexScreener calls
  // (it previously burned 2 direct requests on every refresh).
  const spot = await getSpotPrices(base44);
  const otcPair = spot.otc_pair || {};
  let solPriceUsd = spot.prices[SOL_MINT] ?? null;
  let tokenPriceUsd = otcPair.price_usd ?? null;
  let tokenPriceSol = otcPair.price_native ?? null;

  const p = await latestSnapshot(base44);
  if (!p) return null;

  // Fall back to last known prices if DexScreener rate-limited this run.
  if (tokenPriceUsd == null) tokenPriceUsd = p.token_price_usd;
  if (solPriceUsd == null) solPriceUsd = p.sol_price_usd;
  if (tokenPriceSol == null) tokenPriceSol = p.token_price_sol;
  if (tokenPriceSol == null && tokenPriceUsd != null && solPriceUsd != null) {
    tokenPriceSol = tokenPriceUsd / solPriceUsd;
  }

  const floorSol = p.nft_floor_sol;
  const floorUsd = floorSol != null && solPriceUsd != null ? floorSol * solPriceUsd : null;
  const mintCostSol = tokenPriceSol != null ? OTC_DEPOSIT * tokenPriceSol + SURCHARGE_SOL : null;
  const mintCostUsd =
    tokenPriceUsd != null && solPriceUsd != null
      ? OTC_DEPOSIT * tokenPriceUsd + SURCHARGE_SOL * solPriceUsd
      : null;
  const secondaryCostSol = floorSol != null ? floorSol * ME_TOTAL_MARKUP : null;
  const secondaryCostUsd = floorUsd != null ? floorUsd * ME_TOTAL_MARKUP : null;
  let spreadSol = null;
  let spreadUsd = null;
  let spreadPct = null;
  let recommendation = "neutral";
  if (mintCostUsd != null && secondaryCostUsd != null) {
    spreadUsd = mintCostUsd - secondaryCostUsd;
    spreadSol = mintCostSol - secondaryCostSol;
    spreadPct = mintCostUsd > 0 ? (spreadUsd / mintCostUsd) * 100 : null;
    recommendation =
      spreadUsd > 0.0001 ? "buy_secondary" : spreadUsd < -0.0001 ? "mint" : "neutral";
  }
  const buybackOtc = p.protocol_buyback_otc;
  await base44.asServiceRole.entities.OtcSnapshot.update(p.id, {
    sol_price_usd: solPriceUsd,
    token_price_usd: tokenPriceUsd,
    token_price_sol: tokenPriceSol,
    nft_floor_usd: floorUsd,
    mint_cost_sol: mintCostSol,
    mint_cost_usd: mintCostUsd,
    secondary_cost_usd: secondaryCostUsd,
    spread_sol: spreadSol,
    spread_usd: spreadUsd,
    spread_pct: spreadPct,
    recommendation,
    protocol_buyback_otc_value_sol:
      buybackOtc != null && tokenPriceSol != null ? buybackOtc * tokenPriceSol : null,
    protocol_buyback_otc_value_usd:
      buybackOtc != null && tokenPriceUsd != null ? buybackOtc * tokenPriceUsd : null,
  });
  return {
    ok: true,
    price_only: true,
    updated: p.id,
    token_price_usd: tokenPriceUsd,
    sol_price_usd: solPriceUsd,
    recommendation,
  };
}

// Full snapshot ingest: on-chain + market data -> a new OtcSnapshot record +
// refreshed NftHolding gallery. `force` bypasses the freshness gate (used by
// the manual admin refresh and the activity webhook). Returns the response
// payload object.
export async function ingestOtcSnapshot(base44, { force = false } = {}) {
  // Freshness gate (global cache): skip the expensive external RPC/API calls
  // when a snapshot was ingested recently. The dashboard always serves the
  // latest stored snapshot, so this avoids redundant on-chain / market
  // fetches while still showing fresh data.
  if (!force) {
    const last = await latestSnapshot(base44);
    if (last?.created_date) {
      const ageMs = Date.now() - new Date(last.created_date).getTime();
      if (ageMs < FRESH_MS) {
        return {
          ok: true,
          cached: true,
          skipped: true,
          snapshot_id: last.id,
          age_ms: ageMs,
        };
      }
    }
  }

  // Ingest lock: the 5-min scheduler, the Helius webhook, and the admin force
  // refresh can all fire a full ingest at the same moment. Two overlapping
  // runs would create duplicate snapshots AND interleave the holdings rewrite
  // (deleteMany + bulkCreate), duplicating every NFT row. The lock serializes
  // full ingests; a crashed holder auto-expires via the TTL.
  const lock = await acquireLock(base44, "otc_ingest", 3 * 60 * 1000);
  if (!lock.acquired) {
    const last = await latestSnapshot(base44);
    return { ok: true, locked: true, skipped: true, snapshot_id: last?.id ?? null };
  }
  // Double-checked freshness: the lock winner may have started right after
  // another ingest finished — re-check so we don't stack a second snapshot
  // seconds after the last one.
  if (!force) {
    const last = await latestSnapshot(base44);
    if (last?.created_date) {
      const ageMs = Date.now() - new Date(last.created_date).getTime();
      if (ageMs < FRESH_MS) {
        await releaseLock(base44, lock);
        return { ok: true, cached: true, skipped: true, snapshot_id: last.id, age_ms: ageMs };
      }
    }
  }

  // ALL prices come from the global shared price cache (shared/spotPrices.ts):
  // one upstream round-trip per TTL window for the whole app, with Helius DAS
  // + last-known-value fallbacks built in. The ingest used to burn its own
  // direct DexScreener requests here — a major driver of the intermittent
  // rate-limit gaps on the dashboard.
  const spot = await getSpotPrices(base44);
  const pair = spot.otc_pair || {};
  let solPriceUsd = spot.prices[SOL_MINT] ?? null;
  let tokenPriceUsd = pair.price_usd ?? null;
  let tokenPriceSol = pair.price_native ?? null;

  // Helius DAS getAsset (showFungible): exact decimal-adjusted on-chain
  // supply, plus a verified USD price as a cold-cache fallback.
  // https://www.helius.dev/docs/das/get-tokens
  const dasInfo = await fetchDasTokenInfo(ADDRESSES.OTC_TOKEN_MINT);
  if (tokenPriceUsd == null && dasInfo?.priceUsd != null) tokenPriceUsd = dasInfo.priceUsd;

  // Fall back to last known prices if even the shared cache is cold
  if (tokenPriceUsd == null || solPriceUsd == null || tokenPriceSol == null) {
    const p = await latestSnapshot(base44);
    if (p) {
      if (tokenPriceUsd == null) tokenPriceUsd = p.token_price_usd;
      if (solPriceUsd == null) solPriceUsd = p.sol_price_usd;
      if (tokenPriceSol == null) tokenPriceSol = p.token_price_sol;
    }
  }
  if (tokenPriceSol == null && tokenPriceUsd != null && solPriceUsd != null) {
    tokenPriceSol = tokenPriceUsd / solPriceUsd;
  }

  // allSettled: a Helius / Magic Eden / otcdesks outage on ONE call must NOT
  // abort the whole snapshot — whatever succeeds still gets persisted so the
  // dashboard keeps refreshing instead of going stale for hours.
  const [potR, meR, lsR, asR, stR] = await Promise.allSettled([
    fetchAccountBalanceLamports(ADDRESSES.POT),
    fetchMagicEdenStats(ADDRESSES.MAGIC_EDEN_SYMBOL),
    fetchMagicEdenListings(ADDRESSES.MAGIC_EDEN_SYMBOL),
    fetchCollectionAssets(ADDRESSES.NFT_COLLECTION),
    fetchProtocolStats(),
  ]);
  const potLamports = potR.status === "fulfilled" ? potR.value : null;
  const meStats = meR.status === "fulfilled" ? meR.value : null;
  const listings = lsR.status === "fulfilled" ? lsR.value : [];
  const assets = asR.status === "fulfilled" ? asR.value : null;
  const stats = stR.status === "fulfilled" ? stR.value : null;
  // Exact decimal-adjusted on-chain supply straight from Helius DAS getAsset
  // (fetched above) — no direct DexScreener/RPC supply call needed. Fall back
  // to the previous snapshot's supply on the rare DAS gap.
  let tokenSupply = dasInfo?.supply ?? null;

  const potSol = potLamports != null ? potLamports / LAMPORTS_PER_SOL : null;

  // On-chain OTC supply vs TGE (1B). The gap is burnt forever via desk minting
  // (100k OTC burned per mint) and ongoing usage.
  const tokenTotalSupply = tokenSupply != null ? tokenSupply : null;
  const tokenBurnt = tokenTotalSupply != null ? OTC_TGE_SUPPLY - tokenTotalSupply : null;

  // Buyback treasury holds OTC tokens — value them in SOL and USD too.
  const buybackOtc = stats?.buybackOtc ? stats.buybackOtc / Math.pow(10, OTC_DECIMALS) : null;

  const assetsOk = Array.isArray(assets);
  const assetList = assetsOk ? assets : [];
  // One previous-snapshot read, reused by every fallback below (supply, NFT
  // counts, Magic Eden outage carry-forward). The collection-fetch failure
  // case (e.g. Helius DAS 500) still falls back to its NFT counts and KEEPS
  // the existing holdings — a transient outage never wipes the gallery.
  const prevSnap = await latestSnapshot(base44);
  // Fall back to the previous snapshot's supply on a rare DAS gap (deferred
  // to here so the fallback runs after prevSnap is read).
  if (tokenSupply == null) {
    tokenSupply = prevSnap?.token_total_supply ?? null;
  }
  const totalSupply = assetsOk ? assetList.length : (prevSnap?.nft_total_supply ?? 0);
  const perDeskHistory = stats?.perDesk || [];
  // AUTHORITATIVE desk supply: the Helius DAS collection scan counts every
  // desk that exists on-chain right now. otcdesks.cash's daily history lags
  // real mints (its latest rollup sat dozens of desks behind the chain), so
  // use the on-chain count whenever the scan succeeded and fall back to the
  // site history / previous snapshot only when the scan failed.
  const desksMinted = assetsOk
    ? totalSupply
    : perDeskHistory.length
      ? perDeskHistory[perDeskHistory.length - 1].desks
      : (prevSnap?.desks_minted ?? totalSupply);
  // MAGIC EDEN AVAILABILITY: the stats and listings calls can BOTH fail or
  // come back empty when Magic Eden rate-limits a run — that must read as
  // "ME is down", not "nothing is listed". meListingsFailed = no listings
  // data while ME still reports desks as listed (or ME is fully down).
  const meListingsFailed =
    listings.length === 0 && (meStats == null || (meStats.listedCount ?? 0) > 0);
  let listedCount = meStats?.listedCount ?? null;
  let floorSol = meStats?.floorPrice != null ? meStats.floorPrice / LAMPORTS_PER_SOL : null;
  if (floorSol == null && listings.length) {
    const prices = listings.map((l) => l.price || 0).filter((p) => p > 0);
    if (prices.length) floorSol = Math.min(...prices);
  }
  // ME down this run: keep the last known floor / listed count instead of
  // writing nulls that blank the listings panel and break the spread math.
  if (floorSol == null && prevSnap?.nft_floor_sol != null) {
    floorSol = prevSnap.nft_floor_sol;
  }
  if (listedCount == null && prevSnap?.nft_listed_count != null) {
    listedCount = prevSnap.nft_listed_count;
  }
  const floorUsd = floorSol != null && solPriceUsd ? floorSol * solPriceUsd : null;

  // Mint cost: 100,000 OTC burned + 0.5 SOL surcharge
  const mintCostSol = tokenPriceSol != null ? OTC_DEPOSIT * tokenPriceSol + SURCHARGE_SOL : null;
  const mintCostUsd =
    tokenPriceUsd != null && solPriceUsd != null
      ? OTC_DEPOSIT * tokenPriceUsd + SURCHARGE_SOL * solPriceUsd
      : null;
  // True buyer cost on secondary = list price + 2% taker fee + 5% creator royalty
  const secondaryCostSol = floorSol != null ? floorSol * ME_TOTAL_MARKUP : null;
  const secondaryCostUsd = floorUsd != null ? floorUsd * ME_TOTAL_MARKUP : null;

  let spreadSol = null;
  let spreadUsd = null;
  let spreadPct = null;
  let recommendation = "neutral";
  if (mintCostUsd != null && secondaryCostUsd != null) {
    spreadUsd = mintCostUsd - secondaryCostUsd;
    spreadSol = mintCostSol - secondaryCostSol;
    spreadPct = mintCostUsd > 0 ? (spreadUsd / mintCostUsd) * 100 : null;
    recommendation =
      spreadUsd > 0.0001 ? "buy_secondary" : spreadUsd < -0.0001 ? "mint" : "neutral";
  }

  // DESK DISTRIBUTIONS ONLY: the otcdesks.cash stats feed's byStock list also
  // contains LAUNCHER (launchpad) reward tokens — GPRO, PUMP, SPYx, WBTC, memes
  // and even junk rows ("TEST") — that desk vaults can never hold. Per the
  // protocol's newsletter, launcher fees pay 75% to LAUNCHPAD holders and only
  // 10% funnels into the desk pot, so crediting those rows to desk holders would
  // be misleading. Desk vaults accrue ONLY the 13-stock rotation (otcIdl
  // STOCKS), so keep exactly those mints — deduped by mint (the feed repeats
  // rows, e.g. SPCXx) — and drop everything else.
  const DESK_ROTATION_MINTS = new Set(STOCKS.map((s) => s.mint));
  const byStockFeed = new Map();
  for (const s of stats?.byStock || []) {
    if (!DESK_ROTATION_MINTS.has(s.mint)) continue;
    const prev = byStockFeed.get(s.mint);
    if (!prev || (s.distributed || 0) > (prev.distributed || 0)) byStockFeed.set(s.mint, s);
  }
  const byStock = [...byStockFeed.values()].map((s) => ({
    symbol: s.symbol,
    mint: s.mint,
    distributed_sol: s.distributed ? s.distributed / LAMPORTS_PER_SOL : 0,
    coins: s.coins || 0,
    per_desk_sol:
      desksMinted > 0 && s.distributed ? s.distributed / LAMPORTS_PER_SOL / desksMinted : 0,
  }));

  const perDesk = perDeskHistory.map((d) => {
    const perDesksol = d.lamports ? d.lamports / LAMPORTS_PER_SOL : 0;
    const desks = d.desks || 0;
    return {
      day: d.day,
      spent_sol: d.spent ? d.spent / LAMPORTS_PER_SOL : 0,
      per_desk_sol: perDesksol,
      total_earned_sol: perDesksol * desks,
      rounds: d.rounds || 0,
      desks,
    };
  });

  const solOf = (v) => (v ? v / LAMPORTS_PER_SOL : null);
  const protocolDistributedSol = solOf(stats?.distributed);
  const roundsTotal = perDeskHistory.reduce((a, d) => a + (d.rounds || 0), 0);

  // Per-desk lifetime accrual MUST come from the DESK-ONLY channel: the
  // otcdesks "distributed" headline mixes launchpad-holder payouts (GPRO/PUMP/
  // SPYx/... rows, ~3136 of 3813 SOL) into the total, which overstated the
  // per-desk figure by ~2.2x. The perDesk history is desk-only (validated:
  // lamports is per-desk/day and lamports x desks tracks the daily "spent"
  // almost exactly), so its lifetime sum / current desks is the true average.
  const deskChannelSol = perDesk.reduce((a, d) => a + (d.total_earned_sol || 0), 0);
  const perDeskAccruedSol = desksMinted > 0 ? deskChannelSol / desksMinted : null;
  const perDeskAccruedUsd =
    perDeskAccruedSol != null && solPriceUsd ? perDeskAccruedSol * solPriceUsd : null;

  // DESK-POT REVENUE BY SOURCE (mint surcharge / launchpad fees / other):
  // incremental on-chain scan of the pot's SOL inflow txs (shared/potSources).
  // The days map + cursor carry forward snapshot-to-snapshot; best-effort —
  // on any failure the previous snapshot's data is kept unchanged.
  let potSources = prevSnap?.pot_sources ?? null;
  try {
    const scanned = await scanPotSources(potSources);
    if (scanned) potSources = scanned;
  } catch (e) {
    console.warn("potSources scan failed:", e?.message || e);
  }

  const snapshot = {
    sol_price_usd: solPriceUsd,
    token_price_usd: tokenPriceUsd,
    token_price_sol: tokenPriceSol,
    token_market_cap:
      pair.market_cap ??
      stats?.marketCap ??
      (tokenPriceUsd != null && dasInfo?.supply != null
        ? tokenPriceUsd * dasInfo.supply
        : null),
    token_volume_24h: pair.volume_24h ?? stats?.volume24h ?? null,
    token_liquidity_usd: pair.liquidity_usd ?? null,
    token_price_change_24h: pair.change_24h ?? null,
    nft_floor_sol: floorSol,
    nft_floor_usd: floorUsd,
    nft_listed_count: listedCount,
    nft_total_supply: totalSupply,
    desks_minted: desksMinted,
    pot_sol_balance: potSol,
    protocol_earned_sol: solOf(stats?.earned),
    protocol_distributed_sol: protocolDistributedSol,
    protocol_to_pot_sol: solOf(stats?.toPot),
    protocol_to_protocol_sol: solOf(stats?.toProtocol),
    protocol_buyback_sol: solOf(stats?.buybackBalance),
    protocol_buyback_otc: buybackOtc,
    protocol_buyback_otc_value_sol:
      buybackOtc != null && tokenPriceSol != null ? buybackOtc * tokenPriceSol : null,
    protocol_buyback_otc_value_usd:
      buybackOtc != null && tokenPriceUsd != null ? buybackOtc * tokenPriceUsd : null,
    token_total_supply: tokenTotalSupply,
    token_burnt: tokenBurnt,
    token_tge_supply: OTC_TGE_SUPPLY,
    protocol_owed_sol: solOf(stats?.owed),
    protocol_costs_sol: solOf(stats?.costs),
    protocol_coins: stats?.coins ?? null,
    protocol_earning_coins: stats?.earning ?? null,
    rounds_total: roundsTotal,
    mint_cost_sol: mintCostSol,
    mint_cost_usd: mintCostUsd,
    secondary_cost_sol: secondaryCostSol,
    secondary_cost_usd: secondaryCostUsd,
    spread_sol: spreadSol,
    spread_usd: spreadUsd,
    spread_pct: spreadPct,
    recommendation,
    by_stock: { items: byStock },
    pot_sources: potSources,
    per_desk: { items: perDesk },
    buybacks: {
      items: (stats?.buybacks || []).map((b) => ({
        date: b.at ? new Date(b.at * 1000).toISOString().slice(0, 10) : null,
        sol: b.sol ? b.sol / LAMPORTS_PER_SOL : 0,
        otc: b.otc ? b.otc / Math.pow(10, OTC_DECIMALS) : 0,
        signature: b.signature || null,
      })),
    },
  };

  const created = await base44.asServiceRole.entities.OtcSnapshot.create(snapshot);

  const listedSet = new Set((listings || []).map((l) => l.tokenMint || l.token_mint || l.id));
  const priceMap = new Map();
  for (const l of listings || []) {
    const m = l.tokenMint || l.token_mint || l.id;
    if (m && l.price) priceMap.set(m, l.price);
  }
  // Accurate per-desk accrued PDA value: each desk earns the daily per-desk
  // distribution from the day it was minted. Mint day is derived from the
  // desk's number (e.g. "OTC Desk #1108") against the cumulative desks/day.
  const dayRows = perDeskHistory.map((d) => ({
    day: d.day,
    cumDesks: d.desks || 0,
    perDeskSol: d.lamports ? d.lamports / LAMPORTS_PER_SOL : 0,
  }));
  const accruedForDesk = (num) => {
    let idx = dayRows.findIndex((r) => r.cumDesks >= num);
    if (idx < 0) idx = dayRows.length - 1;
    if (idx < 0) return { mintDay: null, accrued: perDeskAccruedSol };
    let acc = 0;
    for (let i = idx; i < dayRows.length; i++) acc += dayRows[i].perDeskSol;
    return { mintDay: dayRows[idx].day, accrued: acc };
  };

  // Existing holdings, read BEFORE the rewrite: (1) when the ME listings
  // fetch failed this run, their listing fields carry forward so a transient
  // ME outage doesn't flip every desk to "not listed" until the next good
  // ingest; (2) their row ids let the persist step swap the table without
  // an empty-gallery window.
  let prevListingMap = null;
  let existingHoldingRows = null;
  if (assetsOk) {
    existingHoldingRows =
      (await base44.asServiceRole.entities.NftHolding.list("asset_id", 5000)) || [];
    prevListingMap = new Map(existingHoldingRows.map((h) => [h.asset_id, h]));
  }

  const holdings = assetList.map((a) => {
    const id = a.id || a.address || "";
    let lp = priceMap.get(id);
    // Listings fetch failed this run: keep the desk's last known listing
    // price (the stored price includes the buyer markup — undo it) instead
    // of nulling it. When the fetch succeeded, prevH is null → unchanged.
    const prevH = meListingsFailed ? prevListingMap?.get(id) : null;
    if (lp == null && prevH?.listing_price_sol != null) {
      lp = prevH.listing_price_sol / ME_TOTAL_MARKUP;
    }
    const name = a.content?.metadata?.name || a.name || "OTC Desk";
    const nm = name.match(/#(\d+)/);
    const { mintDay, accrued } = nm
      ? accruedForDesk(parseInt(nm[1], 10))
      : { mintDay: null, accrued: perDeskAccruedSol };
    return {
      asset_id: id,
      name,
      owner: a.ownership?.owner || null,
      image_url: a.content?.files?.[0]?.uri || a.content?.links?.image || null,
      accrued_value_sol: accrued,
      accrued_value_usd: accrued != null && solPriceUsd ? accrued * solPriceUsd : null,
      mint_day: mintDay,
      is_listed: listedSet.has(id) || (prevH?.is_listed ?? false),
      // True buyer cost = raw ME list price + 2% taker fee + 5% creator royalty
      listing_price_sol: lp != null ? lp * ME_TOTAL_MARKUP : null,
      listing_price_usd: lp != null && solPriceUsd ? lp * ME_TOTAL_MARKUP * solPriceUsd : null,
    };
  });

  // LISTING INTEGRITY CHECK — run BEFORE the holdings are persisted: a listed
  // desk is only a real buy opportunity if its vault still holds stock. The
  // accrued values computed above are THEORETICAL (summed from distribution
  // history) — an owner who claimed out still carries the estimate, and
  // persisting it would mark a stockless listing as a stocked snipe. Read the
  // LISTED desks' real vault balances on-chain (same shared reader the claim
  // scan uses) and replace the estimate with the verified live value — 0 when
  // the vault is empty, so every consumer of this snapshot (gallery, arbitrage
  // fallback, charts) starts from the truth.
  if (assetsOk) {
    const listedIds = holdings.filter((h) => h.is_listed).map((h) => h.asset_id);
    if (listedIds.length) {
      const [vaultStockR, spotR] = await Promise.allSettled([
        readVaultStock(listedIds),
        getSpotPrices(base44),
      ]);
      if (vaultStockR.status === "fulfilled" && spotR.status === "fulfilled") {
        const prices = spotR.value.prices || {};
        const solUsd = prices[SOL_MINT] ?? solPriceUsd;
        for (const h of holdings) {
          if (!h.is_listed) continue;
          const v = vaultStockR.value.get(h.asset_id);
          if (!v) continue;
          if (!v.hasStock) {
            // Verified empty vault — no stock to claim after buying it.
            h.accrued_value_sol = 0;
            h.accrued_value_usd = 0;
          } else {
            let usd = 0;
            for (const t of v.tickers) {
              if (t.exists && t.amount > 0) {
                usd += (t.amount / 10 ** t.decimals) * (prices[t.mint] || 0);
              }
            }
            // Overwrite only when the stock could actually be valued; with a
            // full price gap keep the estimate rather than zeroing real stock.
            if (usd > 0) {
              h.accrued_value_sol = solUsd ? usd / solUsd : h.accrued_value_sol;
              h.accrued_value_usd = usd;
            }
          }
        }
      }
    }
  }

  if (assetsOk && holdings.length) {
    // Swap WITHOUT the empty-table window: create the replacement rows FIRST,
    // then delete only the rows they replace (by id — $in filter verified).
    // The old deleteMany({}) → bulkCreate order left the gallery completely
    // empty for the whole bulkCreate window (seconds on a big collection),
    // so dashboard loads landing in between showed no holdings/listings —
    // the intermittent "info missing" reads. In the gap, readers now see a
    // complete set (briefly duplicated), never a blank one.
    await base44.asServiceRole.entities.NftHolding.bulkCreate(holdings);
    // Delete EVERY pre-existing row id: every desk in the new set has a fresh
    // row, so ALL old rows are superseded — including old copies of desks
    // that are still in the collection (same asset_id, old row). Filtering
    // stale rows by asset_id was the bug: old copies of live desks never
    // matched and piled up run after run. Chunked to keep the delete query
    // bounded on big tables.
    const oldRowIds = (existingHoldingRows || []).map((h) => h.id);
    for (let i = 0; i < oldRowIds.length; i += 400) {
      await base44.asServiceRole.entities.NftHolding.deleteMany({
        id: { $in: oldRowIds.slice(i, i + 400) },
      });
    }
  }

  await releaseLock(base44, lock);

  // QUOTA FIX: rebuild the pre-aggregated dashboard cache right after the
  // data changed (new snapshot + fresh holdings), reusing the in-memory
  // holdings so the aggregate costs one snapshot-history read per ingest
  // instead of the dashboard re-reading 3,500 rows every minute per
  // isolate. Best-effort: a failed rebuild never fails the ingest — the
  // dashboard falls back to its direct build until the next good one.
  try {
    await rebuildDashboardAggregate(
      base44,
      assetsOk && holdings.length ? { holdings } : {}
    );
  } catch (e) {
    console.warn("dashboard aggregate rebuild failed:", e?.message || e);
  }

  return {
    ok: true,
    snapshot_id: created?.id,
    assets_count: assetList.length,
    desks_minted: desksMinted,
    pot_sol: potSol,
    floor_sol: floorSol,
    mint_cost_sol: mintCostSol,
    secondary_cost_sol: secondaryCostSol,
    recommendation,
    stats_ok: stats ? true : false,
  };
}