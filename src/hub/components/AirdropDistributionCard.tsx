import { useState } from "react";
import { fmtBpPct, fmtHub, fmtNum } from "../lib/format";
import { useAirdropDistribution } from "../hooks/useAirdropDistribution";
import { AddressLink } from "./ui/AddressLink";
import { CollapsibleCard, Flag } from "./ui/Panel";

const TOP_N = 10;

type Props = {
  decimals: number;
  /** Ledger counters from TokenomicsConfig — used to cross-check the scanned receipts. */
  claimedUnits: bigint;
  claims: number;
};

/**
 * Per-address breakdown of the genesis airdrop, rebuilt from the on-chain `AirdropClaim`
 * receipts (one per desk) — answers "who actually got how much" without trusting an off-chain
 * list. Top 10 by default; expands to the full scrollable table.
 */
export function AirdropDistributionCard({ decimals, claimedUnits, claims }: Props) {
  const [expanded, setExpanded] = useState(false);
  const q = useAirdropDistribution(claims > 0);

  if (claims === 0) return null;
  return (
    <CollapsibleCard title="DISTRIBUTION BY ADDRESS" defaultOpen={false}>
      {q.isPending && <div className="text-xs text-green-700">scanning claim receipts…</div>}
      {q.error && <div className="text-xs text-red-400">{(q.error as Error).message}</div>}
      {q.data && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-green-700">
            <span>
              unique addresses <span className="text-green-300">{fmtNum(q.data.rows.length)}</span>
            </span>
            <span>
              receipts scanned <span className="text-green-300">{fmtNum(q.data.claims)}</span>
            </span>
            <span>
              paid out{" "}
              <span className="text-green-300">{fmtHub(q.data.totalUnits, decimals)}</span>
            </span>
            <Flag on={q.data.totalUnits === claimedUnits} label="SUM = LEDGER" />
          </div>
          <div className="text-[11px]">
            <div className="flex gap-2 border-b border-green-500/20 pb-1 text-[9px] uppercase tracking-widest text-green-700">
              <span className="w-8">#</span>
              <span className="flex-1">address</span>
              <span className="w-14 text-right">desks</span>
              <span className="w-24 text-right">$HUB paid</span>
              <span className="w-14 text-right">share</span>
            </div>
            <div className={expanded ? "max-h-96 overflow-auto" : ""}>
              {(expanded ? q.data.rows : q.data.rows.slice(0, TOP_N)).map((r, i) => (
                <div
                  key={r.owner}
                  className="flex items-center gap-2 border-b border-green-500/5 py-1 last:border-0"
                >
                  <span className="w-8 text-green-700">{i + 1}</span>
                  <span className="flex-1 truncate">
                    <AddressLink address={r.owner} />
                  </span>
                  <span className="w-14 text-right text-green-400">{fmtNum(r.desks)}</span>
                  <span className="w-24 text-right text-green-300">
                    {fmtHub(r.units, decimals, 1)}
                  </span>
                  <span className="w-14 text-right text-green-500">
                    {q.data.totalUnits > 0n
                      ? fmtBpPct(Number((r.units * 10_000n) / q.data.totalUnits))
                      : "—"}
                  </span>
                </div>
              ))}
            </div>
            {q.data.rows.length > TOP_N && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-1 text-[10px] text-green-500 hover:text-green-300"
              >
                {expanded
                  ? "▲ collapse"
                  : `▼ show all ${fmtNum(q.data.rows.length)} addresses`}
              </button>
            )}
          </div>
        </>
      )}
    </CollapsibleCard>
  );
}
