import { PublicKey } from "npm:@solana/web3.js@1.98.4";
import { heliusRpc } from "../../shared/otcSources.ts";
import { createCurveAddressDeriver } from "../../shared/launcherCurve.js";
import { createLauncherLiveHandler } from "./handler.js";

// One handler/cache per isolate; no auth, entity reads, or client-selected mints.
export default createLauncherLiveHandler({
  rpc: heliusRpc,
  deriveCurveAddress: createCurveAddressDeriver(PublicKey),
});