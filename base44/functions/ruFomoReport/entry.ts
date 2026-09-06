import { createClientFromRequest } from "npm:@base44/sdk";
import { secrets } from "base44:runtime";
import { createRuFomoStore, serviceRoleRequest } from "../../shared/ruFomoStore.js";
import { createRuFomoReportHandler } from "./handler.js";

export default createRuFomoReportHandler({
  getConfig: () => ({ RU_FOMO_API_KEY_SHA256: secrets.get("RU_FOMO_API_KEY_SHA256") }),
  getStore: (req) => createRuFomoStore(createClientFromRequest(serviceRoleRequest(req)).asServiceRole.entities),
});