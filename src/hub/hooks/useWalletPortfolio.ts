import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import {
  fetchDeskTier,
  fetchOwnedDesks,
  pendingYieldLamports,
  type DeskTierView,
  type ProtocolState,
} from "@hub-sdk";
import { useHub } from "../HubProvider";
import { fetchDeskArtBatch, type DeskAssetArt } from "../lib/das";
import { fetchDeskListings, type DeskListing } from "../lib/marketplace";
import { fetchNativeActive } from "../lib/otcNative";
import { yieldBoostPctOverBase } from "../lib/yield";

export type OwnedDesk = {
  asset: string;
  tier: DeskTierView | null;
  /** NFT artwork/name via DAS; null when the RPC has no DAS support or the lookup failed. */
  art: DeskAssetArt | null;
  /** ⌊(acc − stamp) × w / 10¹²⌋ right now — 0 for raw/voided desks. */
  pendingLamports: number;
  /** Whole-percent yield boost vs the base (T1) tier weight — 0 for raw/voided desks. */
  yieldBoostPct: number;
  /** True when the desk's payout vault exists on-chain in the official OTC Desks program
   *  (natively activated — see lib/otcNative), or (devnet) its `NativeYieldMock` stand-in.
   *  null = not checked (unsupported cluster, e.g. localnet). */
  nativeActive: boolean | null;
  /** Non-null when this desk is currently listed for sale on Magic Eden by this wallet — its
   *  on-chain Core `owner` has moved to ME's escrow PDA (see lib/marketplace's
   *  `fetchDeskListings`), so `activate`/`upgrade`/`claim` will fail on-chain (signer ≠ owner)
   *  until it's delisted. null = not listed (or listings couldn't be checked). */
  listedPriceSol: number | null;
};

export type WalletPortfolio = {
  solLamports: number;
  /** Raw $HUB units (mint decimals applied) — null when the wallet holds no token account. */
  hubBalance: number | null;
  desks: OwnedDesk[];
};

export function useWalletPortfolio(address: string | null, state: ProtocolState | null) {
  const { connection, program, programId, cluster } = useHub();
  const owner = (() => {
    try {
      return address ? new PublicKey(address) : null;
    } catch {
      return null;
    }
  })();

  return useQuery({
    queryKey: ["hub", "wallet", programId.toBase58(), connection.rpcEndpoint, owner?.toBase58()],
    enabled: owner !== null && state !== null,
    queryFn: async (): Promise<WalletPortfolio> => {
      const hubMint = new PublicKey(state!.config.hubMint);
      const collection = new PublicKey(state!.config.deskCollection);
      const [solLamports, tokenAccounts, ownedAssets, listings] = await Promise.all([
        connection.getBalance(owner!),
        connection.getParsedTokenAccountsByOwner(owner!, { mint: hubMint }).catch(() => null),
        fetchOwnedDesks(connection, owner!, collection),
        // Mainnet only — the desk collection has no Magic Eden market on devnet, and a listed
        // desk's on-chain owner (ME's escrow PDA) would never match `owner` above anyway.
        cluster === "mainnet-beta"
          ? fetchDeskListings()
          : Promise.resolve(new Map<string, DeskListing>()),
      ]);
      const hubBalance =
        tokenAccounts && tokenAccounts.value.length
          ? tokenAccounts.value.reduce(
              (s, t) => s + Number(t.account.data.parsed.info.tokenAmount.uiAmount ?? 0),
              0,
            )
          : null;
      const ownerBase58 = owner!.toBase58();
      // A listed desk's Core `owner` field is ME's escrow PDA, not this wallet — `fetchOwnedDesks`
      // (a raw getProgramAccounts owner filter) can never see it. Cross-reference Magic Eden's own
      // listings, which still report the real seller, and add back any desk this wallet listed
      // that the on-chain scan above missed (see lib/marketplace's `fetchDeskListings` doc comment
      // for how this was verified against desks #1608/#1838).
      const ownedKeys = ownedAssets.map((a) => a.toBase58());
      const ownedSet = new Set(ownedKeys);
      const listedByThisWallet = [...listings.entries()].filter(
        ([asset, l]) => l.seller === ownerBase58 && !ownedSet.has(asset),
      );
      const assetKeys = [...ownedKeys, ...listedByThisWallet.map(([asset]) => asset)];
      const listedPriceByAsset = new Map(
        listedByThisWallet.map(([asset, l]) => [asset, l.priceSol]),
      );
      const [tiers, artByAsset, otcNative] = await Promise.all([
        Promise.all(assetKeys.map((a) => fetchDeskTier(program, new PublicKey(a)))),
        fetchDeskArtBatch(connection.rpcEndpoint, assetKeys),
        // Native OTC Desks activation check — the real program on mainnet, the
        // `NativeYieldMock` stand-in on devnet (see lib/otcNative); null elsewhere.
        fetchNativeActive(connection, programId, cluster, assetKeys),
      ]);
      const desks: OwnedDesk[] = assetKeys.map((asset, i) => {
        const tier = tiers[i];
        const active = tier && !tier.voided;
        return {
          asset,
          tier,
          art: artByAsset[asset] ?? null,
          pendingLamports: active ? pendingYieldLamports(tier, state!.config) : 0,
          yieldBoostPct: active ? yieldBoostPctOverBase(tier.tier) : 0,
          nativeActive: otcNative ? (otcNative.get(asset) ?? false) : null,
          listedPriceSol: listedPriceByAsset.get(asset) ?? null,
        };
      });
      return { solLamports, hubBalance, desks };
    },
  });
}