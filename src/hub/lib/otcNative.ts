// Native OTC Desks program (otcdesks.cash) recognition check for $HUB desk cards.
//
// The official OTC Desks program keeps a per-desk payout vault PDA — seeds
// ["vault", asset] under the OTC program, verified on-chain; the same
// derivation the main app's claim tool uses (see src/lib/otcClaim.js and
// base44/shared/vaultBalances.ts). A desk whose vault exists on-chain is
// "natively activated": the OTC program recognizes it and streams its native
// desk-pot payouts into that vault. $HUB tiers sit ON TOP of that native
// yield, so the wallet grid shows both signals per desk — $HUB tier status
// plus this native OTC check.

import { PublicKey, type Connection } from "@solana/web3.js";
import { nativeYieldMockPda } from "@hub-sdk";

export const OTC_DESKS_PROGRAM_ID = new PublicKey(
  "AjMx5My4YUDHMiCtLpTAtgkiUJgrpJnQqd5AcQnddHQW",
);

/** Per-desk payout vault PDA under the official OTC Desks program. */
export function otcVaultPda(asset: string): PublicKey {
  // TextEncoder's utf-8 bytes for "vault" match Buffer.from("vault") exactly.
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("vault"), new PublicKey(asset).toBuffer()],
    OTC_DESKS_PROGRAM_ID,
  )[0];
}

/** Vault existence per asset id — one `getMultipleAccounts` per 100 desks.
 *  Mainnet only: the OTC program has no devnet deployment, so callers skip
 *  this off mainnet-beta (desk cards then hide the badge instead of guessing).
 *  Never throws: a failed RPC batch degrades its slice to "not seen". */
export async function fetchOtcNativeActive(
  connection: Connection,
  assetIds: string[],
): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  const ids = [...new Set(assetIds)].filter((a) => {
    try {
      new PublicKey(a);
      return true;
    } catch {
      return false;
    }
  });
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100).map((id) => otcVaultPda(id));
    const accounts = await connection
      .getMultipleAccountsInfo(slice)
      .catch(() => slice.map(() => null));
    for (let j = 0; j < accounts.length; j++) out.set(ids[i + j], !!accounts[j]);
  }
  return out;
}

/**
 * Devnet-only stand-in for `fetchOtcNativeActive` above — the real OTC Desks program has no
 * devnet deployment, so devnet reads `NativeYieldMock` (see hubconnect's `sdk/src/pda.ts`)
 * instead: a plain system-owned lamport PDA per desk, provisioned by
 * `scripts/devnet-native-yield-init.ts` and topped up by `scripts/devnet-native-yield-drip.ts`
 * to simulate ongoing native yield accrual. Same batching/never-throws contract as the mainnet
 * check. `hubProgramId` is `Config`'s program id (the mock PDA is derived under it, not
 * `OTC_DESKS_PROGRAM_ID`).
 */
export async function fetchDevnetNativeYieldMock(
  connection: Connection,
  hubProgramId: PublicKey,
  assetIds: string[],
): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  const ids = [...new Set(assetIds)].filter((a) => {
    try {
      new PublicKey(a);
      return true;
    } catch {
      return false;
    }
  });
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100).map((id) => nativeYieldMockPda(hubProgramId, new PublicKey(id))[0]);
    const accounts = await connection
      .getMultipleAccountsInfo(slice)
      .catch(() => slice.map(() => null));
    for (let j = 0; j < accounts.length; j++) out.set(ids[i + j], !!accounts[j]);
  }
  return out;
}

/**
 * Cluster-dispatching "native active" check: the real check on mainnet-beta, the
 * `NativeYieldMock` devnet stand-in on devnet, `null` (not checked) on any other cluster
 * (localnet/testnet) — mirrors the `cluster === "mainnet-beta"` gate `useWalletPortfolio`
 * previously applied inline.
 */
export async function fetchNativeActive(
  connection: Connection,
  hubProgramId: PublicKey,
  cluster: string,
  assetIds: string[],
): Promise<Map<string, boolean> | null> {
  if (cluster === "mainnet-beta") return fetchOtcNativeActive(connection, assetIds);
  if (cluster === "devnet") return fetchDevnetNativeYieldMock(connection, hubProgramId, assetIds);
  return null;
}