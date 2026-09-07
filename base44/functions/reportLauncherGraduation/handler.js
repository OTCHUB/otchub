import { ApiError, assertKeys, errorResponse, invalidParams, readJsonBounded, responseHeaders } from "../../shared/apiHttp.js";

const MAX_MINTS = 25;

// Browser-confirmed AMM migrations persist into the global graduation ledger.
// Trust boundary: the browser only nominates candidate mints — every mint is
// re-verified against its on-chain bonding curve (complete flag) through the
// RPC before the ledger write, so a forged report can never graduate an
// unfinished token, and each mint is persisted at most once per cache window.
export function createGraduationReportHandler({ verifyComplete, store, createClient,
  clock = Date.now, maxMints = MAX_MINTS }) {
  return async function (req) {
    const headers = responseHeaders(["GET", "POST"]);
    try {
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
      if (req.method !== "POST") {
        headers.set("Allow", "POST, OPTIONS");
        throw new ApiError(405, "METHOD_NOT_ALLOWED", "Use POST.");
      }
      const body = await readJsonBounded(req);
      assertKeys(body, ["mints"]);
      const raw = Array.isArray(body.mints) ? body.mints : null;
      if (!raw || !raw.length || raw.length > maxMints) throw invalidParams();
      const mints = [...new Set(raw.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean))];
      if (!mints.length) throw invalidParams();
      const verified = await verifyComplete(mints);
      const accepted = mints.filter((mint) => verified.has(mint));
      let saved = 0;
      if (accepted.length) {
        const getClient = typeof createClient === "function" ? () => createClient(req) : null;
        saved = await store.save(getClient, accepted.map((mint) => ({
          mint, graduated_at: clock(), source: "browser_amm",
        })));
      }
      return Response.json({ at: clock(), verified: accepted.length, saved,
        rejected: mints.length - accepted.length }, { headers });
    } catch (error) {
      // Internal diagnostic only: the sanitized errorResponse never leaks this.
      console.error("launcher graduation report failed:", error?.message);
      return errorResponse(error, headers);
    }
  };
}