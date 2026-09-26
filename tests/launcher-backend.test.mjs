import assert from "node:assert/strict";
import test from "node:test";

let moduleId = 0;
async function setup(t) {
  let now = 1_800_000_000_000;
  let failCoins = false;
  let failDex = false;
  let change = -7.5;
  const calls = [];
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    if (url === "https://otcdesks.cash/api/coins") {
      if (failCoins) return new Response(null, { status: 429 });
      return Response.json([{ mint: "test-mint", symbol: "TEST", createdAt: now / 1000 - 3600,
        snapshot: { volume24h: 12345, marketCap: 67890, change24h: change } }]);
    }
    if (failDex) return new Response(null, { status: 503 });
    if (url.includes("/tokens/")) return Response.json({ pairs: [
      { baseToken: { address: "test-mint" }, dexId: "pumpswap", liquidity: { usd: 1000 }, url: "https://dexscreener.com/solana/test-pair" },
    ] });
    // Search-based native sample: one URL per pump ecosystem term, each
    // term returning its own pump pairs (dedup happens in the handler).
    if (url.includes("/search?q=")) {
      const q = decodeURIComponent(url.split("q=")[1]);
      return Response.json({ pairs: [
        { chainId: "solana", dexId: "pumpfun", baseToken: { address: `pump-${q}` }, volume: { h24: 100 } },
        { chainId: "solana", dexId: "pumpswap", baseToken: { address: `swap-${q}` }, volume: { h24: 900 } },
        { chainId: "ethereum", dexId: "pumpfun", baseToken: { address: `other-chain-${q}` }, volume: { h24: 5000 } },
      ] });
    }
    assert.fail(`Unexpected fetch: ${url}`);
  });
  const { default: handler } = await import(`../base44/functions/getLauncherAnalytics/entry.ts?test=${++moduleId}`);
  return { handler, calls, advance: (ms) => { now += ms; }, setChange: (v) => { change = v; },
    failCoins: () => { failCoins = true; }, failDex: () => { failDex = true; } };
}

test("snapshots carry numeric price change, volume and cap in the cached payload", async (t) => {
  const s = await setup(t);
  const response = await s.handler();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Launcher-Cache"), "miss");
  const body = await response.json();
  assert.equal(body.ranked[0].change24h, -7.5);
  assert.equal(body.ranked[0].vol24, 12345);
  assert.equal(body.ranked[0].mcap, 67890);
  assert.equal(body.ranked[0].feesEst24h, 123.45);
  assert.equal(body.ranked[0].graduated, true);
  assert.deepEqual(body.feeModel.map((s) => s.pct), [67.5, 10, 10, 5, 5, 2.5]);
  // 7 search terms × 2 solana pump pairs each, deduped by mint.
  assert.equal(body.native.n, 14);
  assert.equal(body.native.graduatedShare, 0.5);
  const callCount = s.calls.length;
  const hit = await s.handler();
  assert.equal(hit.headers.get("X-Launcher-Cache"), "hit");
  assert.deepEqual(await hit.json(), body);
  assert.equal(s.calls.length, callCount, "A warm request must not call upstream APIs");
});

test("the five-minute TTL refreshes price changes, not just volume", async (t) => {
  const s = await setup(t);
  await s.handler();
  s.setChange(42);
  s.advance(5 * 60_000 - 1);
  assert.equal((await (await s.handler()).json()).ranked[0].change24h, -7.5);
  s.advance(1);
  const fresh = await s.handler();
  assert.equal(fresh.headers.get("X-Launcher-Cache"), "miss");
  assert.equal((await fresh.json()).ranked[0].change24h, 42);
  assert.equal(s.calls.filter((u) => u.endsWith("/api/coins")).length, 2);
});

test("concurrent cold requests share one upstream rebuild", async (t) => {
  const s = await setup(t);
  const responses = await Promise.all([s.handler(), s.handler(), s.handler()]);
  assert.ok(responses.every((r) => r.status === 200));
  assert.equal(s.calls.filter((u) => u.endsWith("/api/coins")).length, 1);
});

test("upstream failures serve stale data within 30 minutes, then return 502", async (t) => {
  const s = await setup(t);
  await s.handler();
  s.failCoins();
  s.advance(6 * 60_000);
  const stale = await s.handler();
  assert.equal(stale.headers.get("X-Launcher-Cache"), "stale");
  assert.equal((await stale.json()).stale, true);
  s.advance(25 * 60_000);
  assert.equal((await s.handler()).status, 502);
});

test("missing price changes stay null and DexScreener outages preserve snapshots", async (t) => {
  const s = await setup(t);
  s.setChange(null);
  s.failDex();
  const response = await s.handler();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ranked[0].change24h, null);
  assert.equal(body.ranked[0].graduated, null);
  assert.equal(body.ranked[0].vol24, 12345);
  assert.equal(body.native, null, "A DexScreener outage must degrade the native sample to null");
});

test("a cold upstream failure is an error rather than an empty success", async (t) => {
  const s = await setup(t);
  s.failCoins();
  assert.equal((await s.handler()).status, 502);
});