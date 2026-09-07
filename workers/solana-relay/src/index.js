// Cloudflare Worker mirror of base44/functions/solanaRelay/entry.ts.
//
// WHY THIS EXISTS: every claim/activate/distribute run from the browser makes
// dozens of relay calls (blockhash, simulate x N, send x N, confirm polled
// every 4-8s) through Base44's function runtime. That shares Base44's
// function-invocation pool with auth checks, price polling, and portfolio
// scans — under load it throttles, which surfaces as "wallet connect /
// transaction fails". This Worker takes over ONLY that stateless RPC-relay
// traffic (zero Base44 entities touched), so it can be moved without any
// data migration. Same request/response shape as the Base44 function — the
// client only changes its target URL (see src/lib/otcClaim.js).

const ALLOWED_ORIGINS = new Set([
  "https://otchub.dev",
  "https://app.otchub.dev",
  "https://www.otchub.dev",
  "http://localhost:5173",
  "http://localhost:3000",
]);

// Base44 hosts the app (published + preview) under *.base44.app — allow any
// of them so the browser's direct relay calls pass CORS from this app too.
const isAllowedOrigin = (origin) =>
  ALLOWED_ORIGINS.has(origin) || /^https:\/\/[a-z0-9-]+\.base44\.app$/.test(origin);

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin : "https://otchub.dev",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

async function heliusRpc(env, method, params) {
  const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "otc", method, params }),
  });
  if (!res.ok) throw new Error(`Helius RPC ${method} failed: ${res.status}`);
  const out = await res.json();
  if (out.error) throw new Error(`Helius RPC ${method} error: ${out.error.message}`);
  return out.result;
}

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

async function sendOne(env, tx) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const sig = await heliusRpc(env, "sendTransaction", [
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
}

const MODES = {
  async blockhash(env) {
    const r = await heliusRpc(env, "getLatestBlockhash", [{ commitment: "confirmed" }]);
    const blockhash = r?.value?.blockhash;
    if (!blockhash) return { status: 502, body: { error: "no blockhash" } };
    return { body: { ok: true, blockhash } };
  },
  async simulate(env, body) {
    if (!body.tx) return { status: 400, body: { error: "tx required" } };
    const incl = Array.isArray(body.accounts) ? body.accounts.filter((k) => typeof k === "string").slice(0, 20) : [];
    const r = await heliusRpc(env, "simulateTransaction", [
      body.tx,
      {
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: "confirmed",
        encoding: "base64",
        ...(incl.length ? { accounts: { encoding: "base64", addresses: incl } } : {}),
      },
    ]);
    const v = r?.value || {};
    return {
      body: {
        ok: true,
        err: v.err ? JSON.stringify(v.err) : null,
        logs: v.logs || [],
        units: v.unitsConsumed ?? null,
        postAccounts: Array.isArray(v.accounts) ? v.accounts : null,
      },
    };
  },
  async send(env, body) {
    if (!body.tx) return { status: 400, body: { error: "tx required" } };
    const r = await sendOne(env, body.tx);
    if (r.error) return { status: 500, body: { error: r.error } };
    return { body: { ok: true, sig: r.sig } };
  },
  async accounts(env, body) {
    if (!Array.isArray(body.pubkeys)) return { status: 400, body: { error: "pubkeys required" } };
    const r = await heliusRpc(env, "getMultipleAccounts", [body.pubkeys, { encoding: "base64" }]);
    const value = r?.value || [];
    const accounts = value.map((a, i) => (a ? { pubkey: body.pubkeys[i], owner: a.owner || null, data: a.data?.[0] || null } : null));
    return { body: { ok: true, accounts } };
  },
  async fee(env, body) {
    const accountKeys = Array.isArray(body.pubkeys) ? body.pubkeys.filter((k) => typeof k === "string").slice(0, 128) : [];
    const r = await heliusRpc(env, "getPriorityFeeEstimate", [
      { ...(accountKeys.length ? { accountKeys } : {}), options: { recommended: true } },
    ]);
    return { body: { ok: true, microLamports: r?.priorityFeeEstimate ?? null } };
  },
  async confirm(env, body) {
    if (!Array.isArray(body.sigs) || !body.sigs.length) return { status: 400, body: { error: "sigs required" } };
    const r = await heliusRpc(env, "getSignatureStatuses", [body.sigs, { searchTransactionHistory: true }]);
    const statuses = (r?.value || []).map((s) => (s ? { slot: s.slot ?? null, err: s.err ?? null, confirmationStatus: s.confirmationStatus ?? null } : null));
    return { body: { ok: true, statuses } };
  },
  async balance(env, body) {
    if (typeof body.pubkey !== "string") return { status: 400, body: { error: "pubkey required" } };
    const r = await heliusRpc(env, "getBalance", [body.pubkey, { commitment: "confirmed" }]);
    return { body: { ok: true, lamports: r?.value ?? null } };
  },
  async simulateBatch(env, body) {
    if (!Array.isArray(body.txs) || body.txs.length < 1 || body.txs.length > 30) {
      return { status: 400, body: { error: "txs must be 1-30 base64 txs" } };
    }
    const results = await runLimited(body.txs, 5, async (tx) => {
      try {
        const r = await heliusRpc(env, "simulateTransaction", [tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed", encoding: "base64" }]);
        const v = r?.value || {};
        return { err: v.err ? JSON.stringify(v.err) : null, logs: v.logs || [], units: v.unitsConsumed ?? null };
      } catch (e) {
        return { err: `SIM_FAIL: ${e?.message || "simulation failed"}`, logs: [], units: null };
      }
    });
    return { body: { ok: true, results } };
  },
  async sendBatch(env, body) {
    if (!Array.isArray(body.txs) || body.txs.length < 1 || body.txs.length > 25) {
      return { status: 400, body: { error: "txs must be 1-25 base64 txs" } };
    }
    const results = await runLimited(body.txs, 4, (tx) => sendOne(env, tx));
    return { body: { ok: true, results } };
  },
};

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const headers = corsHeaders(origin);
    if (req.method === "OPTIONS") return new Response(null, { headers });
    if (req.method !== "POST") return json({ error: "POST required" }, 405, headers);
    if (!env.HELIUS_API_KEY) return json({ error: "relay misconfigured: HELIUS_API_KEY unset" }, 500, headers);

    const body = await req.json().catch(() => ({}));
    const handler = MODES[body.mode];
    if (!handler) return json({ error: "unknown mode" }, 400, headers);
    try {
      const { status = 200, body: out } = await handler(env, body);
      return json(out, status, headers);
    } catch (e) {
      return json({ error: e?.message || "relay failed" }, 500, headers);
    }
  },
};