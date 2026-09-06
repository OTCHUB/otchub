import getLauncherAnalytics from "../getLauncherAnalytics/entry.ts";
import { createPublicMetricsHandler } from "./handler.js";

export default createPublicMetricsHandler({ getAnalytics: getLauncherAnalytics });