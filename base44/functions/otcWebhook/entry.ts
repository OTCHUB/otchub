// Helius webhook receiver: fires whenever protocol activity touches the OTC
// config PDA or the pot account (mint / claim / distribute / buyback), so a
// fresh snapshot is ingested right after activity instead of waiting for the
// 5-minute scheduler. Endpoint is public, so authenticity is verified with a
// shared secret (the app's Helius API key, configured as the webhook's
// authHeader in the Helius dashboard/API). Bursts are debounced: if a
// snapshot landed <60s ago the event is acknowledged and skipped. The ingest
// runs post-response via waitUntil so Helius never times out waiting on the
// full on-chain + market fetch.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { secrets, waitUntil } from "base44:runtime";
import { ingestOtcSnapshot } from "../../shared/otcSnapshot.ts";

const DEBOUNCE_MS = 60 * 1000;

export default async function (req) {
  try {
    // Validate authenticity: the webhook's authHeader must match our Helius
    // API key (sent verbatim in the Authorization header, with or without a
    // Bearer prefix).
    const expected = secrets.get("HELIUS_API_KEY");
    const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!expected || auth !== expected) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);

    // Debounce bursts (e.g. a mint wave fires one webhook per transaction):
    // skip when a snapshot was created less than a minute ago.
    const recent = await base44.asServiceRole.entities.OtcSnapshot.list("-created_date", 1);
    const last = recent?.[0];
    if (last?.created_date) {
      const ageMs = Date.now() - new Date(last.created_date).getTime();
      if (ageMs < DEBOUNCE_MS) {
        return Response.json({ ok: true, debounced: true });
      }
    }

    // Acknowledge immediately; the (multi-second) full ingest runs after the
    // response so Helius's delivery doesn't time out.
    waitUntil(
      ingestOtcSnapshot(base44, { force: true }).catch((e) => {
        console.error(`webhook ingest failed: ${e?.message || e}`);
      })
    );
    return Response.json({ ok: true, triggering: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}