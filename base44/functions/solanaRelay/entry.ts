// Thin Solana RPC relay for client-side tx flows (claim / activate /
// distribute). The browser cannot use the app's Helius key directly, and the
// public api.mainnet-beta endpoint rate-limits / 403s, which broke packing
// (getLatestBlockhash), simulation, and broadcast. This relays those three
// operations through Helius server-side. The wallet still signs locally —
// only the already-signed bytes are forwarded, so no private key ever leaves
// the browser.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { heliusRpc } from "../../shared/otcSources.ts";

export default async function (req) {
  try {
    // touch client so the request context is initialized (auth/billing)
    await createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const mode = body.mode;

    if (mode === "blockhash") {
      const r = await heliusRpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
      const blockhash = r?.value?.blockhash;
      if (!blockhash) return Response.json({ error: "no blockhash" }, { status: 502 });
      return Response.json({ ok: true, blockhash });
    }

    if (mode === "simulate") {
      const tx = body.tx;
      if (!tx) return Response.json({ error: "tx required" }, { status: 400 });
      const r = await heliusRpc("simulateTransaction", [
        tx,
        { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed", encoding: "base64" },
      ]);
      const v = r?.value || {};
      return Response.json({
        ok: true,
        err: v.err ? JSON.stringify(v.err) : null,
        logs: v.logs || [],
        units: v.unitsConsumed ?? null,
      });
    }

    if (mode === "send") {
      const tx = body.tx;
      if (!tx) return Response.json({ error: "tx required" }, { status: 400 });
      const sig = await heliusRpc("sendTransaction", [
        tx,
        { encoding: "base64", skipPreflight: true, maxRetries: 3, commitment: "confirmed" },
      ]);
      return Response.json({ ok: true, sig });
    }

    return Response.json({ error: "unknown mode" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e?.message || "relay failed" }, { status: 500 });
  }
}