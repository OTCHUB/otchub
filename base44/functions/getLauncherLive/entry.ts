import { PublicKey } from "npm:@solana/web3.js@1.98.4";
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { heliusRpc } from "../../shared/otcSources.ts";
import { createCurveAddressDeriver } from "../../shared/launcherCurve.js";
import { createLauncherGraduationStore } from "../../shared/launcherGraduates.ts";
import { createLauncherLiveHandler } from "./handler.js";

// One handler/cache per isolate; no auth, entity reads, or client-selected mints.
// The graduation ledger is the shared DB layer: visitor-confirmed migrations
// persist globally, so GRADUATED statuses survive isolate restarts and are
// served to every visitor without re-probing each time.
export default createLauncherLiveHandler({
  rpc: heliusRpc,
  deriveCurveAddress: createCurveAddressDeriver(PublicKey),
  graduationStore: createLauncherGraduationStore(),
  createClient: (req) => createClientFromRequest(req),
});