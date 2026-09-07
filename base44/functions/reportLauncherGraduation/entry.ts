import { PublicKey } from "npm:@solana/web3.js@1.98.4";
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { heliusRpc } from "../../shared/otcSources.ts";
import { createCurveAddressDeriver } from "../../shared/launcherCurve.js";
import { createGraduationVerifier, createLauncherGraduationStore } from "../../shared/launcherGraduates.ts";
import { createGraduationReportHandler } from "./handler.js";

// Browser-nominated AMM migrations enter the global ledger only after the
// mint's bonding curve is re-verified on-chain (complete flag) via Helius.
export default createGraduationReportHandler({
  verifyComplete: createGraduationVerifier({ rpc: heliusRpc, deriveCurveAddress: createCurveAddressDeriver(PublicKey) }),
  store: createLauncherGraduationStore(),
  createClient: (req) => createClientFromRequest(req),
});