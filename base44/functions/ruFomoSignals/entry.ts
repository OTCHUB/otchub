import { createClientFromRequest } from "npm:@base44/sdk";
import { secrets } from "base44:runtime";
import getLauncherAnalytics from "../getLauncherAnalytics/entry.ts";
import { createRuFomoStore, serviceRoleRequest } from "../../shared/ruFomoStore.js";
import { createRuFomoSignalsHandler } from "./handler.js";

export default createRuFomoSignalsHandler({
  getAnalytics: getLauncherAnalytics,
  getConfig: () => Object.fromEntries([
    "RU_FOMO_API_KEY_SHA256", "RU_FOMO_SIGNALS_ENABLED", "RU_FOMO_MIN_VOLUME_USD",
    "RU_FOMO_MIN_CHANGE_PCT", "RU_FOMO_MAX_CHANGE_PCT", "RU_FOMO_MIN_LIQUIDITY_USD",
  ].map((key) => [key, secrets.get(key)])),
  getStore: (req) => createRuFomoStore(createClientFromRequest(serviceRoleRequest(req)).asServiceRole.entities),
});