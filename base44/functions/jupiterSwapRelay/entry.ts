// Server-side Jupiter aggregator relay: fetches quotes and builds swap
// transactions from https://lite-api.jup.ag so the browser never calls
// Jupiter directly (browser-side calls hit CORS / rate limits, which broke
// swaps). The wallet still signs locally; only quote/build requests and the
// already-signed bytes are relayed.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";

const QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
const SWAP_URL = "https://lite-api.jup.ag/swap/v1/swap";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
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
      const res = await fetch(url);
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
      // its own /swap endpoint requires it as a STRING — a verbatim round-trip
      // fails with 422 "invalid type: integer, expected a string" on every
      // swap build. Normalize it (and any other slot field) to a string.
      const normalized = JSON.parse(JSON.stringify(quoteResponse), (key, value) =>
        /slot$/i.test(key) && typeof value === "number" ? String(value) : value
      );
      const res = await fetch(SWAP_URL, {
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
      return Response.json({ ok: true, swap });
    }

    return Response.json({ error: "Unknown mode" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}