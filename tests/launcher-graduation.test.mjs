import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import { createLauncherLiveHandler } from "../base44/functions/getLauncherLive/handler.js";
import { createGraduationReportHandler } from "../base44/functions/reportLauncherGraduation/handler.js";
import { createCurveAddressDeriver, PUMP_CURVE_DISCRIMINATOR, PUMP_PROGRAM_ID } from "../base44/shared/launcherCurve.js";

const NOW = 1_800_000_000_000;
const LEDGER_AT = NOW - 9000;
const COINS = "https://otcdesks.cash/api/coins";
const DEX = "https://api.dexscreener.com/latest/dex/tokens/";
const derive = createCurveAddressDeriver(PublicKey);

const mint = (i) => {
  const bytes = new Uint8Array(32);
  new DataView(bytes.buffer).setUint32(28, i);
  return new PublicKey(bytes).toBase58();
};
const coin = (i) => ({ mint: mint(i), symbol: `C${i}`, name: `Coin ${i}`, image: "https://example.test/c.png",
  createdAt: NOW / 1000 - 3600, snapshot: { volume24h: 100, marketCap: 2000, liquidity: 400, change24h: -1 } });
function account(complete = false) {
  const bytes = Buffer.alloc(49);
  bytes.set(PUMP_CURVE_DISCRIMINATOR);
  [1000n, 30n, 800n, 0n, 1_000_000n].forEach((value, i) => bytes.writeBigUInt64LE(value, 8 + i * 8));
  bytes[48] = complete ? 1 : 0;
  return { owner: PUMP_PROGRAM_ID, executable: false, data: [bytes.toString("base64"), "base64"] };
}
// Deliberately disjoint volume/momentum cohorts (like the full-tape fixture):
// indices 0-59 are the volume top, 60-119 the gainers, 120+ non-candidates.
const fullRoster = () => Array.from({ length: 220 }, (_, i) => ({ ...coin(i),
  snapshot: { volume24h: i < 60 ? 1000 + i : 1, marketCap: 2000, liquidity: 400,
    change24h: i >= 60 && i < 120 ? 1000 + i : -1000 } }));

function setupFeed(options = {}) {
  let now = NOW;
  const state = { coins: [coin(1)], accounts: new Map(), dex: { pairs: [] }, ...options.state };
  const handler = createLauncherLiveHandler({ clock: () => now, deriveCurveAddress: derive,
    probeTimeoutMs: 1000, riskOptions: { maxRequests: 0 },
    graduationStore: options.graduationStore,
    createClient: options.graduationStore ? () => ({ asServiceRole: {} }) : undefined,
    rpc: async (method, params) => {
      assert.equal(method, "getMultipleAccounts");
      return { value: params[0].map((address) => state.accounts.get(address) ?? null) };
    },
    fetchImpl: async (url) => {
      if (url === COINS) return { ok: true, json: async () => structuredClone(state.coins) };
      assert.ok(url.startsWith(DEX));
      return { ok: true, json: async () => structuredClone(state.dex) };
    },
  });
  const request = (query = "") => new Request(`https://example.test/getLauncherLive${query}`);
  return { state, advance: (ms) => { now += ms; },
    read: async (req = request()) => {
      const response = await handler(req);
      return { response, body: await response.json() };
    }, request };
}

test("the feed lists completed-but-unconfirmed curves for browser confirmation", async () => {
  const s = setupFeed({ graduationStore: { load: async () => new Map() },
    state: { accounts: new Map([[derive(mint(1)), account(true)]]) } });
  const { response, body } = await s.read();
  assert.equal(response.status, 200);
  assert.equal(body.ranked[0].status, "ABOUT_TO_GRADUATE");
  assert.equal(body.ranked[0].curveProgress, 100);
  assert.deepEqual(body.pendingGraduation, [mint(1)]);
});

test("a ledger entry graduates a completed curve, clears the pending list, and carries the ledger time", async () => {
  const s = setupFeed({ graduationStore: {
      load: async () => new Map([[mint(1), { graduated_at: LEDGER_AT, source: "browser_amm" }]]),
    }, state: { accounts: new Map([[derive(mint(1)), account(true)]]) } });
  const { body } = await s.read();
  assert.equal(body.ranked[0].status, "GRADUATED");
  assert.equal(body.ranked[0].statusAt, LEDGER_AT, "Persisted evidence time beats the probe time");
  assert.deepEqual(body.pendingGraduation, []);
});

test("ledger-backed statuses are sticky outside the probed candidate set", async () => {
  const s = setupFeed({ graduationStore: {
      load: async () => new Map([[mint(200), { graduated_at: LEDGER_AT, source: "browser_amm" }]]),
    }, state: { coins: fullRoster() } });
  const { body } = await s.read(s.request("?status=GRADUATED&pageSize=100"));
  const row = body.ranked.find((r) => r.mint === mint(200));
  assert.ok(row, "The ledger row must be served in the paged tape");
  assert.equal(row.status, "GRADUATED");
  assert.equal(row.curveComplete, true);
  assert.equal(row.curveProgress, 100);
  assert.equal(row.statusAt, LEDGER_AT);
  assert.equal(body.statusCounts.GRADUATED, 1);
});

test("an unavailable ledger degrades to a status error, never a failed feed", async () => {
  const s = setupFeed({ graduationStore: { load: async () => { throw new Error("ledger down"); } } });
  const { response, body } = await s.read();
  assert.equal(response.status, 200);
  assert.equal(body.ranked[0].status, "BONDING");
  assert.deepEqual(body.statusError, ["GRADUATION_LEDGER_UNAVAILABLE"]);
});

function setupReport(options = {}) {
  const saves = [];
  const store = options.store || { load: async () => new Map(),
    save: async (getClient, graduates) => { saves.push(...graduates); return graduates.length; } };
  const verifyComplete = options.verifyComplete || (async (mints) => new Set(mints));
  const handler = createGraduationReportHandler({ verifyComplete, store,
    createClient: () => ({ asServiceRole: {} }), clock: () => NOW });
  const post = (payload) => handler(new Request("https://example.test/reportLauncherGraduation", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }));
  return { handler, post, saves };
}

test("graduation reports persist only on-chain-verified mints, once each", async () => {
  const s = setupReport({ verifyComplete: async (mints) => new Set(mints.filter((m) => m === mint(1))) });
  const response = await s.post({ mints: [mint(1), mint(2)] });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.verified, 1);
  assert.equal(body.saved, 1);
  assert.equal(body.rejected, 1);
  assert.deepEqual(s.saves, [{ mint: mint(1), graduated_at: NOW, source: "browser_amm" }]);
  // Duplicate nominations collapse to one verification and one save.
  const dedup = await s.post({ mints: [mint(1), mint(1)] });
  assert.equal((await dedup.json()).verified, 1);
});

test("malformed graduation reports are rejected before any verification or write", async () => {
  const s = setupReport();
  for (const payload of [{}, { mints: [] }, { mints: "x" }, { mints: [42] },
    { mints: [mint(1), "extra"] }, { mints: Array(26).fill(mint(1)) }]) {
    const response = await s.post(payload);
    assert.equal(response.status, 400, `payload ${JSON.stringify(payload)} must be invalid`);
  }
  assert.equal(s.saves.length, 0);
  assert.equal((await s.handler(new Request("https://example.test/report"))).status, 405);
});

test("verifier accepts only canonical mints whose on-chain curve is complete", async () => {
  let rpcCalls = 0;
  const accounts = new Map([[derive(mint(1)), account(true)], [derive(mint(2)), account(false)]]);
  const { createGraduationVerifier } = await import("../base44/shared/launcherGraduates.ts");
  const verifyComplete = createGraduationVerifier({
    rpc: async (method, params) => {
      rpcCalls++;
      assert.equal(method, "getMultipleAccounts");
      return { value: params[0].map((address) => accounts.get(address) ?? null) };
    },
    deriveCurveAddress: derive,
  });
  const verified = await verifyComplete([mint(1), mint(2), mint(3), "bad", 42, "0".repeat(32)]);
  assert.equal(rpcCalls, 1, "One batched probe for the three canonical mints");
  assert.deepEqual([...verified], [mint(1)]);
});

test("the ledger store caches reads, dedupes rows, and writes each mint once", async () => {
  const { createLauncherGraduationStore } = await import("../base44/shared/launcherGraduates.ts");
  let now = 0, listCalls = 0;
  const created = [];
  const rows = [{ mint: mint(1), graduated_at: 2, source: "browser_amm" }, // create-tie duplicate
    { mint: mint(1), graduated_at: 1 }];
  const ledger = { list: async () => { listCalls++; return structuredClone(rows); },
    bulkCreate: async (items) => { created.push(...structuredClone(items)); return items; } };
  const getClient = () => ({ asServiceRole: { entities: { LauncherGraduate: ledger } } });
  const store = createLauncherGraduationStore({ clock: () => now, cacheMs: 100 });
  const entries = await store.load(getClient);
  assert.equal(entries.size, 1, "Duplicate ledger rows collapse by mint");
  assert.equal(entries.get(mint(1)).graduated_at, 2, "Newest graduation time wins");
  await store.load(getClient);
  assert.equal(listCalls, 1, "The cache window collapses repeated loads");
  now = 101;
  await store.load(getClient);
  assert.equal(listCalls, 2);
  assert.equal(await store.save(getClient, [{ mint: mint(1) }, { mint: mint(2), graduated_at: 5 }, { mint: "bad" }]), 1);
  assert.deepEqual(created, [{ mint: mint(2), symbol: "", name: "", graduated_at: 5, source: "browser_amm" }]);
  assert.equal(await store.save(getClient, [{ mint: mint(2) }]), 0, "Known mints are never re-written");
  assert.equal(created.length, 1);
});