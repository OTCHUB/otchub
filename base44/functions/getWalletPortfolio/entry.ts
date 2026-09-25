import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import {
  ADDRESSES,
  fetchTokenAccountsByOwner,
  fetchAssetsByOwner,
  fetchMagicEdenListings,
} from "../../shared/otcSources.ts";

// True buyer cost on Magic Eden = raw list price + 2% taker fee + 5% creator
// royalty — mirrors otcSnapshot.ts's ME_TOTAL_MARKUP. Only used as a fallback
// below when a desk was listed too recently for the NftHolding snapshot (which
// already bakes this markup in) to have picked it up yet.
const ME_TOTAL_MARKUP = 1.07;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const address = (body.address || "").trim();
    if (!address) return Response.json({ error: "address required" }, { status: 400 });

    const [snapshots, accounts, ownedAssets, allHoldings, meListings] = await Promise.all([
      base44.asServiceRole.entities.OtcSnapshot.list("-created_date", 1),
      fetchTokenAccountsByOwner(address, ADDRESSES.OTC_TOKEN_MINT),
      fetchAssetsByOwner(address, ADDRESSES.NFT_COLLECTION),
      base44.asServiceRole.entities.NftHolding.list("-created_date", 2500),
      // Best-effort: a failed ME lookup just means listed-but-escrowed desks
      // stay invisible this call (same as before this fix) rather than
      // breaking the whole portfolio lookup.
      fetchMagicEdenListings(ADDRESSES.MAGIC_EDEN_SYMBOL).catch(() => []),
    ]);

    const latest = snapshots?.[0] || null;
    const solPriceUsd = latest?.sol_price_usd ?? null;
    const tokenPriceUsd = latest?.token_price_usd ?? null;

    let otcBalance = 0;
    for (const a of accounts || []) {
      otcBalance += a.amount || 0;
    }
    const otcValueUsd = tokenPriceUsd != null ? otcBalance * tokenPriceUsd : null;

    // The wallet's owned OTC desks, fetched LIVE on-chain via Helius DAS
    // (same searchAssets source the snapshot uses for the listings gallery),
    // scoped to this owner + collection — so the portfolio reflects real
    // on-chain ownership instead of relying on the NftHolding snapshot DB,
    // which goes stale when the scheduler misses and whose owner field is
    // the marketplace escrow for listed desks (not the real wallet).
    const holdingMap = new Map();
    for (const h of allHoldings || []) holdingMap.set(h.asset_id, h);

    const perDeskItems = latest?.per_desk?.items || [];
    const desksMinted =
      latest?.desks_minted ?? perDeskItems[perDeskItems.length - 1]?.desks ?? 0;
    const protocolDistributedSol = latest?.protocol_distributed_sol ?? null;
    const perDeskAccruedSol =
      desksMinted > 0 && protocolDistributedSol != null
        ? protocolDistributedSol / desksMinted
        : null;
    const dayRows = perDeskItems.map((d) => ({
      cumDesks: d.desks || 0,
      perDeskSol: d.per_desk_sol || 0,
    }));
    const accruedForDesk = (num) => {
      let idx = dayRows.findIndex((r) => r.cumDesks >= num);
      if (idx < 0) idx = dayRows.length - 1;
      if (idx < 0) return perDeskAccruedSol ?? 0;
      let acc = 0;
      for (let i = idx; i < dayRows.length; i++) acc += dayRows[i].perDeskSol;
      return acc;
    };

    const ownedList = Array.isArray(ownedAssets) ? ownedAssets : [];
    const ownedIds = new Set(ownedList.map((a) => a.id || a.address || ""));
    const holdings = ownedList.map((a) => {
      const id = a.id || a.address || "";
      const name = a.content?.metadata?.name || a.name || "OTC Desk";
      const nm = name.match(/#(\d+)/);
      const db = holdingMap.get(id);
      let accrued = db?.accrued_value_sol;
      if (accrued == null)
        accrued = nm ? accruedForDesk(parseInt(nm[1], 10)) : perDeskAccruedSol;
      return {
        asset_id: id,
        name,
        owner: a.ownership?.owner || address,
        image_url:
          a.content?.files?.[0]?.uri || a.content?.links?.image || db?.image_url || null,
        accrued_value_sol: accrued ?? 0,
        accrued_value_usd:
          accrued != null && solPriceUsd
            ? accrued * solPriceUsd
            : db?.accrued_value_usd ?? 0,
        mint_day: db?.mint_day ?? null,
        is_listed: db?.is_listed ?? false,
        listing_price_sol: db?.listing_price_sol ?? null,
        listing_price_usd: db?.listing_price_usd ?? null,
      };
    });

    // Desks THIS wallet has listed on Magic Eden fall out of `ownedAssets`
    // above (ME's v1 escrow auction house moves the Core asset's on-chain
    // `owner` to its escrow PDA, which Helius DAS reports verbatim — see
    // getDeskListings/entry.ts's doc comment, verified on-chain for desks
    // #1608/#1838). Magic Eden's own listings feed still reports the real
    // seller, so cross-reference it here the same way useWalletPortfolio.ts
    // already does for the Hub dashboard, and add back any desk the owner
    // scan missed — display data (name/image/mint day) comes from the
    // collection-wide NftHolding snapshot, which is NOT owner-scoped and so
    // isn't affected by the escrow-ownership issue.
    for (const l of meListings || []) {
      const id = l?.tokenMint || l?.tokenAddress || null;
      const seller = l?.seller || null;
      if (!id || !seller || seller !== address || ownedIds.has(id)) continue;
      const db = holdingMap.get(id);
      const rawPriceSol = typeof l?.price === "number" ? l.price : null;
      holdings.push({
        asset_id: id,
        name: db?.name || "OTC Desk",
        owner: address,
        image_url: db?.image_url || null,
        accrued_value_sol: db?.accrued_value_sol ?? 0,
        accrued_value_usd: db?.accrued_value_usd ?? 0,
        mint_day: db?.mint_day ?? null,
        is_listed: true,
        listing_price_sol:
          db?.listing_price_sol ?? (rawPriceSol != null ? rawPriceSol * ME_TOTAL_MARKUP : null),
        listing_price_usd:
          db?.listing_price_usd ??
          (rawPriceSol != null && solPriceUsd != null
            ? rawPriceSol * ME_TOTAL_MARKUP * solPriceUsd
            : null),
      });
      ownedIds.add(id);
    }

    let totalEarningSol = 0;
    let listedCount = 0;
    for (const h of holdings) {
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
      nft_floor_sol: latest?.nft_floor_sol ?? null,
      desks_owned: holdings.length,
      listed_count: listedCount,
      total_earning_sol: totalEarningSol,
      total_earning_usd: totalEarningUsd,
      by_stock: latest?.by_stock || null,
      holdings,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}