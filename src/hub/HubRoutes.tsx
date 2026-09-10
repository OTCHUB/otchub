import { Navigate, Route, Routes } from "react-router-dom";
import { AirdropPage } from "./routes/AirdropPage";
import { Dashboard, type DashboardProps } from "./routes/Dashboard";
import { DeploymentsPage } from "./routes/DeploymentsPage";
import { DeskPage } from "./routes/DeskPage";
import { DripPage } from "./routes/DripPage";
import { MechanicsPage } from "./routes/MechanicsPage";
import { TokenomicsPage } from "./routes/TokenomicsPage";
import { TreasuryPage } from "./routes/TreasuryPage";

export type HubRoutesProps = DashboardProps;

/**
 * Relative routes — mount under any parent path, e.g. `<Route path="hub/*" element={<HubRoutes />} />`.
 * otchub mounts this twice (`/hub/*` and `/devnet/*`, see pages/Hub.jsx), unlike hubconnect's
 * standalone shell which mounts DripPage separately at a top-level `/drip` — nesting it here
 * instead keeps the faucet reachable (and route-relative-linked) under both otchub mounts.
 *   ""              dashboard (metrics · round progress · yield table · wallet portfolio)
 *   "treasury"      treasury transparency panel
 *   "tokenomics"    supply allocation (on-chain TokenomicsConfig) · airdrop · Dexscreener payload
 *   "mechanics"     activation lifecycle · fee flow · treasury flywheel · buyback/LP (Mermaid + docs)
 *   "deployments"   program / PDA / dependency registry with Solscan links
 *   "desk/:asset"   per-desk tier / unclaimed estimate
 *   "drip"          devnet-only faucet — see DripPage.tsx (self-gates on `cluster === "devnet"`)
 *   "airdrop"       §A7.1 genesis airdrop checker — reachable by direct link only, not yet in
 *                   Header.tsx's nav (see AirdropPage.tsx); it self-gates on-chain via
 *                   TokenomicsConfig.airdropRootSet until the snapshot is actually published.
 */
export function HubRoutes(props: HubRoutesProps) {
  return (
    <Routes>
      <Route index element={<Dashboard {...props} />} />
      <Route path="treasury" element={<TreasuryPage />} />
      <Route path="tokenomics" element={<TokenomicsPage />} />
      <Route path="mechanics" element={<MechanicsPage />} />
      <Route path="deployments" element={<DeploymentsPage />} />
      <Route path="airdrop" element={<AirdropPage />} />
      <Route path="drip" element={<DripPage />} />
      <Route path="desk/:asset" element={<DeskPage />} />
      <Route path="*" element={<Navigate to=".." relative="route" replace />} />
    </Routes>
  );
}
