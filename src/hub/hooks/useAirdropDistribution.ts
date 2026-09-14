import { useQuery } from "@tanstack/react-query";
import { listAirdropClaims } from "@hub-sdk";
import { useHub } from "../HubProvider";

export type AirdropOwnerRow = {
  owner: string;
  desks: number;
  units: bigint;
  lastTs: number;
};

export type AirdropDistribution = {
  rows: AirdropOwnerRow[];
  totalUnits: bigint;
  claims: number;
};

/**
 * Per-address breakdown of the completed genesis airdrop: groups every on-chain `AirdropClaim`
 * receipt by the address that was paid (the desk's owner at payment time), sorted by $HUB
 * received. Only fetched once claims exist on-chain; 5-minute staleness — these accounts are
 * write-once, so results barely move.
 */
export function useAirdropDistribution(enabled: boolean) {
  const { connection, programId } = useHub();
  return useQuery({
    queryKey: ["hub", "airdrop-distribution", programId.toBase58(), connection.rpcEndpoint],
    enabled,
    staleTime: 300_000,
    queryFn: async (): Promise<AirdropDistribution> => {
      const claims = await listAirdropClaims(connection, programId);
      const byOwner = new Map<string, AirdropOwnerRow>();
      for (const c of claims) {
        const row = byOwner.get(c.claimant) ?? { owner: c.claimant, desks: 0, units: 0n, lastTs: 0 };
        row.desks += 1;
        row.units += c.amountUnits;
        row.lastTs = Math.max(row.lastTs, c.claimedTs);
        byOwner.set(c.claimant, row);
      }
      const rows = [...byOwner.values()].sort((a, b) =>
        b.units > a.units ? 1 : b.units < a.units ? -1 : b.desks - a.desks,
      );
      return {
        rows,
        totalUnits: rows.reduce((s, r) => s + r.units, 0n),
        claims: claims.length,
      };
    },
  });
}
