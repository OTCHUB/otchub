// No runtime/SDK imports: request handling and quotas are independently testable.
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const invalidParams = () => new ApiError(400, "INVALID_PARAMS", "Invalid request parameters.");

export function responseHeaders(methods, privateApi = false) {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": [...methods, "OPTIONS"].join(", "),
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Expose-Headers": "Retry-After, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Next-Cursor",
    // Only the source handler caches snapshots. Never extend snapshot freshness at a CDN.
    "Cache-Control": "no-store",
    ...(privateApi ? { Pragma: "no-cache", Vary: "Authorization" } : {}),
    "X-Content-Type-Options": "nosniff",
  });
}

export function errorResponse(error, headers) {
  const safe = error instanceof ApiError ? error
    : new ApiError(500, "INTERNAL_ERROR", "Unable to process request.");
  if (safe.status === 401) headers.set("WWW-Authenticate", "Bearer");
  return Response.json({ error: { code: safe.code, message: safe.message } }, { status: safe.status, headers });
}

// Rolling window, not a global quota. Only authenticated digests are private keys.
// Call synchronously before any work so simultaneous requests cannot oversubscribe.
export function createRateLimiter(limit, clock = Date.now) {
  const windows = new Map();
  return (key = "aggregate") => {
    const now = clock();
    for (const [id, times] of windows) {
      while (times.length && times[0] <= now - 60_000) times.shift();
      if (!times.length) windows.delete(id);
    }
    const times = windows.get(key) || [];
    const allowed = times.length < limit;
    if (allowed) {
      times.push(now);
      windows.set(key, times);
    }
    return { allowed, limit, remaining: Math.max(0, limit - times.length),
      resetAt: (times[0] ?? now) + 60_000,
      retryAfter: Math.max(1, Math.ceil(((times[0] ?? now) + 60_000 - now) / 1000)) };
  };
}

export function applyRateLimit(headers, result) {
  for (const prefix of ["RateLimit", "X-RateLimit"]) {
    headers.set(`${prefix}-Limit`, String(result.limit));
    headers.set(`${prefix}-Remaining`, String(result.remaining));
    headers.set(`${prefix}-Reset`, String(prefix === "RateLimit" ? result.retryAfter : Math.ceil(result.resetAt / 1000)));
  }
  if (!result.allowed) {
    headers.set("Retry-After", String(result.retryAfter));
    throw new ApiError(429, "RATE_LIMITED", "Request rate limit exceeded.");
  }
}

export function requestUrl(req) {
  if (req.url.length > 2048) throw new ApiError(414, "REQUEST_TOO_LARGE", "Request URL is too large.");
  return new URL(req.url);
}

export function assertKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !keys.includes(key))) throw invalidParams();
}

export function integerParam(value, fallback, min, max, fromQuery = false) {
  if (value === undefined) return fallback;
  if (fromQuery && typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) value = Number(value);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw invalidParams();
  return value;
}

// Run only after JSON.parse has validated syntax. JSON.parse alone silently
// accepts duplicate names; reject those (including escaped spellings) instead.
function rejectDuplicateKeys(text) {
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") stack.push(new Set());
    else if (text[i] === "[") stack.push(null);
    else if (text[i] === "}" || text[i] === "]") stack.pop();
    else if (text[i] === '"') {
      const start = i++;
      while (text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      let next = i + 1;
      while (/\s/.test(text[next] || "x")) next++;
      if (text[next] === ":") {
        const key = JSON.parse(text.slice(start, i + 1)), keys = stack.at(-1);
        if (keys.has(key)) throw invalidParams();
        keys.add(key);
      }
    }
  }
}

export async function readJsonBounded(req, maxBytes = 4096, timeoutMs = 3000) {
  const length = req.headers.get("content-length");
  if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > maxBytes)) {
    throw new ApiError(413, "REQUEST_TOO_LARGE", "Request body is too large.");
  }
  if (!req.body) return {};
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") || "")) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Use application/json.");
  }
  const reader = req.body.getReader();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ApiError(408, "REQUEST_TIMEOUT", "Request body timed out.")), timeoutMs);
  });
  try {
    const bytes = new Uint8Array(maxBytes);
    let size = 0;
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      if (size + value.byteLength > maxBytes) throw new ApiError(413, "REQUEST_TOO_LARGE", "Request body is too large.");
      bytes.set(value, size);
      size += value.byteLength;
    }
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size));
      const parsed = JSON.parse(text);
      rejectDuplicateKeys(text);
      assertKeys(parsed, Object.keys(parsed || {}));
      return parsed;
    } catch { throw invalidParams(); }
  } finally {
    clearTimeout(timer);
    // Do not wait for a malicious/unresponsive stream's cancel implementation.
    void reader.cancel().catch(() => {});
  }
}

export async function requestParams(req, url, keys) {
  const query = Object.create(null);
  for (const [key, value] of url.searchParams) {
    if (!keys.includes(key) || Object.hasOwn(query, key)) throw invalidParams();
    query[key] = value;
  }
  if (req.method === "GET") return query;
  // No query/body precedence ambiguities (including query-string credentials).
  if (url.search) throw invalidParams();
  const body = await readJsonBounded(req);
  assertKeys(body, keys);
  return body;
}