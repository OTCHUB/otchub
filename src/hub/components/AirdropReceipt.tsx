import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { listAirdropClaimsByOwner, type AirdropClaimView } from "@hub-sdk";
import { useHub } from "../HubProvider";
import { fmtHub, fmtNum, fmtUtc, shortKey } from "../lib/format";
import { AddressLink } from "./ui/AddressLink";

const MAX_TX_LINKS = 6;

type Row = AirdropClaimView & { tx: string | null };

/**
 * Connected wallet's genesis-airdrop receipts: "you received X $HUB across N desks" plus the
 * payment tx per receipt. The claim PDA is created inside the payment tx, so its earliest
 * signature IS the payment proof — no indexer needed. Hidden entirely when the wallet has none.
 */
export function AirdropReceipt({ address, decimals }: { address: string; decimals: number }) {
  const { connection, programId } = useHub();
  const q = useQuery({
    queryKey: ["hub", "airdrop-receipt", programId.toBase58(), connection.rpcEndpoint, address],
    enabled: !!address,
    staleTime: 300_000,
    queryFn: async (): Promise<{ rows: Row[]; totalUnits: bigint }> => {
      const claims = await listAirdropClaimsByOwner(connection, programId, new PublicKey(address));
      const rows = await Promise.all(
        claims.map(async (c): Promise<Row> => {
          const tx = await connection
            .getSignaturesForAddress(new PublicKey(c.claim), { limit: 1 }, "confirmed")
            .then((s) => s[0]?.signature ?? null)
            .catch(() => null);
          return { ...c, tx };
        }),
      );
      rows.sort((a, b) => a.claimedTs - b.claimedTs);
      return { rows, totalUnits: rows.reduce((s, r) => s + r.amountUnits, 0n) };
    },
  });

  if (!q.data || q.data.rows.length === 0) return null;
  const { rows, totalUnits } = q.data;
  const shown = rows.slice(0, MAX_TX_LINKS);

  return (
    <div className="mt-2 border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[9px] uppercase tracking-widest text-emerald-500">
          genesis airdrop · received
        </span>
        <span className="font-bold text-emerald-300">{fmtHub(totalUnits, decimals)}</span>
        <span className="text-green-600">
          across {fmtNum(rows.length)} desk{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="mt-1.5 space-y-0.5">
        {shown.map((r) => (
          <div key={r.claim} className="flex items-center gap-2 text-[10px]">
            <span className="text-green-700">{fmtUtc(r.claimedTs)}</span>
            <span className="flex-1 truncate text-green-500">
              desk <AddressLink address={r.asset} label={shortKey(r.asset, 4)} />
            </span>
            <span className="text-emerald-300">+{fmtHub(r.amountUnits, decimals, 0)}</span>
            {r.tx ? (
              <AddressLink address={r.tx} kind="tx" label="tx ↗" />
            ) : (
              <span className="text-green-800">tx…</span>
            )}
          </div>
        ))}
        {rows.length > shown.length && (
          <div className="pt-0.5 text-[9px] text-green-700">
            +{fmtNum(rows.length - shown.length)} more receipt(s) — same block range, all on-chain
            under your address
          </div>
        )}
      </div>
    </div>
  );
}
