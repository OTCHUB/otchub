// Secondary-market links for OTC desks (Metaplex Core assets). Magic Eden is where desks list and
// where the treasury's floor sweeps buy — same URLs otchub's ArbitrageCard / HoldingsDetail use.
import { base44 } from "@/api/base44Client";

export const MAGIC_EDEN_ITEM = "https://magiceden.io/item-details";
/** Official OTC Desks collection slug on Magic Eden (mainnet). */
export const MAGIC_EDEN_COLLECTION_SLUG = "otc_desks";
/** OTC desks collection page on Magic Eden (mainnet slug). Hosts may override via HubProvider. */
export const DEFAULT_COLLECTION_URL = `https://magiceden.io/marketplace/${MAGIC_EDEN_COLLECTION_SLUG}`;
/** Official OTC Desks launch-curve mint (mainnet only — no devnet equivalent, see faucet.ts). */
export const OFFICIAL_MINT_URL = "https://otcdesks.cash/mint";
/** Official OTC Desks activation platform — the external/official alternative to this dashboard's
 *  native ACTIVATE_DESK flow (ActivateFlow.tsx), for users who prefer otcdesks.cash's own UI. */
export const OFFICIAL_DESKS_URL = "https://otcdesks.cash/desks";

export const magicEdenItemUrl = (asset: string) =>
  `${MAGIC_EDEN_ITEM}/${encodeURIComponent(asset)}`;

export const dexscreenerTokenUrl = (mint: string) =>
  `https://dexscreener.com/solana/${encodeURIComponent(mint)}`;

export const jupiterSwapUrl = (outputMint: string) =>
  `https://jup.ag/swap/SOL-${encodeURIComponent(outputMint)}`;

export type DeskListing = { seller: string; priceSol: number };

/**
 * Every currently-listed desk on Magic Eden, keyed by asset id — proxied through the
 * `getDeskListings` backend function (api-mainnet.magiceden.dev sends no CORS header, so the
 * browser can't call it directly; see that function's own comment for the full escrow-ownership
 * explanation). Mainnet only: the desk collection has no Magic Eden market on devnet. Best-effort
 * like the rest of this module — a failed lookup degrades to an empty map rather than throwing,
 * since a missed listing must never block the portfolio itself from loading.
 */
export async function fetchDeskListings(): Promise<Map<string, DeskListing>> {
  const map = new Map<string, DeskListing>();
  try {
    const res = await base44.functions.invoke("getDeskListings", {});
    const listings = res?.data?.listings;
    if (Array.isArray(listings)) {
      for (const l of listings) {
        if (l?.asset && l?.seller && typeof l?.priceSol === "number") {
          map.set(l.asset, { seller: l.seller, priceSol: l.priceSol });
        }
      }
    }
  } catch {
    // best-effort — see doc comment above
  }
  return map;
}