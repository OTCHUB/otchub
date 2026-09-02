import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import {
  ADDRESSES,
  fetchDexScreenerToken,
  fetchSolPriceUsd,
  fetchTokenAccountsByOwner,
  fetchAccountBalanceLamports,
  fetchCollectionAssets,
  fetchMagicEdenStats,
  fetchMagicEdenListings,
} from "../../shared/otcSources.ts";

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    // Allow workflow calls (no user) and admin users; reject non-admins.
    try {
      const user = await base44.auth.me();
      if (user && user.role !== "admin") {
        return Response.json({ error: "Admin only" }, { status: 403 });
      }
    } catch (e) {
      // no authenticated user — workflow context, allowed
    }

    const [pair, solPriceUsd, potAccounts, protocolAccounts, protocolSol, meStats, listings, assets] =
      await Promise.all([
        fetchDexScreenerToken(ADDRESSES.OTC_TOKEN_MINT),
        fetchSolPriceUsd(),
        fetchTokenAccountsByOwner(ADDRESSES.POT, ADDRESSES.OTC_TOKEN_MINT),
        fetchTokenAccountsByOwner(ADDRESSES.PROTOCOL_WALLET, ADDRESSES.OTC_TOKEN_MINT),
        fetchAccountBalanceLamports(ADDRESSES.PROTOCOL_WALLET),
        fetchMagicEdenStats(ADDRESSES.MAGIC_EDEN_SYMBOL),
        fetchMagicEdenListings(ADDRESSES.MAGIC_EDEN_SYMBOL, 50),
        fetchCollectionAssets(ADDRESSES.NFT_COLLECTION),
      ]);

    const tokenPriceUsd = pair ? parseFloat(pair.priceUsd) : null;
    const tokenPriceSol = tokenPriceUsd && solPriceUsd ? tokenPriceUsd / solPriceUsd : null;
    const potBalance = potAccounts.reduce((s, a) => s + a.amount, 0);
    const protocolTokenBalance = protocolAccounts.reduce((s, a) => s + a.amount, 0);
    const protocolSolBalance = protocolSol != null ? protocolSol / 1e9 : null;

    const totalSupply = assets.length;
    const listedCount = meStats?.listedCount ?? null;
    const floorSol =
      meStats?.floorPrice != null
        ? meStats.floorPrice / 1e9
        : listings.length
        ? Math.min(...listings.map((l) => (l.price || 0) / 1e9))
        : null;
    const floorUsd = floorSol != null && solPriceUsd ? floorSol * solPriceUsd : null;

    // Per-NFT implied stock claim = total stock locked in pot / minted supply
    const stockPerNft = totalSupply > 0 ? potBalance / totalSupply : null;
    const stockPerNftUsd = stockPerNft != null && tokenPriceUsd ? stockPerNft * tokenPriceUsd : null;

    // Opportunity: compare minting cost vs secondary floor.
    // Mint cost ≈ implied stock value locked per NFT (what you get by minting).
    const mintCostUsd = stockPerNftUsd;
    const secondaryCostUsd = floorUsd;
    let spreadUsd = null;
    let spreadPct = null;
    let recommendation = "neutral";
    if (mintCostUsd != null && secondaryCostUsd != null) {
      spreadUsd = secondaryCostUsd - mintCostUsd;
      spreadPct = mintCostUsd > 0 ? (spreadUsd / mintCostUsd) * 100 : null;
      if (spreadUsd > 0) recommendation = "mint";
      else if (spreadUsd < 0) recommendation = "buy_secondary";
    }

    const snapshot = {
      sol_price_usd: solPriceUsd,
      token_price_usd: tokenPriceUsd,
      token_price_sol: tokenPriceSol,
      token_market_cap: pair?.marketCap ? parseFloat(pair.marketCap) : null,
      token_volume_24h: pair?.volume?.h24 ? parseFloat(pair.volume.h24) : null,
      token_liquidity_usd: pair?.liquidity?.usd ? parseFloat(pair.liquidity.usd) : null,
      token_price_change_24h: pair?.priceChange?.h24 ? parseFloat(pair.priceChange.h24) : null,
      nft_floor_sol: floorSol,
      nft_floor_usd: floorUsd,
      nft_listed_count: listedCount,
      nft_total_supply: totalSupply,
      nft_mint_price_sol: stockPerNft && solPriceUsd ? stockPerNft * tokenPriceSol : null,
      nft_mint_price_usd: mintCostUsd,
      pot_token_balance: potBalance,
      pot_token_value_usd: potBalance && tokenPriceUsd ? potBalance * tokenPriceUsd : null,
      protocol_wallet_balance: protocolTokenBalance,
      mint_cost_usd: mintCostUsd,
      secondary_cost_usd: secondaryCostUsd,
      spread_usd: spreadUsd,
      spread_pct: spreadPct,
      recommendation,
    };

    const created = await base44.asServiceRole.entities.OtcSnapshot.create(snapshot);

    // Refresh the NFT holdings cache.
    const listedSet = new Set((listings || []).map((l) => l.tokenMint || l.token_mint));
    const holdings = assets.map((a) => ({
      asset_id: a.id || a.address || "",
      name: a.content?.metadata?.name || a.name || "Untitled",
      owner: a.ownership?.owner || null,
      image_url: a.content?.files?.[0]?.uri || a.content?.links?.image || null,
      stock_token_balance: stockPerNft,
      stock_token_value_usd: stockPerNftUsd,
      is_listed: listedSet.has(a.id || a.address),
    }));

    await base44.asServiceRole.entities.NftHolding.deleteMany({});
    if (holdings.length) {
      await base44.asServiceRole.entities.NftHolding.bulkCreate(holdings);
    }

    return Response.json({
      ok: true,
      snapshot_id: created?.id,
      assets_count: assets.length,
      pot_balance: potBalance,
      floor_sol: floorSol,
      me_stats: meStats ? "ok" : "unavailable",
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}