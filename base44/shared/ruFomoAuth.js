import { createHash, timingSafeEqual } from "node:crypto";
import { ApiError, applyRateLimit, createRateLimiter, errorResponse,
  invalidParams, requestUrl, responseHeaders } from "./apiHttp.js";

// Shared by protected endpoints loaded in this isolate. Not an edge/global quota.
export const privateRateLimiter = createRateLimiter(60);

export function authorizeBearer(req, config) {
  const expected = config?.RU_FOMO_API_KEY_SHA256;
  if (typeof expected !== "string" || !/^[a-fA-F0-9]{64}$/.test(expected)) {
    throw new ApiError(503, "CONFIG_INVALID", "API authorization is not configured.");
  }
  const header = req.headers.get("authorization") || "";
  const match = header.length <= 520 && /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i.exec(header);
  if (!match || match[1].length > 512) throw new ApiError(401, "AUTH_REQUIRED", "Valid bearer authorization is required.");
  const digest = createHash("sha256").update(match[1], "utf8").digest("hex");
  const encoder = new TextEncoder();
  if (!timingSafeEqual(encoder.encode(digest), encoder.encode(expected.toLowerCase()))) {
    throw new ApiError(401, "AUTH_REQUIRED", "Valid bearer authorization is required.");
  }
  return digest;
}

export function createPrivateHandler({ getConfig, methods, queryKeys, execute,
  limiter = privateRateLimiter }) {
  return async function (req) {
    const headers = responseHeaders(methods, true);
    try {
      const url = requestUrl(req);
      if (url.protocol !== "https:") throw new ApiError(400, "HTTPS_REQUIRED", "HTTPS is required.");
      // Closed allowlist also rejects all query credentials, including encoded keys.
      for (const key of url.searchParams.keys()) if (!queryKeys.includes(key)) throw invalidParams();
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
      let config;
      try { config = await getConfig(); }
      catch { throw new ApiError(503, "CONFIG_INVALID", "API authorization is not configured."); }
      const credentialId = authorizeBearer(req, config);
      applyRateLimit(headers, limiter(credentialId));
      if (!methods.includes(req.method)) {
        headers.set("Allow", [...methods, "OPTIONS"].join(", "));
        throw new ApiError(405, "METHOD_NOT_ALLOWED", "Unsupported request method.");
      }
      return await execute({ req, url, headers, config });
    } catch (error) { return errorResponse(error, headers); }
  };
}