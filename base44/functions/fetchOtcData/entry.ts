import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import {
  ADDRESSES,
  fetchDexScreenerToken,
  fetchSolPriceUsd,
  fetchAccountBalanceLamports,
  fetchCollectionAssets,
  fetchMagicEdenStats,
  fetchMagicEdenListings,
  fetchProtocolStats,
  fetchTokenSupply,
} from "../../shared/otcSources.ts";

const LAMPORTS_PER_SOL = 1e9;
const OTC_DECIMALS = 6;
const OTC_DEPOSIT = 100000; // OTC burned per mint
const SURCHARGE_SOL = 0.5; // SOL surcharge per mint (0.45 pot + 0.05 protocol)
const ME_BUYER_FEE_PCT = 0.02; // Magic Eden 2% platform/taker fee paid by the BUYER on top of listing price
const ME_ROYALTY_PCT = 0.05; // Creator royalty (5% for OTC desks) paid by the BUYER on top of listing price
const ME_TOTAL_MARKUP = 1 + ME_BUYER_FEE_PCT + ME_ROYALTY_PCT; // 1.07 — true buyer cost multiplier

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    try {
      const user = await base44.auth.me();
      if (user && user.role !== "admin") {
        return Response.json({ error: "Admin only" }, { status: 403 });
      }
    } catch (e) {
      // no authenticated user — workflow context, allowed
    }

    // Freshness gate (global cache): skip the expensive external RPC/API
    // calls when a snapshot was ingested recently. The dashboard always
    // serves the latest stored snapshot, so this avoids redundant on-chain
    // / market fetches while still showing fresh data. Pass { force: true }
    // to bypass (manual admin refresh).
    const reqArgs = await req.json().catch(() => ({}));
    if (reqArgs.force !== true) {
      const recent = await base44.asServiceRole.entities.OtcSnapshot.list("-created_date", 1);
      const last = recent?.[0];
      if (last?.created_date) {
        const ageMs = Date.now() - new Date(last.created_date).getTime();
        const FRESH_MS = 4 * 60 * 1000; // 4 minutes (5-min cadence, allow jitter)
        if (ageMs < FRESH_MS) {
          return Response.json({
            ok: true,
            cached: true,
            skipped: true,
            snapshot_id: last.id,
            age_ms: ageMs,
          });
        }
      }
    }

    // DexScreener calls run sequentially to avoid concurrent rate-limiting
    const pair = await fetchDexScreenerToken(ADDRESSES.OTC_TOKEN_MINT);
    let solPriceUsd = await fetchSolPriceUsd();

    // Fall back to last known prices if DexScreener is rate-limited this run
    let tokenPriceUsd = pair ? parseFloat(pair.priceUsd) : null;
    let tokenPriceSol = pair ? parseFloat(pair.priceNative) : null;
    if (tokenPriceUsd == null || solPriceUsd == null || tokenPriceSol == null) {
      const prev = await base44.asServiceRole.entities.OtcSnapshot.list("-created_date", 1);
      const p = prev?.[0];
      if (p) {
        if (tokenPriceUsd == null) tokenPriceUsd = p.token_price_usd;
        if (solPriceUsd == null) solPriceUsd = p.sol_price_usd;
        if (tokenPriceSol == null) tokenPriceSol = p.token_price_sol;
      }
    }
    if (tokenPriceSol == null && tokenPriceUsd != null && solPriceUsd != null) {
      tokenPriceSol = tokenPriceUsd / solPriceUsd;
    }

    const [potLamports, meStats, listings, assets, stats, tokenSupply] = await Promise.all([
      fetchAccountBalanceLamports(ADDRESSES.POT),
      fetchMagicEdenStats(ADDRESSES.MAGIC_EDEN_SYMBOL),
      fetchMagicEdenListings(ADDRESSES.MAGIC_EDEN_SYMBOL),
      fetchCollectionAssets(ADDRESSES.NFT_COLLECTION),
      fetchProtocolStats(),
      fetchTokenSupply(ADDRESSES.OTC_TOKEN_MINT),
    ]);

    const potSol = potLamports != null ? potLamports / LAMPORTS_PER_SOL : null;

    // On-chain OTC supply vs TGE (1B). The gap is burnt forever via desk minting
    // (100k OTC burned per mint) and ongoing usage.
    const OTC_TGE_SUPPLY = 1_000_000_000;
    const tokenTotalSupply = tokenSupply != null ? tokenSupply : null;
    const tokenBurnt = tokenTotalSupply != null ? OTC_TGE_SUPPLY - tokenTotalSupply : null;

    // Buyback treasury holds OTC tokens — value them in SOL and USD too.
    const buybackOtc = stats?.buybackOtc
      ? stats.buybackOtc / Math.pow(10, OTC_DECIMALS)
      : null;

    const totalSupply = assets.length;
    const perDeskHistory = stats?.perDesk || [];
    const desksMinted = perDeskHistory.length
      ? perDeskHistory[perDeskHistory.length - 1].desks
      : totalSupply;
    const listedCount = meStats?.listedCount ?? null;
    const floorSol =
      meStats?.floorPrice != null
        ? meStats.floorPrice / LAMPORTS_PER_SOL
        : listings.length
        ? Math.min(...listings.map((l) => l.price || 0))
        : null;
    const floorUsd = floorSol != null && solPriceUsd ? floorSol * solPriceUsd : null;

    // Mint cost: 100,000 OTC burned + 0.5 SOL surcharge
    const mintCostSol =
      tokenPriceSol != null ? OTC_DEPOSIT * tokenPriceSol + SURCHARGE_SOL : null;
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

    const byStock = (stats?.byStock || []).map((s) => ({
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

    const perDeskAccruedSol =
      desksMinted > 0 && protocolDistributedSol != null
        ? protocolDistributedSol / desksMinted
        : null;
    const perDeskAccruedUsd =
      perDeskAccruedSol != null && solPriceUsd ? perDeskAccruedSol * solPriceUsd : null;

    const snapshot = {
      sol_price_usd: solPriceUsd,
      token_price_usd: tokenPriceUsd,
      token_price_sol: tokenPriceSol,
      token_market_cap: pair?.marketCap
        ? parseFloat(pair.marketCap)
        : stats?.marketCap ?? null,
      token_volume_24h: pair?.volume?.h24
        ? parseFloat(pair.volume.h24)
        : stats?.volume24h ?? null,
      token_liquidity_usd: pair?.liquidity?.usd ? parseFloat(pair.liquidity.usd) : null,
      token_price_change_24h: pair?.priceChange?.h24 ? parseFloat(pair.priceChange.h24) : null,
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

    const holdings = assets.map((a) => {
      const id = a.id || a.address || "";
      const lp = priceMap.get(id);
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
        is_listed: listedSet.has(id),
        // True buyer cost = raw ME list price + 2% taker fee + 5% creator royalty
        listing_price_sol: lp != null ? lp * ME_TOTAL_MARKUP : null,
        listing_price_usd: lp != null && solPriceUsd ? lp * ME_TOTAL_MARKUP * solPriceUsd : null,
      };
    });

    await base44.asServiceRole.entities.NftHolding.deleteMany({});
    if (holdings.length) await base44.asServiceRole.entities.NftHolding.bulkCreate(holdings);

    return Response.json({
      ok: true,
      snapshot_id: created?.id,
      assets_count: assets.length,
      desks_minted: desksMinted,
      pot_sol: potSol,
      floor_sol: floorSol,
      mint_cost_sol: mintCostSol,
      secondary_cost_sol: secondaryCostSol,
      recommendation,
      stats_ok: stats ? true : false,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}