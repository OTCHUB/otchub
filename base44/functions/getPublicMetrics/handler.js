import { PUBLIC_API_META } from "../../shared/publicApiCatalog.js";
import { rankAnalytics } from "../../shared/analyticsRanking.js";
import { readAnalyticsSnapshot } from "../../shared/analyticsSnapshot.js";
import { ApiError, applyRateLimit, createRateLimiter, errorResponse, integerParam,
  invalidParams, requestParams, requestUrl, responseHeaders } from "../../shared/apiHttp.js";

export function createPublicMetricsHandler({ getAnalytics, clock = Date.now,
  limiter = createRateLimiter(120, clock) }) {
  return async function (req) {
    const headers = responseHeaders(["GET", "POST"]);
    try {
      applyRateLimit(headers, limiter());
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
      if (!["GET", "POST"].includes(req.method)) {
        headers.set("Allow", "GET, POST, OPTIONS");
        throw new ApiError(405, "METHOD_NOT_ALLOWED", "Use GET or POST.");
      }
      const params = await requestParams(req, requestUrl(req), ["sort", "limit", "view"]);
      if (params.view !== undefined) {
        if (params.view !== "meta" || Object.keys(params).length !== 1) throw invalidParams();
        return Response.json(PUBLIC_API_META, { headers });
      }
      const sort = params.sort === undefined ? "change24h" : params.sort;
      if (!["change24h", "vol24", "mcap"].includes(sort)) throw invalidParams();
      const limit = integerParam(params.limit, 15, 1, 60, req.method === "GET");
      const snapshot = await readAnalyticsSnapshot(getAnalytics);
      const nullable = (value) => Number.isFinite(value) ? value : null;
      const data = rankAnalytics(snapshot.ranked, sort, limit).map((row) => ({
        mint: typeof row?.mint === "string" ? row.mint : "",
        symbol: typeof row?.symbol === "string" ? row.symbol : "",
        name: typeof row?.name === "string" ? row.name : "",
        vol24: nullable(row?.vol24), mcap: nullable(row?.mcap), change24h: nullable(row?.change24h),
      }));
      return Response.json({ schemaVersion: 1, at: snapshot.at, stale: snapshot.stale,
        cache: snapshot.cache, scope: "top_60_by_volume", sort, limit,
        total: snapshot.ranked.length, data }, { headers });
    } catch (error) { return errorResponse(error, headers); }
  };
}