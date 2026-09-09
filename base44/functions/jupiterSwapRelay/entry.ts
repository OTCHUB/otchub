// Server-side Jupiter aggregator relay: fetches quotes and builds swap
// transactions from Jupiter so the browser never calls Jupiter directly
// (browser-side calls hit CORS / rate limits, which broke swaps). The wallet
// still signs locally; only quote/build requests and the already-signed
// bytes are relayed.
//
// Jupiter serves THREE independent hosts, and any one of them can have an
// outage window (observed 503 "upstream connect error / remote connection
// failure" bursts from api.jup.ag lasting minutes). Requests try the hosts in
// order — KEYED api.jup.ag (per-organisation quota via JUP_API_KEY, free tier
// 1 rps / 60 rpm), then the keyless lite-api bucket, then the legacy v6 host
// — and a failing host falls through to the next instead of failing the
// user's trade. A missing/bad key (401/403) or a payload that does not match
// the expected shape also falls through, so swaps keep working through any
// single-host degradation.
const KEYED_BASE = "https://api.jup.ag/swap/v1";
const LITE_BASE = "https://lite-api.jup.ag/swap/v1";
const LEGACY_BASE = "https://quote-api.jup.ag/v6";
const JUP_API_KEY = process.env.JUP_API_KEY || "";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Retry transient failures (429 / 5xx / network resets) a few times with
// backoff on the SAME host before declaring that host dead.
const fetchJup = async (url, opts = {}, attempts = 2) => {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(8000) });
      if ((res.status === 429 || res.status >= 500) && i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 400 * (i + 1)));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 400 * (i + 1)));
        continue;
      }
    }
  }
  throw lastErr || new Error("Jupiter request failed");
};

// Host-ordered request with fall-through. `validate` guards the payload shape
// per host (a 200 with a garbage/legacy-incompatible body counts as a host
// failure too). Throws an Error carrying every host's failure reason when all
// hosts fail, so the client sees WHY the quote/build could not be served.
const requestJup = async (path, opts = {}, validate) => {
  const candidates = [];
  if (JUP_API_KEY) {
    candidates.push({
      url: `${KEYED_BASE}${path}`,
      headers: { ...(opts.headers || {}), "x-api-key": JUP_API_KEY },
      auth: "keyed",
    });
  }
  candidates.push({ url: `${LITE_BASE}${path}`, headers: opts.headers || {}, auth: "lite" });
  candidates.push({ url: `${LEGACY_BASE}${path}`, headers: opts.headers || {}, auth: "legacy" });

  const reasons = [];
  for (const c of candidates) {
    try {
      const res = await fetchJup(c.url, { ...opts, headers: c.headers });
      if (!res.ok) {
        reasons.push(`${c.auth}:${res.status}`);
        continue;
      }
      const data = await res.json();
      if (!validate(data)) {
        reasons.push(`${c.auth}:bad_payload`);
        continue;
      }
      return { data, auth: c.auth };
    } catch (e) {
      reasons.push(`${c.auth}:${(e && e.message) || "failed"}`);
    }
  }
  throw new Error((reasons.join(" | ") || "all Jupiter hosts failed").slice(0, 300));
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
      try {
        const { data: quote, auth } = await requestJup(
          `/quote?inputMint=${inputMint}&outputMint=${outputMint}` +
            `&amount=${amount}&slippageBps=${slippageBps}&swapMode=ExactIn`,
          {},
          (j) =>
            j &&
            typeof j === "object" &&
            j.inputMint === inputMint &&
            j.outputMint === outputMint &&
            typeof j.outAmount === "string" &&
            Array.isArray(j.routePlan) &&
            j.routePlan.length > 0
        );
        return Response.json({ ok: true, quote, auth });
      } catch (e) {
        return Response.json({ error: `QUOTE_FAIL ${e.message}` }, { status: 502 });
      }
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
      try {
        const { data: swap, auth } = await requestJup(
          "/swap",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ quoteResponse: normalized, userPublicKey }),
          },
          (j) =>
            j &&
            typeof j === "object" &&
            typeof j.swapTransaction === "string" &&
            j.swapTransaction.length > 0
        );
        // The serialized swap tx is returned UNMODIFIED — the wallet signs the
        // exact bytes Jupiter built, and the browser broadcasts it through the
        // app's Helius RPC relay (plain sendTransaction).
        return Response.json({ ok: true, swap, auth });
      } catch (e) {
        return Response.json({ error: `SWAP_BUILD_FAIL ${e.message}` }, { status: 502 });
      }
    }

    return Response.json({ error: "Unknown mode" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}