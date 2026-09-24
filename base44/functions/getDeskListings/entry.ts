// Live Magic Eden listings for the OTC Desks collection — server-side proxy
// (api-mainnet.magiceden.dev has no Access-Control-Allow-Origin header, so
// the browser can't call it directly; see solanaRelay's header for the same
// constraint on Helius).
//
// Why this exists: when a desk (Metaplex Core asset) is listed on Magic
// Eden, ME's v1 escrow auction house (M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K)
// transfers the Core asset's on-chain `owner` field to a per-listing escrow
// PDA it controls — verified directly on mainnet for desks #1608/#1838
// (owner -> 1BWutmTvYPwDtmw9abTkS4Ssr8no61spGAvW1X6NDix, itself owned by the
// M2mx program). This is true of BOTH the raw account bytes AND Helius DAS's
// `ownership.owner` — DAS does not unwind the escrow back to the real
// seller for these listings. So `fetchOwnedDesks`'s owner-filtered
// `getProgramAccounts` scan (hub-sdk/src/desks.ts), and any DAS
// `ownerAddress` query, both silently drop a wallet's listed desks. Magic
// Eden's own listings API is the only source that still reports the real
// seller — `useWalletPortfolio` cross-references it to add those desks
// back into the connected wallet's portfolio.
import { ADDRESSES, fetchMagicEdenListings } from "../../shared/otcSources.ts";

const TTL_MS = 30_000;
let cache: { ts: number; listings: { asset: string; seller: string; priceSol: number }[] } | null =
  null;

export default async function (_req) {
  try {
    if (cache && Date.now() - cache.ts < TTL_MS) {
      return Response.json({ ok: true, listings: cache.listings, cached: true });
    }

    const raw = (await fetchMagicEdenListings(ADDRESSES.MAGIC_EDEN_SYMBOL)) || [];
    const listings = raw
      .map((l) => ({
        // Core desk assets: ME's v2 listing schema reuses `tokenMint`/`tokenAddress` for the
        // asset id itself (there is no separate SPL mint per desk).
        asset: l?.tokenMint || l?.tokenAddress || null,
        seller: l?.seller || null,
        priceSol: typeof l?.price === "number" ? l.price : null,
      }))
      .filter((l) => l.asset && l.seller && l.priceSol != null);

    cache = { ts: Date.now(), listings };
    return Response.json({ ok: true, listings });
  } catch (error) {
    // Best-effort: a failed ME lookup should never break the wallet portfolio — the caller
    // treats this the same as "nothing listed" rather than surfacing a hard error.
    return Response.json({ ok: false, listings: [], error: error.message });
  }
}
