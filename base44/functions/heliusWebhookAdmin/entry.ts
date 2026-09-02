// Admin-gated management for the Helius activity webhook that feeds
// /functions/otcWebhook (near-real-time snapshots on protocol activity).
// Registration must happen server-side because the webhook's authHeader IS
// the app's Helius API key — the key never leaves the backend. Only admins
// may list/create webhooks.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { secrets } from "base44:runtime";

const WEBHOOK_URL = "https://knowing-otc-pulse-flow.base44.app/functions/otcWebhook";
// Fire on any transaction touching the protocol config PDA (mint/claim/
// distribute/buyback all write it) or the pot account.
const WATCH_ADDRESSES = [
  "9b5VLbpXedgXcjWyboXqHMbDgeHJtb5PBsy6TE18REU4", // OTC config PDA
  "BZcvtxDy4WihU24k3pezzajuiqYtTUHPfH7b5m26BucR", // pot account
];

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== "admin") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    const apiKey = secrets.get("HELIUS_API_KEY");
    if (!apiKey) return Response.json({ error: "HELIUS_API_KEY not set" }, { status: 500 });

    const reqArgs = await req.json().catch(() => ({}));
    const action = reqArgs.action || "list";

    const call = async (path, init) => {
      const res = await fetch(`https://api.helius.xyz/v0/webhooks${path}?api-key=${apiKey}`, init);
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || `Helius webhooks API HTTP ${res.status}`);
      return json;
    };

    if (action === "list") {
      const hooks = (await call("", { method: "GET" })) || [];
      const list = Array.isArray(hooks) ? hooks : [];
      return Response.json({
        ok: true,
        total: list.length,
        ours: list.filter((h) => h.webhookURL === WEBHOOK_URL).length,
        webhooks: list.map((h) => ({
          id: h.webhookID,
          url: h.webhookURL,
          type: h.webhookType,
          txTypes: h.transactionTypes,
          addresses: h.accountAddresses || [],
        })),
      });
    }

    if (action === "get") {
      const id = reqArgs.id;
      if (!id) return Response.json({ error: "id required" }, { status: 400 });
      const h = await call(`/${id}`, { method: "GET" });
      return Response.json({
        ok: true,
        id: h?.webhookID,
        url: h?.webhookURL,
        type: h?.webhookType,
        txTypes: h?.transactionTypes,
        addresses: h?.accountAddresses ?? null,
      });
    }

    if (action === "create") {
      // Avoid duplicates
      const existing = ((await call("", { method: "GET" })) || []).filter(
        (h) => h.webhookURL === WEBHOOK_URL
      );
      if (existing.length) {
        return Response.json({ ok: true, already: true, id: existing[0].webhookID });
      }
      const created = await call("", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookURL: WEBHOOK_URL,
          transactionTypes: ["ANY"],
          accountAddresses: WATCH_ADDRESSES,
          webhookType: "enhanced",
          authHeader: apiKey,
        }),
      });
      return Response.json({ ok: true, id: created?.webhookID || null });
    }

    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}