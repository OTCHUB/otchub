import assert from "node:assert/strict";
import test from "node:test";
import { rankAnalytics } from "../base44/shared/analyticsRanking.js";
import { createPublicMetricsHandler } from "../base44/functions/getPublicMetrics/handler.js";
import { PUBLIC_API_META } from "../base44/shared/publicApiCatalog.js";
import { AT, ROW, request } from "./ru-fomo-api-fixtures.mjs";

function setup() {
  let reads = 0;
  const handler = createPublicMetricsHandler({ clock: () => AT, getAnalytics: async () => {
    reads++;
    return Response.json({ at: AT - 500, ranked: [ROW] }, { headers: { "X-Launcher-Cache": "hit" } });
  } });
  return { handler, reads: () => reads };
}

test("stable ranking puts unknown, null, undefined and nonfinite metrics last without mutations", () => {
  const values = [null, 0, -10, undefined, NaN, 7, Infinity, 7, -Infinity, "9", false];
  const rows = Object.freeze(values.map((change24h, id) => Object.freeze({ id, change24h })));
  assert.deepEqual(rankAnalytics(rows, "change24h", 60).map((r) => r.id), [5, 7, 1, 2, 0, 3, 4, 6, 8, 9, 10]);
  assert.deepEqual(rankAnalytics(rows, "missing", 60), rows);
  assert.equal(rankAnalytics(Array.from({ length: 20 }, (_, id) => ({ id })), "mcap").length, 15);
  assert.equal(rankAnalytics(rows, "change24h", 1)[0].id, 5);
  assert.deepEqual(rankAnalytics(rows, "change24h", 0), []);
});

test("public GET/POST defaults, exact response projection and metadata match the shared catalog", async () => {
  const s = setup();
  for (const req of [request("getPublicMetrics"), request("getPublicMetrics", { method: "POST", body: {} })]) {
    const response = await s.handler(req);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { schemaVersion: 1, at: AT - 500, stale: false, cache: "hit", scope: "top_60_by_volume",
      sort: "change24h", limit: 15, total: 1, data: [{ mint: ROW.mint, symbol: ROW.symbol, name: ROW.name,
        vol24: ROW.vol24, mcap: ROW.mcap, change24h: ROW.change24h }] });
  }
  for (const sort of ["change24h", "vol24", "mcap"]) {
    for (const limit of [1, 60]) {
      const response = await s.handler(request(`getPublicMetrics?sort=${sort}&limit=${limit}`));
      assert.equal((await response.json()).limit, limit);
    }
  }
  const before = s.reads();
  for (const req of [request("getPublicMetrics?view=meta"), request("getPublicMetrics", { method: "POST", body: { view: "meta" } })]) {
    const response = await s.handler(req);
    assert.deepEqual(await response.json(), PUBLIC_API_META);
  }
  assert.equal(s.reads(), before, "metadata is static, not a protected-live probe");
});

test("public parameters are strict, bounded and do not accept injection or duplicate query keys", async () => {
  const s = setup();
  for (const query of ["limit=0", "limit=61", "limit=1e1", "limit=1.5", "limit=-1", "limit=01", "sort=liquidity",
    "sort=__proto__", "sort=mcap&sort=vol24", "limit=1&limit=2", "x=1", "view=live", "view=meta&limit=1", "token=x"]) {
    const response = await s.handler(request(`getPublicMetrics?${query}`));
    assert.equal(response.status, 400, query);
  }
  for (const body of [{ limit: null }, { limit: "1" }, { limit: true }, { limit: {} }, { sort: null },
    { sort: { $ne: "mcap" } }, { view: "meta", sort: "mcap" }, [], null]) {
    assert.equal((await s.handler(request("getPublicMetrics", { method: "POST", body }))).status, 400);
  }
  assert.equal((await s.handler(request("getPublicMetrics", { method: "POST", raw: "x".repeat(4097) }))).status, 413);
  assert.equal(s.reads(), 0);
});

test("public CORS and aggregate 120/min cap apply to distinct clients and metadata", async () => {
  const s = setup();
  const preflight = await s.handler(request("getPublicMetrics", { method: "OPTIONS", auth: null }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "*");
  const responses = await Promise.all(Array.from({ length: 119 }, (_, n) => s.handler(request("getPublicMetrics?view=meta",
    { auth: null, headers: { "X-Forwarded-For": `192.0.2.${n}` } }))));
  assert.ok(responses.every((r) => r.status === 200));
  const limited = await s.handler(request("getPublicMetrics?view=meta"));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("Retry-After"), "60");
  assert.equal(limited.headers.get("X-RateLimit-Limit"), "120");
  assert.equal(limited.headers.get("RateLimit-Remaining"), "0");
  assert.equal(s.reads(), 0);
});

test("source errors are sanitized and never mistaken for an empty successful cohort", async () => {
  for (const getAnalytics of [async () => Response.json({ error: "unsafe-provider-detail" }, { status: 502 }),
    async () => { throw Error("unsafe-provider-detail"); }, async () => Response.json({ ranked: [] })]) {
    const handler = createPublicMetricsHandler({ getAnalytics });
    const response = await handler(request("getPublicMetrics"));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: { code: "PROVIDER_ERROR", message: "Analytics data is unavailable." } });
  }
});

test("wire unknown numbers remain null, source snapshot time and top-60 scope are preserved", async () => {
  const handler = createPublicMetricsHandler({ getAnalytics: async () => Response.json({ at: AT, stale: true,
    ranked: Array.from({ length: 70 }, (_, id) => ({ ...ROW, symbol: String(id), vol24: null,
      change24h: id === 1 ? -5 : null, mcap: "unknown" })) }, { headers: { "X-Launcher-Cache": "stale" } }) });
  const body = await (await handler(request("getPublicMetrics?limit=60"))).json();
  assert.equal(body.at, AT);
  assert.equal(body.stale, true);
  assert.equal(body.cache, "stale");
  assert.equal(body.total, 60);
  assert.equal(body.data.length, 60);
  assert.equal(body.data[0].symbol, "1");
  assert.equal(body.data[0].mcap, null);
});