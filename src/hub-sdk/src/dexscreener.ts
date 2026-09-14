// Dexscreener "Enhanced Token Info" (paid token info) submission payload — everything the form
// asks for (description, links, images) plus the supply facts reviewers verify on-chain. Numbers
// are whole $HUB (strings, so bigint precision survives JSON); addresses are the proof accounts.
// The ETI form is filled by hand — this object is the single source the operator copies from.
import { LP_LOCKS, SQUADS_MULTISIG, TEAM_VESTING } from "./commitments";
import { HUB_DECIMALS, TIER_NAMES, type TokenomicsPlan } from "./constants";
import type { ProtocolState, TokenomicsView } from "./reader";

export type DexscreenerLink = {
  type: "website" | "twitter" | "telegram" | "discord" | "docs" | "other";
  label?: string;
  url: string;
};

export type DexscreenerTokenInfo = {
  chainId: "solana";
  tokenAddress: string;
  name: string;
  symbol: string;
  decimals: number;
  description: string;
  links: DexscreenerLink[];
  /** Metaplex metadata `uri` — icon/header images are served from its `image` field. */
  metadataUri: string | null;
  supply: {
    total: string;
    circulating: string;
    burned: string;
    locked: string;
    lockedAccounts: { label: string; owner: string; tokenAccount: string; amount: string }[];
    /** Mint authority revoked ⇒ fixed supply. */
    fixedSupply: boolean;
    burnLedger: string;
  };
  allocations: {
    id: string;
    label: string;
    amount: string;
    percent: string;
    source: "on-chain" | "preview";
  }[];
  /** Post-launch commitment proofs (2026-09-13): every team-created pool's LP permanently
   *  locked via Raydium Burn & Earn — LP burned, fee-claim NFT minted to the named owner. */
  permanentLiquidityLocks: {
    pair: string;
    pool: string;
    lockTx: string;
    feeNft: string;
    feeNftOwner: string;
  }[];
  /** Immutable Streamflow team vesting contract (cancelable/transferable flags all false). */
  teamVesting: {
    amount: string;
    months: number;
    cliffMonths: number;
    contract: string;
    recipient: string;
  };
  airdrop: {
    perDesk: string;
    deskCount: number;
    total: string;
    claimed: string;
    claims: number;
    rootHex: string | null;
    open: boolean;
  } | null;
  tiers: { name: string; weight: string }[];
  generatedAt: string;
};

const whole = (units: bigint, decimals = HUB_DECIMALS) =>
  (units / 10n ** BigInt(decimals)).toString();
const pct = (bp: number) => `${(bp / 100).toFixed(2)}%`;

export type DexscreenerInputs = {
  state: ProtocolState;
  /** On-chain plan when recorded; otherwise the fixed launch-policy-target preview. */
  tokenomics: TokenomicsView | null;
  plan: TokenomicsPlan;
  links?: DexscreenerLink[];
  description?: string;
  burnPda: string;
};

const DEFAULT_DESCRIPTION =
  "$HUB is the stake-to-earn layer for OTC desk NFTs. Desk owners activate a tier (TRADER → MARKET MAKER) " +
  "and share a SOL pot fed by protocol fees; every closed round buys back and burns $HUB. Post-launch " +
  `commitments (2026-09-13): 25.9% of genesis supply burned, 100% of team LP permanently locked ` +
  `(fee-claim only), team allocation locked in an immutable 24-month Streamflow vesting contract, ` +
  `treasury held in a ${SQUADS_MULTISIG.threshold} Squads multisig. Mint authority revoked — supply only moves down.`;

export function dexscreenerTokenInfo(i: DexscreenerInputs): DexscreenerTokenInfo {
  const { state, tokenomics, plan } = i;
  const d = state.supply.decimals;
  const source = tokenomics ? "on-chain" : "preview";
  const allocations = plan.slices.map((s) => ({
    id: s.id,
    label: s.label,
    amount: whole(s.units, d),
    percent: pct(s.bp),
    source: source as "on-chain" | "preview",
  }));
  return {
    chainId: "solana",
    tokenAddress: state.config.hubMint,
    name: state.token.metadata?.name ?? "HUB",
    symbol: state.token.metadata?.symbol ?? "HUB",
    decimals: d,
    description: i.description ?? DEFAULT_DESCRIPTION,
    links: i.links ?? [],
    metadataUri: state.token.metadata?.uri ?? null,
    supply: {
      total: whole(state.supply.maxUnits, d),
      circulating: whole(state.supply.circulatingUnits, d),
      burned: whole(state.supply.burnedUnits, d),
      locked: whole(state.supply.lockedUnits, d),
      lockedAccounts: state.token.holdings
        .map((h) => ({
          label:
            h.owner === state.config.treasury
              ? `Treasury — Squads ${SQUADS_MULTISIG.threshold} multisig vault`
              : "Program vault PDA (airdrop + POL custody)",
          owner: h.owner,
          tokenAccount: h.ata,
          amount: whole(h.units, d),
        }))
        .concat([
          {
            label: `Team vesting — Streamflow immutable contract (${TEAM_VESTING.months}mo, ${TEAM_VESTING.cliffMonths}mo cliff)`,
            owner: TEAM_VESTING.recipient,
            tokenAccount: TEAM_VESTING.contract,
            amount: String(TEAM_VESTING.amountHub),
          },
        ]),
      fixedSupply: state.token.mint?.mintAuthority === null,
      burnLedger: i.burnPda,
    },
    allocations,
    permanentLiquidityLocks: LP_LOCKS.map((l) => ({
      pair: l.pair,
      pool: l.pool,
      lockTx: l.lockTx,
      feeNft: l.feeNft,
      feeNftOwner: l.feeNftOwner,
    })),
    teamVesting: {
      amount: String(TEAM_VESTING.amountHub),
      months: TEAM_VESTING.months,
      cliffMonths: TEAM_VESTING.cliffMonths,
      contract: TEAM_VESTING.contract,
      recipient: TEAM_VESTING.recipient,
    },
    airdrop: tokenomics
      ? {
          perDesk: whole(tokenomics.airdropPerDeskUnits, d),
          deskCount: tokenomics.snapshotDeskCount,
          total: whole(tokenomics.airdropUnits, d),
          claimed: whole(tokenomics.airdropClaimedUnits, d),
          claims: tokenomics.airdropClaims,
          rootHex: tokenomics.airdropRootSet ? tokenomics.airdropRoot : null,
          open: tokenomics.airdropOpen,
        }
      : {
          perDesk: whole(plan.airdropPerDeskUnits, d),
          deskCount: plan.airdropEligibleDeskCount,
          total: whole(plan.airdropUnits, d),
          claimed: "0",
          claims: 0,
          rootHex: null,
          open: false,
        },
    tiers: TIER_NAMES.map((name, idx) => ({
      name,
      weight: `${(state.config.tierWeightsBp[idx] / 10_000).toFixed(2)}x`,
    })),
    generatedAt: new Date().toISOString(),
  };
}
