import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createPublicMetricsHandler } from "../base44/functions/getPublicMetrics/handler.js";
import { AT, MINT, request } from "./ru-fomo-api-fixtures.mjs";

test("public facade uses the actual launcher default handler single-flight, TTL, and stale fallback", async (t) => {
  let now = AT, calls = 0, fail = false, change = 10;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url === "https://otcdesks.cash/api/coins") {
      calls++;
      if (fail) return new Response(null, { status: 503 });
      return Response.json([{ mint: MINT, symbol: "TEST", snapshot: { volume24h: 100000,
        change24h: change, marketCap: 500000 } }]);
    }
    return Response.json({ pairs: [] });
  });
  const { default: source } = await import("../base44/functions/getLauncherAnalytics/entry.ts?public-metrics-cache-test");
  const publicHandler = createPublicMetricsHandler({ getAnalytics: source, clock: () => now });
  const cold = await Promise.all([source(), publicHandler(request("getPublicMetrics")), publicHandler(request("getPublicMetrics"))]);
  assert.equal(calls, 1);
  const body = await cold[1].json();
  assert.equal(body.cache, "miss");
  assert.equal(body.at, AT);
  change = 50;
  now += 299999;
  const hit = await (await publicHandler(request("getPublicMetrics"))).json();
  assert.equal(hit.cache, "hit");
  assert.equal(hit.data[0].change24h, 10);
  assert.equal(calls, 1);
  now++;
  const refreshed = await (await publicHandler(request("getPublicMetrics"))).json();
  assert.equal(refreshed.data[0].change24h, 50);
  assert.equal(refreshed.at, now);
  assert.equal(calls, 2);
  fail = true;
  now += 300000;
  const stale = await (await publicHandler(request("getPublicMetrics"))).json();
  assert.equal(stale.cache, "stale");
  assert.equal(stale.stale, true);
  assert.equal(stale.at, refreshed.at);
  now = refreshed.at + 1799999;
  assert.equal((await publicHandler(request("getPublicMetrics"))).status, 200);
  now++;
  const expired = await publicHandler(request("getPublicMetrics"));
  assert.equal(expired.status, 502);
  assert.equal((await expired.json()).error.code, "PROVIDER_ERROR");
});

test("production public wrapper directly imports the existing default handler, not a second fetcher", async () => {
  const wrapper = await readFile(new URL("../base44/functions/getPublicMetrics/entry.ts", import.meta.url), "utf8");
  assert.match(wrapper, /import getLauncherAnalytics from "\.\.\/getLauncherAnalytics\/entry\.ts"/);
  assert.match(wrapper, /getAnalytics: getLauncherAnalytics/);
  assert.doesNotMatch(wrapper, /fetch\(|\.invoke\(/);
});