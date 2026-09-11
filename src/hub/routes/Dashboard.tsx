import { Link } from "react-router-dom";
import { DashboardTrends } from "../components/DashboardTrends";
import { DeskLookupPanel } from "../components/DeskLookupPanel";
import { Disclaimer } from "../components/Disclaimer";
import { EarningPreview } from "../components/EarningPreview";
import { EpochTracker } from "../components/EpochTracker";
import { HubBondingDashboard } from "../components/HubBondingDashboard";
import { HubIntro } from "../components/HubIntro";
import { MainnetPreviewPanel } from "../components/MainnetPreviewPanel";
import { MetricsStrip } from "../components/MetricsStrip";
import { ProtocolGate } from "../components/ProtocolGate";
import { WalletPanel } from "../components/WalletPanel";
import { useHub } from "../HubProvider";
import { useWallet } from "../WalletProvider";
import { Panel } from "../components/ui/Panel";

export type DashboardProps = {
  rawDeskDailyLamports?: number;
  /** Host-connected wallet (otchub); when set the module skips its own connect UI. */
  walletAddress?: string;
};

export function Dashboard({ rawDeskDailyLamports, walletAddress }: DashboardProps) {
  const wallet = useWallet();
  const address = walletAddress ?? wallet.address;
  const { cluster } = useHub();

  return (
    <div className="space-y-2 font-mono">
      {/* The whole $HUB pitch in one glance — above the gate so it renders instantly. */}
      <HubIntro />
      <ProtocolGate>
        {(state, fetchedAt) => (
          <>
            {/* The eight key numbers as one strip right under the intro. */}
            <MetricsStrip state={state} />

            {/* Two-lane flow: the compact wallet surface (connect → balances → desk grid, with
                every per-desk action in the DeskSheet the grid opens) beside the trading
                surface — side by side on desktop, stacked on mobile. */}
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
            <div id="hub-yield">
              <EarningPreview state={state} rawDeskDailyLamports={rawDeskDailyLamports} />
            </div>

            {/* Secondary tooling — collapsed by default to keep the page light. */}
            <div id="hub-desk-lookup">
              <Panel title="DESK LOOKUP" collapsible defaultCollapsed>
                <DeskLookupPanel state={state} />
              </Panel>
            </div>
            {/* QA tool — devnet sandbox only; never surfaces on the mainnet dashboard. */}
            {cluster === "devnet" && <MainnetPreviewPanel />}

            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[10px] text-green-700">
              <span>last read {new Date(fetchedAt).toLocaleTimeString()}</span>
              <span className="flex gap-3">
                <Link to="mechanics" className="underline hover:text-green-300">
                  mechanics →
                </Link>
                <Link to="tokenomics" className="underline hover:text-green-300">
                  tokenomics →
                </Link>
                <Link to="treasury" className="underline hover:text-green-300">
                  treasury →
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