// Thin Solana RPC relay for client-side tx flows (claim / activate /
// distribute). The browser cannot use the app's Helius key directly, and the
// public api.mainnet-beta endpoint rate-limits / 403s, which broke packing
// (getLatestBlockhash), simulation, and broadcast. This relays those three
// operations through Helius server-side. The wallet still signs locally —
// only the already-signed bytes are forwarded, so no private key ever leaves
// the browser.

import { heliusRpc } from "../../shared/otcSources.ts";

// Small concurrency-limited map used by the batched relay modes below.
const runLimited = async (items, limit, fn) => {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) break;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
};

// Broadcast one signed base64 tx with transient-failure retries (a duplicate
// submit of an already-accepted tx is harmless — Helius returns "already
// processed"). Returns { sig } or { error }; shared by "send" and "sendBatch".
const sendOne = async (tx) => {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const sig = await heliusRpc("sendTransaction", [
        tx,
        { encoding: "base64", skipPreflight: true, maxRetries: 3, commitment: "confirmed" },
      ]);
      return { sig };
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return { error: lastErr?.message || "send failed" };
};

export default async function (req) {
  try {
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
      // Optional includeAccounts: the caller can request the simulated
      // POST-execution state of specific accounts (the claim panel's
      // PULL_OWED probe uses this to read what a distribute would deliver).
      // State is never committed — simulation only.
      const incl = Array.isArray(body.accounts)
        ? body.accounts.filter((k) => typeof k === "string").slice(0, 20)
        : [];
      const r = await heliusRpc("simulateTransaction", [
        tx,
        {
          sigVerify: false,
          replaceRecentBlockhash: true,
          commitment: "confirmed",
          encoding: "base64",
          ...(incl.length ? { accounts: { encoding: "base64", addresses: incl } } : {}),
        },
      ]);
      const v = r?.value || {};
      return Response.json({
        ok: true,
        err: v.err ? JSON.stringify(v.err) : null,
        logs: v.logs || [],
        units: v.unitsConsumed ?? null,
        postAccounts: Array.isArray(v.accounts) ? v.accounts : null,
      });
    }

    if (mode === "send") {
      const tx = body.tx;
      if (!tx) return Response.json({ error: "tx required" }, { status: 400 });
      const r = await sendOne(tx);
      if (r.error) return Response.json({ error: r.error }, { status: 500 });
      return Response.json({ ok: true, sig: r.sig });
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

    if (mode === "simulateBatch") {
      // One invocation simulates up to 30 unsigned txs instead of one per tx
      // — cuts client→function round trips (latency + invocation overhead) on
      // big claim/crank runs. Helius-side load is identical either way. A
      // malformed tx only fails its own slot, not the whole batch.
      const txs = body.txs;
      if (!Array.isArray(txs) || txs.length < 1 || txs.length > 30) {
        return Response.json({ error: "txs must be 1-30 base64 txs" }, { status: 400 });
      }
      const results = await runLimited(txs, 5, async (tx) => {
        try {
          const r = await heliusRpc("simulateTransaction", [
            tx,
            { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed", encoding: "base64" },
          ]);
          const v = r?.value || {};
          return {
            err: v.err ? JSON.stringify(v.err) : null,
            logs: v.logs || [],
            units: v.unitsConsumed ?? null,
          };
        } catch (e) {
          return { err: `SIM_FAIL: ${e?.message || "simulation failed"}`, logs: [], units: null };
        }
      });
      return Response.json({ ok: true, results });
    }

    if (mode === "sendBatch") {
      // One invocation broadcasts up to 25 signed txs (concurrency 4, same
      // retry policy as "send"). Results are positional { sig } | { error }.
      const txs = body.txs;
      if (!Array.isArray(txs) || txs.length < 1 || txs.length > 25) {
        return Response.json({ error: "txs must be 1-25 base64 txs" }, { status: 400 });
      }
      const results = await runLimited(txs, 4, (tx) => sendOne(tx));
      return Response.json({ ok: true, results });
    }

    return Response.json({ error: "unknown mode" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e?.message || "relay failed" }, { status: 500 });
  }
}