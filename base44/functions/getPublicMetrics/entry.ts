import { createLauncherAnalyticsHandler } from "../../shared/launcherAnalytics.ts";
import { createPublicMetricsHandler } from "./handler.js";

export default createPublicMetricsHandler({ getAnalytics: createLauncherAnalyticsHandler() });