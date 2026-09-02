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
      // Helius sendTransaction intermittently 500s under load (and 429s on
      // rate limits). Retry the broadcast a few times — a duplicate submit of
      // an already-accepted tx is harmless (Helius returns "already
      // processed"), so this only helps transient failures.
      let lastErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const sig = await heliusRpc("sendTransaction", [
            tx,
            { encoding: "base64", skipPreflight: true, maxRetries: 3, commitment: "confirmed" },
          ]);
          return Response.json({ ok: true, sig });
        } catch (e) {
          lastErr = e;
          if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
      return Response.json({ error: lastErr?.message || "send failed" }, { status: 500 });
    }

    if (mode === "accounts") {
      const pubkeys = body.pubkeys;
      if (!Array.isArray(pubkeys)) return Response.json({ error: "pubkeys required" }, { status: 400 });
      const r = await heliusRpc("getMultipleAccounts", [pubkeys, { encoding: "base64" }]);
      const value = r?.value || [];
      const accounts = value.map((a, i) => {
        if (!a) return null;
        return { pubkey: pubkeys[i], owner: a.owner || null, data: a.data?.[0] || null };
      });
      return Response.json({ ok: true, accounts });
    }

    if (mode === "fee") {
      // Helius priority-fee estimate (µlamports/CU) for the accounts the
      // caller is about to write. Passing accountKeys makes the estimate
      // reflect contention on the actual PDAs a claim batch touches.
      const accountKeys = Array.isArray(body.pubkeys)
        ? body.pubkeys.filter((k) => typeof k === "string").slice(0, 128)
        : [];
      const params = [
        {
          ...(accountKeys.length ? { accountKeys } : {}),
          options: { recommended: true },
        },
      ];
      const r = await heliusRpc("getPriorityFeeEstimate", params);
      const est = r?.priorityFeeEstimate;
      return Response.json({ ok: true, microLamports: est ?? null });
    }

    if (mode === "confirm") {
      // Post-send landing check: which of these signatures have actually been
      // processed (slot set) vs still pending (null). Used to re-broadcast
      // stuck transactions before their blockhash expires.
      const sigs = body.sigs;
      if (!Array.isArray(sigs) || !sigs.length) {
        return Response.json({ error: "sigs required" }, { status: 400 });
      }
      const r = await heliusRpc("getSignatureStatuses", [sigs, { searchTransactionHistory: true }]);
      const statuses = (r?.value || []).map((s) =>
        s
          ? {
              slot: s.slot ?? null,
              err: s.err ?? null,
              confirmationStatus: s.confirmationStatus ?? null,
            }
          : null
      );
      return Response.json({ ok: true, statuses });
    }

    if (mode === "balance") {
      // Native SOL balance of a wallet (lamports) — used by the swap panel to
      // show the spendable SOL alongside the $OTC balance.
      const pubkey = body.pubkey;
      if (typeof pubkey !== "string") {
        return Response.json({ error: "pubkey required" }, { status: 400 });
      }
      const r = await heliusRpc("getBalance", [pubkey, { commitment: "confirmed" }]);
      return Response.json({ ok: true, lamports: r?.value ?? null });
    }

    if (mode === "bundle") {
      // Helius basic bundles (direct Jito proxy): up to 5 fully-signed base64
      // txs submitted as ONE ATOMIC unit. Bundled txs execute sequentially in a
      // single slot — the caller relies on this to land many crank txs that all
      // write the same config PDA (normal sends get dropped from the same slot
      // by the scheduler's write-conflict rule). Each tx carries the required
      // 5,000-lamport Jito tip, added by the caller at build time. 1 credit
      // per sendBundle call. Returns a bundle id for getBundleStatuses.
      const txs = body.txs;
      if (
        !Array.isArray(txs) ||
        txs.length < 1 ||
        txs.length > 5 ||
        txs.some((t) => typeof t !== "string" || t.length < 64 || t.length > 3000)
      ) {
        return Response.json({ error: "txs must be 1-5 base64 txs" }, { status: 400 });
      }
      const bundleId = await heliusRpc("sendBundle", [txs, { encoding: "base64" }]);
      if (!bundleId) return Response.json({ error: "no bundle id" }, { status: 502 });
      return Response.json({ ok: true, bundleId });
    }

    if (mode === "bundleStatus") {
      // Landing check for submitted bundles: a null entry = not landed yet.
      const ids = body.ids;
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 5) {
        return Response.json({ error: "ids must be 1-5 bundle ids" }, { status: 400 });
      }
      const r = await heliusRpc("getBundleStatuses", [ids]);
      const statuses = (r?.value || []).map((s) =>
        s
          ? {
              bundleId: s.bundle_id ?? null,
              slot: s.slot ?? null,
              status: s.confirmation_status ?? null,
              err: s.err ? JSON.stringify(s.err) : null,
            }
          : null
      );
      return Response.json({ ok: true, statuses });
    }

    return Response.json({ error: "unknown mode" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e?.message || "relay failed" }, { status: 500 });
  }
}