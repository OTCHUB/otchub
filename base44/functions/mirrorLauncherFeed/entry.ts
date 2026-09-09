import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { PublicKey } from "npm:@solana/web3.js@1.98.4";
import { buildLauncherLiveBody, buildLauncherAnalyticsBody } from "../../shared/launcherFeed.ts";
import { pushDashboardToSupabase } from "../../shared/supabaseDashboard.ts";
import { refreshLauncherCoinsArchive } from "../../shared/launcherArchive.ts";
import { heliusRpc } from "../../shared/otcSources.ts";
import { createCurveAddressDeriver } from "../../shared/launcherCurve.js";

// Supabase mirror of the launcher feed — LAUNCHER PANEL RESILIENCE + ARCHIVE.
// Every 5 minutes (LauncherFeedScheduler workflow) this builds the SAME
// payloads the live endpoints serve and upserts them into the project's
// public Supabase KV table (otc_dashboard, keys launcher_live /
// launcher_analytics). Browsers read those rows directly as a fallback when
// the live functions are down (src/lib/launcherFeed.js), and the mirrored
// tape preserves the roster even if the upstream coins feed resets again.
// One payload built/pushed at a time, freed before the next (memory bound).
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    // FULL-TAPE SWEEP FIRST: catch the archive up with every launch since the
    // last cycle (bounded page sweep, stops early once caught up), so the tape
    // built below carries the complete launch history.
    let archive = null;
    try {
      // curveSweep: bounded on-chain probe of the archived tape so launches
      // outside the live candidate set still get real curve statuses.
      archive = await refreshLauncherCoinsArchive({ pages: 40, curveSweep: {
        rpc: heliusRpc, deriveCurveAddress: createCurveAddressDeriver(PublicKey),
      } });
    }
    catch { /* build with the last archived tape */ }

    const live = await buildLauncherLiveBody(() => base44);
    const liveRows = Array.isArray(live.rows) ? live.rows.length : 0;
    await pushDashboardToSupabase({
      key: "launcher_live",
      payload: {
        at: live.at, rows: live.rows, riskCoverage: live.riskCoverage,
        statusCounts: live.statusCounts, rosterTotal: live.rosterTotal,
        pendingGraduation: live.pendingGraduation, candidateCount: live.candidateCount,
        statusChecked: live.statusChecked, statusError: live.statusError,
        nearThreshold: live.nearThreshold,
      },
    });
    live.rows = null; // free the roster before the next build

    const analytics = await buildLauncherAnalyticsBody();
    await pushDashboardToSupabase({ key: "launcher_analytics", payload: analytics });

    return Response.json({
      ok: true,
      archive,
      live_rows: liveRows,
      analytics_launches: analytics?.cohort?.launches ?? null,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}