// Server-side Jupiter aggregator relay: fetches quotes and builds swap
// transactions from https://lite-api.jup.ag so the browser never calls
// Jupiter directly (browser-side calls hit CORS / rate limits, which broke
// swaps). The wallet still signs locally; only quote/build requests and the
// already-signed bytes are relayed.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";

const QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
const SWAP_URL = "https://lite-api.jup.ag/swap/v1/swap";

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

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      /* fall through to 401 */
    }
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

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
      const url =
        `${QUOTE_URL}?inputMint=${inputMint}&outputMint=${outputMint}` +
        `&amount=${amount}&slippageBps=${slippageBps}&swapMode=ExactIn`;
      const res = await fetchJup(url);
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return Response.json(
          { error: `QUOTE_FAIL (${res.status}) ${t.slice(0, 200)}` },
          { status: 502 }
        );
      }
      const quote = await res.json();
      return Response.json({ ok: true, quote });
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
      const res = await fetchJup(SWAP_URL, {
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
      return Response.json({ ok: true, swap });
    }

    return Response.json({ error: "Unknown mode" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}