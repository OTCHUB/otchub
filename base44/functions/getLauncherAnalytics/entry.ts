/* getLauncherAnalytics — serves the OTC_ANALYTICS cohort payload.
   The build lives in shared/launcherFeed.ts so the 5-min Supabase mirror
   (mirrorLauncherFeed) pushes the identical payload browsers fall back to
   when this endpoint is unreachable. The cached handler lives in
   shared/launcherAnalytics.ts so sibling functions can bundle the exact
   same response (cache header included) without cross-function imports. */

import { createLauncherAnalyticsHandler } from "../../shared/launcherAnalytics.ts";

export default createLauncherAnalyticsHandler();