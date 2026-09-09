// Server-side Jupiter aggregator relay: fetches quotes and builds swap
// transactions from Jupiter so the browser never calls Jupiter directly
// (browser-side calls hit CORS / rate limits, which broke swaps). The wallet
// still signs locally; only quote/build requests and the already-signed
// bytes are relayed.
//
// JUP_API_KEY (developers.jup.ag): when configured, requests go through the
// KEYED api.jup.ag endpoints — a dedicated per-organisation quota (free
// tier 1 rps / 60 rpm) instead of the keyless lite-api bucket shared with
// every workload on this runtime's egress IP. A rejected key (401/403) or a
// keyed network failure falls back to the keyless lite-api endpoints, so a
// missing/bad key never breaks swaps.
const KEYED_BASE = "https://api.jup.ag/swap/v1";
const LITE_BASE = "https://lite-api.jup.ag/swap/v1";
const JUP_API_KEY = process.env.JUP_API_KEY || "";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Jupiter's lite API intermittently 429s (rate limit) or throws (timeouts /
// connection resets) — a single attempt surfaced as user-facing quote/swap
// failures. Retry transient failures a few times with backoff; only give up
// after the retries are exhausted.
const fetchJup = async (url, opts = {}, attempts = 3) => {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(12000) });
      if ((res.status === 429 || res.status >= 500) && i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
        continue;
      }
    }
  }
  throw lastErr || new Error("Jupiter request failed");
};

// Keyed-first request with keyless fallback. Returns { res, auth } so callers
// can surface which tier served the request; falls back only when the keyed
// path rejects the key (401/403) or fails at the network level.
const requestJup = async (path, opts = {}) => {
  if (JUP_API_KEY) {
    try {
      const res = await fetchJup(`${KEYED_BASE}${path}`, {
        ...opts,
        headers: { ...(opts.headers || {}), "x-api-key": JUP_API_KEY },
      });
      if (res.status !== 401 && res.status !== 403) return { res, auth: "keyed" };
    } catch { /* fall through to keyless */ }
  }
  const res = await fetchJup(`${LITE_BASE}${path}`, opts);
  return { res, auth: "lite" };
};

export default async function (req) {
  try {
    const args = await req.json().catch(() => ({}));
    const mode = String(args.mode || "");

    if (mode === "quote") {
      const { inputMint, outputMint, amount, slippageBps } = args;
      if (
        !BASE58_RE.test(String(inputMint || "")) ||
        !BASE58_RE.test(String(outputMint || "")) ||
        !Number.isInteger(Number(amount)) ||
        Number(amount) <= 0 ||
        !Number.isInteger(Number(slippageBps)) ||
        Number(slippageBps) < 0 ||
        Number(slippageBps) > 5000
      ) {
        return Response.json({ error: "Invalid quote params" }, { status: 400 });
      }
      const { res, auth } = await requestJup(
        `/quote?inputMint=${inputMint}&outputMint=${outputMint}` +
        `&amount=${amount}&slippageBps=${slippageBps}&swapMode=ExactIn`
      );
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return Response.json(
          { error: `QUOTE_FAIL (${res.status}) ${t.slice(0, 200)}` },
          { status: 502 }
        );
      }
      const quote = await res.json();
      return Response.json({ ok: true, quote, auth });
    }

    if (mode === "swap") {
      const { quoteResponse, userPublicKey } = args;
      if (!quoteResponse || !BASE58_RE.test(String(userPublicKey || ""))) {
        return Response.json({ error: "Invalid swap params" }, { status: 400 });
      }
      // Jupiter's /quote returns swapInfo.updateContextSlot as a NUMBER but
      // its own /swap endpoint requires it as a STRING. The TOP-LEVEL
      // contextSlot is the opposite — it must stay a NUMBER (u64). A verbatim
      // round-trip fails with 422 on every swap build, so normalize ONLY
      // updateContextSlot; leave every other field untouched.
      const normalized = JSON.parse(JSON.stringify(quoteResponse), (key, value) =>
        key === "updateContextSlot" && typeof value === "number" ? String(value) : value
      );
      const { res, auth } = await requestJup("/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteResponse: normalized, userPublicKey }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return Response.json(
          { error: `SWAP_BUILD_FAIL (${res.status}) ${t.slice(0, 200)}` },
          { status: 502 }
        );
      }
      const swap = await res.json();
      if (!swap?.swapTransaction) {
        return Response.json({ error: "SWAP_BUILD_FAIL: no transaction" }, { status: 502 });
      }
      // The serialized swap tx is returned UNMODIFIED — the wallet signs the
      // exact bytes Jupiter built, and the browser broadcasts it through the
      // app's Helius RPC relay (plain sendTransaction).
      return Response.json({ ok: true, swap, auth });
    }

    return Response.json({ error: "Unknown mode" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}