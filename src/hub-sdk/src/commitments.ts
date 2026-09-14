// Pinned post-launch mainnet commitments (landed 2026-09-13, snapshot slot 446811667).
// Every value is a public address / tx id the UI renders as a verifiable link — the "prove it"
// layer behind the tokenomics & treasury panels. Update only when a new commitment action lands.

/** Treasury governance: Squads v4 multisig (threshold 2-of-3). The vault holds treasury funds
 *  and the fee-claim NFTs of the locked SOL/USDC pools; program authority rotation targets it. */
export const SQUADS_MULTISIG = {
  account: "FTxuTCp6zjih1wd7e9pxS9rebC6hH3cfuAJDtKdXRr99",
  vault: "qezk9nmtKfaPtceHhtjZfVu4FpAashnsKif9NSBFtrG",
  threshold: "2-of-3",
  url: "https://app.squads.so/squads/qezk9nmtKfaPtceHhtjZfVu4FpAashnsKif9NSBFtrG/treasury",
} as const;

/** Team allocation lockup — Streamflow vesting contract. Immutable: cancelable/transferable
 *  flags are all false on-chain; releases monthly over 24 months with a 3-month cliff
 *  (first unlock 2026-12-12). Recipient is the Squads vault, not a person. */
export const TEAM_VESTING = {
  amountHub: 85_000_000,
  months: 24,
  cliffMonths: 3,
  cliffDate: "2026-12-12",
  contract: "9RC1d3Qd2LZqtJtNVLcCismx1q3LBar9XGFQiFdHkYTq",
  createTx: "apGyq9SATKVenAgttrAjCM4S87BFVHw3FuToLDZocjUDswLpw6m2GEyE1FwqDcL5P3DQUntcu9F1Ho1KwsZyVom",
  url: "https://app.streamflow.finance/contract/solana/mainnet/9RC1d3Qd2LZqtJtNVLcCismx1q3LBar9XGFQiFdHkYTq",
  recipient: "qezk9nmtKfaPtceHhtjZfVu4FpAashnsKif9NSBFtrG",
} as const;

/** The team's remaining liquid wallet — published so its balance is watched, not trusted. */
export const TEAM_WALLET = {
  address: "7Z49tNXPqS4uKMXxACwwWkyVhhycGfaLZaqFyso9ouSR",
  label: "team liquid wallet (disclosed)",
} as const;

/** Supply burns beyond the protocol's own buyback-burn flywheel. */
export const BURN_ACTIONS = [
  {
    label: "team supply burn — 200,000,000 $HUB",
    tx: "3N5JtSobZ77yJ6js1SGMWcHmNJuKx85Tzvj6f56L4qiBUqbWP2dLr7jALibAV1M9aMYvc48XHRViBhGWvLbyWmFY",
  },
  {
    label: "deployer wallet burn — 2,259,371.746 $HUB (full balance)",
    tx: "QCGWf1z2KnEZpVML666kq15YfuDFyXD5yWZBqTJPuQUZoy3BPzy53NkfwhYsJg9q9ikjKW3Y82vBznbuDztj7Hn",
  },
] as const;

export type LpLock = {
  pair: string;
  venue: string;
  pool: string;
  /** Raydium Burn & Earn lock tx — LP tokens burned, permanent fee-claim NFT minted. */
  lockTx: string;
  feeNft: string;
  /** Who holds the fee-claim NFT (fees only — the liquidity itself can never be withdrawn). */
  feeNftOwner: string;
  note: string;
};

/** 100% of every team-created pool's LP, permanently locked via Raydium `lock_cp_liquidity`. */
export const LP_LOCKS: LpLock[] = [
  {
    pair: "HUB/SOL",
    venue: "Raydium CPMM",
    pool: "3z5f7kMmxoTdiuSqwkq5qaoANg3M6VVXJQkaxPsLdgFf",
    lockTx: "2tuyPmJWL9LSTEV9wLvvW5BE6vcTmXzc13j9oStXrLg6AyNibv9CAktXWDvQjh44xoYhpatgwbD8Mf2ucm9pQ4ML",
    feeNft: "BVghWFHaNUiXC46Nq6a94GqCSxDr4vMMRt7cbJiy5ZmZ",
    feeNftOwner: SQUADS_MULTISIG.vault,
    note: "fees → treasury multisig",
  },
  {
    pair: "HUB/USDC",
    venue: "Raydium CPMM",
    pool: "BrconjFBxBxTHSJcE93tNteY7usiJQfYDt65SCyEbZmX",
    lockTx: "4Gubodv9WwQR1ecQQC9AGzorP6Rohae3zun5XjtWWrJJPiPooYsT4N7i7oXRHEvuBMXD6uMJbzMNJqoaPXWEeSBF",
    feeNft: "7j4cPxpKTBkAR9PDDADMxDaCEu1vwkkXnTANNFgciRXA",
    feeNftOwner: SQUADS_MULTISIG.vault,
    note: "fees → treasury multisig",
  },
  {
    pair: "HUB/OTC",
    venue: "Raydium CPMM",
    pool: "F6DV5evzbqtiUgz6EnmimXTGQWnN7JVsaLSodoCD6zeR",
    lockTx: "5SqzJ3fFKnzB9YSCXwNuvC9u4Lu7RrBDt6MsLXNXRoUMEEd8BxwK2twm6cAixWuUVHfVPrhowcayWBDZaccYw6NG",
    feeNft: "3Kwp7yXyMqayfX5XsUXAHTT5hUS6oH3pHTvVkaM4PcSw",
    feeNftOwner: "7j5e3R2XpVo9dxDjM66qJ3K4Hokz6Rj7s4uT4WWKkbVP",
    note: "fees → protocol vault → desk holders",
  },
];

/** Graduation pool (created by the launch curve migration; LP held by the launcher program
 *  itself — no team withdrawal path exists). Listed for completeness of the pool picture. */
export const PUMPSWAP_POOL = {
  pair: "HUB/SOL",
  venue: "PumpSwap (graduation)",
  pool: "DyrnXTzRu6KGqCfG1VH1EYH3hqJB8vowp2Cyt1zpTzoE",
  note: "deepest venue · LP locked by the launcher program",
} as const;

/** Genesis airdrop distribution facts (counters themselves are read live off TokenomicsConfig). */
export const AIRDROP_RUN = {
  snapshotSlot: 446_811_667,
  desks: 2_239,
  perDeskHub: 10_000,
  note: "distributed directly to each desk's live owner — no claim tx required",
} as const;
