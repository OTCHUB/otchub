import type { ProtocolState } from "@hub-sdk";
import { useTokenomics } from "../hooks/useTokenomics";
import { useTreasuryPortfolio } from "../hooks/useTreasuryPortfolio";
import { fmtBp, lamportsToSol, unitsToTokens } from "../lib/format";
import { HubEarningsChart } from "./HubEarningsChart";
import { HubSupplyChart } from "./HubSupplyChart";
import { Panel } from "./ui/Panel";
import { PieChart, type PieSlice } from "./ui/PieChart";

/** Dashboard trends row — the protocol's story told in charts instead of tables: supply drawdown
 *  (desk growth vs $HUB circulating), treasury TVL vs reward distribution, and the round-split
 *  donut. Reuses the same hooks/queries the tokenomics & treasury pages run (shared query keys,
 *  so no extra chain load once either page has been visited). */
export function DashboardTrends({ state }: { state: ProtocolState }) {
  const tokenomics = useTokenomics(state);
  const treasury = useTreasuryPortfolio(state);
  const d = state.supply.decimals;

  const liveDeskCount = tokenomics.data?.collection
    ? tokenomics.data.collection.currentSize
    : null;
  const liveCirculatingHub = unitsToTokens(state.supply.circulatingUnits, d);
  const liveTvlSol = treasury.data ? lamportsToSol(treasury.data.solLamports) : null;
  const liveDistributedHub = treasury.data
    ? unitsToTokens(treasury.data.rewardDistributedUnits, d)
    : null;

  const { config } = state;
  const stakerBp = 10_000 - config.burnPctBp - config.lpPctBp - config.treasuryFloatPctBp;
  const splitSlices: PieSlice[] = [
    {
      id: "stakers",
      label: "DESK STAKERS",
      value: stakerBp,
      color: "#22c55e",
      share: fmtBp(stakerBp, 0),
      amount: "pro-rata by tier",
    },
    {
      id: "burn",
      label: "$HUB BURN",
      value: config.burnPctBp,
      color: "#f59e0b",
      share: fmtBp(config.burnPctBp, 0),
      amount: "buy & destroy",
    },
    {
      id: "treasury",
      label: "TREASURY",
      value: config.treasuryFloatPctBp,
      color: "#22d3ee",
      share: fmtBp(config.treasuryFloatPctBp, 0),
      amount: "buy-and-hold float",
    },
    {
      id: "lp",
      label: "$HUB/$OTC LP",
      value: config.lpPctBp,
      color: "#a855f7",
      share: fmtBp(config.lpPctBp, 0),
      amount: "liquidity seed",
    },
  ];

  return (
    <div className="grid items-start gap-2 lg:grid-cols-2">
      <HubSupplyChart liveDeskCount={liveDeskCount} liveCirculatingHub={liveCirculatingHub} />
      <HubEarningsChart liveTvlSol={liveTvlSol} liveDistributedHub={liveDistributedHub} />
      <Panel title="ROUND SPLIT :: WHERE EVERY ROUND GOES" className="lg:col-span-2">
        <PieChart
          slices={splitSlices}
          centerLabel={fmtBp(stakerBp, 0)}
          centerSub="to stakers"
        />
      </Panel>
    </div>
  );
}