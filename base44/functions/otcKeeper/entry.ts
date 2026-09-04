import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { runKeeper, keeperStatus, setKeeperEnabled } from "../../shared/otcKeeperCore.ts";

// Keeper entrypoint. Modes:
//  - default / { run: true } : execute one keeper run (sim-first distribute
//    sweep, signed by the funded keeper wallet). Rate-gated by a 10-minute
//    lock, so the 30-minute workflow schedule and any manual invocation can
//    never overlap or spam fee spend.
//  - { mode: "status" }       : public read — config, keeper float, recent runs.
//  - { mode: "toggle", enabled } : admin-only pause/resume of the keeper.

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));

    if (body.mode === "toggle") {
      const user = await base44.auth.me();
      if (!user || user.role !== "admin") {
        return Response.json({ error: "Admin only" }, { status: 403 });
      }
      const out = await setKeeperEnabled(base44, body.enabled !== false);
      return Response.json(out);
    }

    if (body.mode === "status") {
      const out = await keeperStatus(base44);
      return Response.json(out);
    }

    const out = await runKeeper(base44);
    return Response.json(out);
  } catch (error) {
    return Response.json({ error: error?.message || "keeper failed" }, { status: 500 });
  }
}