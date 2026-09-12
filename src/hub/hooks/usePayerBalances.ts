import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { ataPda, TOKEN_2022_PROGRAM_ID } from "@hub-sdk";
import { useHub } from "../HubProvider";

export type PayerBalances = {
  solLamports: bigint;
  /** Base units in the standard $OTC ATA; null when the account does not exist. */
  otcUnits: bigint | null;
  otcDecimals: number | null;
  /** The SPL token program that actually owns `otcMint` on this cluster, resolved live off the
   * mint account itself — never assume Token-2022: mainnet's real $OTC launch mint is
   * Token-2022, but devnet's mock $OTC mint (see `devnet-otc-mint.ts`) is classic Token. Getting
   * this wrong derives the wrong ATA address, which silently reads back as "no balance" even
   * when the wallet holds the token. */
  otcTokenProgram: string | null;
  /** Base units in the standard $HUB ATA; null when the account does not exist. Every
   * `activate_tier` / `upgrade_tier` call (SOL or $OTC path) burns from this account. */
  hubUnits: bigint | null;
  hubDecimals: number | null;
};

/** Raw SOL + $OTC + $HUB (standard ATAs) balances for the activate/upgrade panel — bigint, never
 * floats. `hubMint` is needed because every tier change burns $HUB regardless of pay method.
 * `hubTokenProgram` must be whichever token program actually owns `hubMint` on this cluster
 * (`ProtocolState.token.hubTokenProgram`, resolved live) — it differs between devnet's classic
 * harness mint and mainnet's real Token-2022 launch mint, so it defaults to classic only as a
 * last resort when the caller hasn't loaded protocol state yet. `otcMint`'s owning program is
 * resolved live here too (see `otcTokenProgram` on the return type) rather than assumed. */
export function usePayerBalances(
  address: string | null,
  otcMint: string | null,
  hubMint: string | null,
  hubTokenProgram?: string | null,
) {
  const { connection } = useHub();
  return useQuery({
    queryKey: [
      "hub",
      "payer-balances",
      connection.rpcEndpoint,
      address,
      otcMint,
      hubMint,
      hubTokenProgram,
    ],
    enabled: !!address && !!otcMint && !!hubMint,
    refetchInterval: 20_000,
    queryFn: async (): Promise<PayerBalances> => {
      const owner = new PublicKey(address!);
      const otcMintKey = new PublicKey(otcMint!);
      const otcMintInfo = await connection.getAccountInfo(otcMintKey, "confirmed").catch(() => null);
      const otcTokenProgram = otcMintInfo ? otcMintInfo.owner : new PublicKey(TOKEN_2022_PROGRAM_ID);
      const [otcAta] = ataPda(owner, otcMintKey, otcTokenProgram);
      const [hubAta] = ataPda(owner, new PublicKey(hubMint!), hubTokenProgram ?? undefined);
      const [sol, otcTok, hubTok] = await Promise.all([
        connection.getBalance(owner, "confirmed"),
        connection.getTokenAccountBalance(otcAta, "confirmed").catch(() => null),
        connection.getTokenAccountBalance(hubAta, "confirmed").catch(() => null),
      ]);
      return {
        solLamports: BigInt(sol),
        otcUnits: otcTok ? BigInt(otcTok.value.amount) : null,
        otcDecimals: otcTok?.value.decimals ?? null,
        otcTokenProgram: otcTokenProgram.toBase58(),
        hubUnits: hubTok ? BigInt(hubTok.value.amount) : null,
        hubDecimals: hubTok?.value.decimals ?? null,
      };
    },
  });
}
