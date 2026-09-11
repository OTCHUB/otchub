import { Link } from "react-router-dom";
import { DeskLookupPanel } from "../components/DeskLookupPanel";
import { Disclaimer } from "../components/Disclaimer";
import { EarningPreview } from "../components/EarningPreview";
import { EpochTracker } from "../components/EpochTracker";
import { DashboardTrends } from "../components/DashboardTrends";
import { HubBondingDashboard } from "../components/HubBondingDashboard";
import { HubIntro } from "../components/HubIntro";
import { MainnetPreviewPanel } from "../components/MainnetPreviewPanel";
import { MetricsStrip } from "../components/MetricsStrip";
import { ProtocolGate } from "../components/ProtocolGate";
import { WalletPanel } from "../components/WalletPanel";
import { useWallet } from "../WalletProvider";
import { Panel } from "../components/ui/Panel";
import { FlywheelDiagram } from "../components/ui/FlywheelDiagram";

export type DashboardProps = {
  rawDeskDailyLamports?: number;
  /** Host-connected wallet (otchub); when set the module skips its own connect UI. */
  walletAddress?: string;
};

export function Dashboard({ rawDeskDailyLamports, walletAddress }: DashboardProps) {
  const wallet = useWallet();
  const address = walletAddress ?? wallet.address;

  return (
    <div className="space-y-2 font-mono">
      {/* The whole $HUB pitch in one glance — above the gate so it renders instantly. */}
      <HubIntro />
      <ProtocolGate>
        {(state, fetchedAt) => (
          <>
            {/* The eight key numbers as one strip right under the intro. */}
            <MetricsStrip state={state} />

            {/* Two-lane flow: the wallet journey (connect → portfolio → claim → activate →
                M.I.M ETF) beside the trading surface — side by side on desktop, stacked on
                mobile, so one screen carries the whole first decision. */}
            <div className="grid items-start gap-2 lg:grid-cols-2">
              <div id="hub-wallet" className="min-w-0">
                <WalletPanel state={state} walletAddress={walletAddress} />
              </div>
              <div className="min-w-0">
                <HubBondingDashboard state={state} address={address} />
              </div>
            </div>

            <EpochTracker state={state} />
            <DashboardTrends state={state} />
            <EarningPreview state={state} rawDeskDailyLamports={rawDeskDailyLamports} />

            <Panel
              title="THE $HUB FLYWHEEL"
              right={
                <Link to="mechanics" className="underline hover:text-green-300">
                  full mechanics →
                </Link>
              }
            >
              <p className="mb-2 text-xs leading-relaxed text-green-400/90">
                Activate a desk, earn every round, buy back &amp; burn $HUB — click any node.
              </p>
              <FlywheelDiagram />
            </Panel>

            {/* Secondary tooling — collapsed by default to keep the page light. */}
            <Panel title="DESK LOOKUP" collapsible defaultCollapsed>
              <DeskLookupPanel state={state} />
            </Panel>
            <MainnetPreviewPanel />

            <div className="flex justify-between text-[10px] text-green-700">
              <span>last read {new Date(fetchedAt).toLocaleTimeString()}</span>
              <span className="flex gap-3">
                <Link to="tokenomics" className="underline hover:text-green-300">
                  tokenomics →
                </Link>
                <Link to="treasury" className="underline hover:text-green-300">
                  treasury transparency →
                </Link>
              </span>
            </div>
          </>
        )}
      </ProtocolGate>
      <Disclaimer />
    </div>
  );
}