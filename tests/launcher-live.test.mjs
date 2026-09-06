import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { setImmediate as tick } from "node:timers/promises";
import { PublicKey } from "@solana/web3.js";
import { createLauncherLiveHandler, launcherCandidates, rankLauncherRows } from "../base44/functions/getLauncherLive/handler.js";
import { createCurveAddressDeriver, curveFundingProgress, decodeLauncherCurve, hasConfirmedAmmPair,
  launcherStatus, PUMP_CURVE_DISCRIMINATOR, PUMP_PROGRAM_ID } from "../base44/shared/launcherCurve.js";

const NOW = 1_800_000_000_000;
const COINS = "https://otcdesks.cash/api/coins";
const DEX = "https://api.dexscreener.com/latest/dex/tokens/";
const derive = createCurveAddressDeriver(PublicKey);
const mint = (i) => {
  const bytes = new Uint8Array(32);
  new DataView(bytes.buffer).setUint32(28, i);
  return new PublicKey(bytes).toBase58();
};
const request = (query = "") => new Request(`https://example.test/getLauncherLive${query}`);
const coin = (i, snapshot = {}, extra = {}) => ({
  mint: mint(i), symbol: `C${i}`, name: `Coin ${i}`, image: "https://example.test/coin.png",
  createdAt: NOW / 1000 - (i + 1) * 3600,
  snapshot: { volume24h: 100, marketCap: 2000, liquidity: 400, change24h: -i, ...snapshot }, ...extra,
});
const reserves = (extra = {}) => ({ virtualToken: 1000n, virtualQuote: 30n, realToken: 800n,
  realQuote: 0n, complete: false, ...extra });
const near = { virtualToken: 110n, virtualQuote: 100n, realToken: 10n, realQuote: 90n };
function account(extra = {}, size = 49) {
  const r = reserves(extra), bytes = Buffer.alloc(size);
  bytes.set(PUMP_CURVE_DISCRIMINATOR);
  [r.virtualToken, r.virtualQuote, r.realToken, r.realQuote, 1_000_000n]
    .forEach((value, i) => bytes.writeBigUInt64LE(value, 8 + i * 8));
  bytes[48] = Number(r.complete);
  return { owner: PUMP_PROGRAM_ID, executable: false, data: [bytes.toString("base64"), "base64"] };
}
const pair = (token, extra = {}) => ({ chainId: "solana", dexId: "pumpswap", pairAddress: mint(999),
  baseToken: { address: token }, quoteToken: { address: mint(998) }, liquidity: { usd: 1 }, ...extra });
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function setup(options = {}) {
  let now = NOW, active = 0, maxActive = 0;
  const state = { coins: [coin(1)], dex: { pairs: [] }, accounts: new Map([[derive(mint(1)), account()]]),
    failCoins: false, failDex: false, failRpc: false, ...options.state };
  const calls = [];
  async function tracked(call, work) {
    calls.push(call);
    maxActive = Math.max(maxActive, ++active);
    try { await Promise.resolve(); return await work(); }
    finally { active--; }
  }
  const handler = createLauncherLiveHandler({ clock: () => now, deriveCurveAddress: derive,
    probeTimeoutMs: options.probeTimeoutMs ?? 1000,
    rpc: (method, params) => tracked({ type: "rpc", method, params }, async () => {
      assert.equal(method, "getMultipleAccounts");
      assert.ok(params[0].length <= 100);
      assert.deepEqual(params[1], { encoding: "base64", commitment: "confirmed", dataSlice: { offset: 0, length: 49 } });
      if (state.failRpc) throw new Error("unsafe upstream detail");
      if (state.rpcHook) return state.rpcHook(params[0]);
      if (Object.hasOwn(state, "rpcResult")) return state.rpcResult;
      return { value: params[0].map((address) => state.accounts.get(address) ?? null) };
    }),
    fetchImpl: (url, options) => tracked({ type: url === COINS ? "coins" : "dex", url }, async () => {
      assert.ok(options.signal instanceof AbortSignal);
      if (url === COINS) {
        if (state.coinsHook) await state.coinsHook();
        if (state.failCoins) throw new Error("unsafe upstream detail");
        // Keep NaN/Infinity intact to test sanitization before JSON serialization.
        return { ok: true, json: async () => structuredClone(state.coins) };
      }
      assert.ok(url.startsWith(DEX));
      assert.ok(url.slice(DEX.length).split(",").length <= 30);
      if (state.dexHook) return state.dexHook(url.slice(DEX.length).split(","));
      if (state.failDex) return new Response(null, { status: 503 });
      return { ok: true, json: async () => structuredClone(state.dex) };
    }),
  });
  return { handler, state, calls, clock: () => now, advance: (ms) => { now += ms; },
    maxActive: () => maxActive,
    read: async (req = request()) => {
      const response = await handler(req);
      return { response, body: await response.json() };
    } };
}

function fullRoster() {
  // Deliberately disjoint volume, momentum, and newest cohorts (150 of 220).
  return Array.from({ length: 220 }, (_, i) => coin(i, {
    volume24h: i < 60 ? 1000 + i : 1,
    change24h: i >= 60 && i < 120 ? 1000 + i : -1000,
  }, { createdAt: NOW / 1000 - (i >= 120 && i < 150 ? i : 1_000_000 + i) }));
}

test("official Anchor discriminator, PDA seed order, and program are pinned", () => {
  assert.equal(PUMP_PROGRAM_ID, "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
  assert.deepEqual(PUMP_CURVE_DISCRIMINATOR, [23, 183, 248, 55, 96, 216, 172, 96]);
  assert.deepEqual([...createHash("sha256").update("account:BondingCurve").digest().subarray(0, 8)],
    [...PUMP_CURVE_DISCRIMINATOR]);
  const expected = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"),
    new PublicKey(mint(1)).toBytes()], new PublicKey(PUMP_PROGRAM_ID))[0].toBase58();
  assert.equal(derive(mint(1)), expected);
  for (const invalid of ["bad", "../escape", "0".repeat(32), "z".repeat(44), null]) {
    assert.throws(() => derive(invalid));
  }
});

test("reserve-derived quote funding is zero, exactly 90, and 100 on completion", () => {
  assert.equal(curveFundingProgress(reserves()), 0);
  assert.equal(curveFundingProgress(reserves(near)), 90);
  assert.equal(curveFundingProgress(reserves({ virtualToken: 0n, virtualQuote: 0n,
    realToken: 0n, realQuote: 0n, complete: true })), 100);
  assert.equal(curveFundingProgress(reserves({ virtualToken: 11_000_000n, virtualQuote: 10_000_000n,
    realToken: 1_000_000n, realQuote: 8_999_999n })), 89.9999);
  assert.equal(launcherStatus({ curveComplete: false, curveProgress: 89.9999 }, false), "BONDING");
});

test("u64 arithmetic stays exact beyond Number precision and rejects invalid/overflow targets", () => {
  const scale = 100_000_000_000_000_000n, max = (1n << 64n) - 1n;
  assert.equal(curveFundingProgress(reserves(Object.fromEntries(Object.entries(near)
    .map(([key, value]) => [key, value * scale])))), 90);
  for (const bad of [
    { virtualToken: 0n }, { virtualQuote: 0n }, { realToken: 1000n }, { realToken: 1001n },
    { realQuote: 31n }, { realToken: 0n, realQuote: 0n }, { virtualToken: 1000 },
    { virtualQuote: -1n }, { realQuote: max + 1n }, { virtualQuote: max }, { complete: 1 },
  ]) assert.equal(curveFundingProgress(reserves(bad)), null);
  // A >64-bit product is valid; only the final u64 reserve targets must fit.
  assert.equal(curveFundingProgress(reserves({ virtualToken: max, virtualQuote: max / 2n,
    realToken: 0n, realQuote: 1n })), 100);
});

test("49-byte and extended curve layouts decode; absent and invalid accounts stay distinct", () => {
  for (const size of [49, 81, 115]) {
    assert.deepEqual(decodeLauncherCurve(account(near, size)), { curveProgress: 90, curveComplete: false });
  }
  assert.equal(decodeLauncherCurve(null), null);
  assert.deepEqual(decodeLauncherCurve(account({ complete: true })), { curveProgress: 100, curveComplete: true });
  assert.deepEqual(decodeLauncherCurve(account({ realToken: 1000n })), { curveProgress: null, curveComplete: false });
  const corrupted = (index, byte) => {
    const a = account(), bytes = Buffer.from(a.data[0], "base64");
    bytes[index] = byte;
    return { ...a, data: [bytes.toString("base64"), "base64"] };
  };
  for (const invalid of [undefined, {}, { ...account(), owner: mint(3) },
    { ...account(), executable: true }, { ...account(), data: ["!!", "base64"] },
    { ...account(), data: [account().data[0], "jsonParsed"] },
    { ...account(), data: [Buffer.alloc(48).toString("base64"), "base64"] },
    corrupted(0, 0), corrupted(48, 2),
  ]) assert.throws(() => decodeLauncherCurve(invalid), /CURVE_ACCOUNT_INVALID/);
});

test("graduation requires the exact mint, Solana, a known AMM, pair address, and positive liquidity", () => {
  const token = mint(1);
  for (const dexId of ["pumpswap", "raydium", "meteora"]) assert.equal(hasConfirmedAmmPair(token, [pair(token, { dexId })]), true);
  assert.equal(hasConfirmedAmmPair(token, [pair(mint(2), { quoteToken: { address: token } })]), true);
  for (const bad of [null, pair(mint(2)), pair(token, { chainId: "ethereum" }), pair(token, { chainId: undefined }),
    pair(token, { dexId: "pumpfun" }), pair(token, { dexId: "some-new-amm" }),
    pair(token, { pairAddress: undefined }), pair(token, { pairAddress: "bad" }),
    ...[0, -1, null, NaN, Infinity, "100"].map((usd) => pair(token, { liquidity: { usd } })),
  ]) assert.equal(hasConfirmedAmmPair(token, [bad]), false);
  const complete = { curveComplete: true, curveProgress: 100 };
  assert.equal(launcherStatus(complete, false), "ABOUT_TO_GRADUATE");
  assert.equal(launcherStatus(complete, true), "GRADUATED");
  assert.equal(launcherStatus({ curveComplete: false, curveProgress: 0 }, true), "GRADUATED");
  assert.equal(launcherStatus(null, false), "UNKNOWN");
});

test("row contract preserves finite zeros/losses and sanitizes unknown metrics and images", async () => {
  const s = setup({ state: { coins: [
    coin(1, { volume24h: 0, marketCap: 0, liquidity: 0, change24h: 0 }),
    coin(2, { volume24h: -1, marketCap: Infinity, liquidity: "2", change24h: -20 }, { createdAt: null, symbol: null }),
    coin(3, { volume24h: NaN, marketCap: undefined, liquidity: false, change24h: "30" },
      { createdAt: NOW + 1000, image: "javascript:alert(1)" }),
    coin(4, { volume24h: "5", change24h: -Infinity }, { createdAt: NOW - 3_600_000 }),
  ] } });
  const { body } = await s.read();
  assert.deepEqual(body.ranked.map((r) => r.mint), [mint(1), mint(2), mint(3), mint(4)]);
  assert.deepEqual(Object.keys(body.ranked[0]).sort(), ["mint", "symbol", "name", "image", "logoUrl", "socials", "payoutInfo", "vol24", "mcap", "liquidity",
    "change24h", "ageH", "metricsAt", "curveProgress", "status", "curveComplete", "statusAt"].sort());
  assert.deepEqual([body.ranked[0].vol24, body.ranked[0].mcap, body.ranked[0].liquidity, body.ranked[0].change24h], [0, 0, 0, 0]);
  assert.equal(body.ranked[1].symbol, "");
  assert.equal(body.ranked[1].change24h, -20);
  assert.equal(body.ranked[1].ageH, null);
  assert.equal(body.ranked[2].image, "");
  assert.equal(body.ranked[2].ageH, null);
  assert.equal(body.ranked[3].ageH, 1);
  for (const row of body.ranked.slice(1)) {
    assert.equal(row.vol24, null);
    assert.equal(row.metricsAt, null, "Missing source timestamps are not replaced with fetch time");
  }
  for (const key of ["mcap", "liquidity"]) assert.equal(body.ranked[1][key], null);
  assert.equal(body.ranked[2].change24h, null);
  assert.equal(body.ranked[3].change24h, null);
});

test("source image alias and nested/flat socials have safe per-field precedence and empty defaults", async () => {
  const s = setup({ state: { coins: [
    coin(1, {}, { image: " https://example.test/source.png ",
      socials: { twitter: " https://x.com/nested ", telegram: "javascript:alert(1)" },
      twitter: "https://x.com/flat", telegram: "https://t.me/flat", website: "http://example.test" }),
    coin(2, {}, { image: null, socials: [], twitter: "https://x.com/flat-only" }),
    coin(3, {}, { image: null }),
  ], dex: { pairs: [pair(mint(1), { info: { imageUrl: "https://example.test/dex.png",
    socials: [{ type: "twitter", url: "https://x.com/dex" }, { type: "telegram", url: "https://t.me/dex" }],
    websites: [{ url: "https://dex.test" }] } })] } } });
  const { body } = await s.read(), [nested, flat, empty] = body.ranked;
  assert.equal(nested.image, "https://example.test/source.png");
  assert.equal(nested.logoUrl, nested.image);
  assert.deepEqual(nested.socials, { twitter: "https://x.com/nested", telegram: "https://t.me/flat", website: "http://example.test/" });
  assert.deepEqual(flat.socials, { twitter: "https://x.com/flat-only", telegram: "", website: "" });
  assert.equal(flat.logoUrl, "");
  assert.equal(empty.image, "");
  assert.equal(empty.logoUrl, "");
  assert.deepEqual(empty.socials, { twitter: "", telegram: "", website: "" });
  assert.ok(body.ranked.every((row) => row.payoutInfo === null));
});

test("unsafe and malformed source URLs are empty, not links or batch errors", async () => {
  const invalid = [undefined, null, false, 42, {}, [], "", "not a URL", "/relative", "//example.test",
    "javascript:alert(1)", "data:image/png;base64,AA==", "blob:https://example.test/id", "ftp://example.test/a",
    "https://user@example.test", "http://user:pass@example.test", "https://"];
  const coins = invalid.map((value, i) => coin(i + 1, {}, {
    image: value, socials: { twitter: value, telegram: value, website: value },
    twitter: value, telegram: value, website: value,
  }));
  const { response, body } = await setup({ state: { coins } }).read();
  assert.equal(response.status, 200);
  assert.equal(body.statusError, null);
  assert.equal(body.statusChecked, coins.length);
  for (const row of body.ranked) {
    assert.equal(row.image, "");
    assert.equal(row.logoUrl, "");
    assert.deepEqual(row.socials, { twitter: "", telegram: "", website: "" });
  }
});

test("payout settings map source fields independently, retain cycle zero, and deduplicate mint-shaped baskets", async () => {
  const basket = [mint(10), ` ${mint(11)} `, mint(10), null, {}, { mint: mint(12) }, 12, "",
    "0".repeat(32), "1".repeat(31), "z".repeat(45), "O".repeat(32), "I".repeat(32), "l".repeat(32),
    "1".repeat(32), "z".repeat(44)];
  const coins = [
    coin(1, {}, { rewardMint: ` ${mint(10)} `, rewardSymbol: " USDC ", rewardCycle: 0, rewardBasket: basket }),
    coin(2, {}, { rewardCycle: 0 }),
    coin(3, {}, { rewardCycle: Number.MAX_SAFE_INTEGER }),
    coin(4, {}, { rewardSymbol: " REPORTED ", rewardMint: "invalid" }),
    coin(5, {}, { rewardMint: mint(12) }),
    coin(6, {}, { rewardBasket: [mint(13)] }),
  ];
  const { body } = await setup({ state: { coins } }).read();
  assert.deepEqual(body.ranked.map((row) => row.payoutInfo), [
    { rewardMint: mint(10), rewardSymbol: "USDC", rewardCycle: 0,
      rewardBasket: [mint(10), mint(11), "1".repeat(32), "z".repeat(44)] },
    { rewardMint: null, rewardSymbol: null, rewardCycle: 0, rewardBasket: [] },
    { rewardMint: null, rewardSymbol: null, rewardCycle: Number.MAX_SAFE_INTEGER, rewardBasket: [] },
    { rewardMint: null, rewardSymbol: "REPORTED", rewardCycle: null, rewardBasket: [] },
    { rewardMint: mint(12), rewardSymbol: null, rewardCycle: null, rewardBasket: [] },
    { rewardMint: null, rewardSymbol: null, rewardCycle: null, rewardBasket: [mint(13)] },
  ]);
});

test("missing and malformed payout metadata remains unknown without coercion or status errors", async () => {
  const invalidCycles = [undefined, null, false, true, "0", "60", -1, 0.5, NaN, Infinity, -Infinity,
    Number.MAX_SAFE_INTEGER + 1, [], {}];
  const invalidBaskets = [undefined, null, {}, mint(10), [null, 1, {}, { mint: mint(10) }, "bad"]];
  const coins = invalidCycles.map((rewardCycle, i) => coin(i + 1, {}, {
    rewardMint: i % 2 ? {} : "not-a-mint", rewardSymbol: i % 2 ? false : " ", rewardCycle,
    rewardBasket: invalidBaskets[i % invalidBaskets.length],
  }));
  coins.push(coin(100, {}, { rewardMint: null, rewardSymbol: null, rewardBasket: [] }));
  const s = setup({ state: { coins, dex: { pairs: [pair(mint(1), {
    baseToken: { address: mint(1), symbol: "DO_NOT_INFER" }, info: { rewardSymbol: "NOT_A_SOURCE" },
  })] } } });
  const { response, body } = await s.read();
  assert.equal(response.status, 200);
  assert.ok(body.ranked.every((row) => row.payoutInfo === null));
  assert.equal(body.statusError, null);
  assert.equal(body.statusChecked, coins.length);
  assert.equal(body.ranked[0].status, "GRADUATED");
});

test("DEX metadata requires exact Solana BASE matching; quote matching still establishes graduation", async () => {
  const info = { imageUrl: "https://example.test/dex.png", socials: [{ type: "twitter", url: "https://x.com/base" }],
    websites: [{ url: "https://base.test" }] };
  const s = setup({ state: { coins: [coin(1, {}, { image: "" }), coin(2, {}, { image: "" })],
    dex: { pairs: [
      pair(mint(2), { quoteToken: { address: mint(1) }, info }),
      pair(mint(1), { chainId: "ethereum", info }), pair(mint(1), { chainId: undefined, info }),
      pair(`${mint(1)}suffix`, { info }), pair(` ${mint(1)} `, { info }),
    ] } } });
  const { body } = await s.read(), [quote, base] = body.ranked;
  assert.equal(quote.status, "GRADUATED");
  assert.equal(quote.logoUrl, "");
  assert.deepEqual(quote.socials, { twitter: "", telegram: "", website: "" });
  assert.equal(base.logoUrl, info.imageUrl);
  assert.equal(base.image, "", "DEX fallback does not change the legacy source image");
  assert.deepEqual(base.socials, { twitter: "https://x.com/base", telegram: "", website: "https://base.test/" });
  assert.equal(body.statusError, null);
});

test("DEX fallback is descending finite-liquidity, per-field, and deterministic across pair order and ties", async () => {
  const info = (label) => ({ imageUrl: `https://example.test/${label}.png`,
    socials: [{ type: "twitter", url: `https://x.com/${label}` }] });
  const preferred = { ...info("high"), socials: [{ type: "twitter", url: "https://x.com/a-high" },
    { type: "twitter", url: "https://x.com/z-high" }, { type: "telegram", url: "javascript:alert(1)" }] };
  const pairs = [
    pair(mint(1), { liquidity: { usd: 100 }, info: { ...info("low"),
      socials: [{ type: "telegram", url: "https://t.me/low" }], websites: [{ url: "https://low.test" }] } }),
    pair(mint(1), { pairAddress: "B".repeat(32), liquidity: { usd: 500 }, info: info("other-tie") }),
    pair(mint(1), { pairAddress: "A".repeat(32), liquidity: { usd: 500 }, info: preferred }),
    pair(mint(1), { pairAddress: "A".repeat(32), liquidity: { usd: 500 }, info: {
      ...info("high"), socials: [{ type: "twitter", url: "https://x.com/z-tie" }] } }),
    pair(mint(1), { liquidity: { usd: 1000 }, info: { imageUrl: "data:image/png,bad", socials: {} } }),
    ...[Infinity, NaN, "9999", undefined, -Infinity].map((usd) => pair(mint(1), { liquidity: { usd }, info: info("invalid") })),
    pair(mint(2), { liquidity: { usd: 0 }, dexId: "pumpfun", info: info("zero") }),
    pair(mint(2), { liquidity: { usd: -1 }, info: info("negative") }),
    pair(mint(2), { liquidity: { usd: Infinity }, info: info("infinite") }),
  ];
  let original;
  for (const ordered of [pairs, [...pairs].reverse(), [...pairs.slice(5), ...pairs.slice(0, 5)]]) {
    const s = setup({ state: { coins: [coin(1, {}, { image: "" }), coin(2, {}, { image: "" })], dex: { pairs: ordered } } });
    const { body } = await s.read();
    assert.equal(body.statusError, null);
    assert.equal(body.ranked[0].logoUrl, "https://example.test/high.png");
    assert.deepEqual(body.ranked[0].socials, { twitter: "https://x.com/a-high", telegram: "https://t.me/low", website: "https://low.test/" });
    assert.equal(body.ranked[1].logoUrl, "https://example.test/zero.png");
    assert.equal(body.ranked[1].status, "UNKNOWN", "Metadata is not graduation evidence");
    assert.equal(body.ranked[0].payoutInfo, null);
    assert.equal(s.calls.length, 3, "Only the existing coins/RPC/DEX requests are used");
    if (original) assert.deepEqual(body, original);
    original = body;
  }
});

test("malformed DEX metadata cannot poison status or neighboring rows in a successful batch", async () => {
  const malformed = [undefined, null, false, 12, "bad", [], {}, { imageUrl: {}, socials: {}, websites: "bad" },
    { imageUrl: "https://user:pass@example.test", socials: [null, false, {}, { type: {}, url: {} },
      { type: "twitter", url: "javascript:alert(1)" }, { type: "telegram", url: "ftp://example.test" }],
      websites: [null, {}, { url: "//example.test" }] }];
  const s = setup({ state: { coins: [coin(1, {}, { image: "" }), coin(2, {}, { image: "" })], dex: { pairs: [
    null, 42, "bad", false, {}, ...malformed.map((info) => pair(mint(1), { info })),
    pair(mint(2), { info: { imageUrl: "https://example.test/valid.png", socials: [null,
      { type: "telegram", url: "https://t.me/valid" }, { type: "discord", url: "https://discord.test" }],
      websites: [{ url: "javascript:alert(1)" }, { url: "https://valid.test" }] } }),
  ] } } });
  const { body } = await s.read();
  assert.equal(body.statusError, null);
  assert.equal(body.statusChecked, 2);
  assert.deepEqual(body.ranked.map((row) => row.status), ["GRADUATED", "GRADUATED"]);
  assert.equal(body.ranked[0].logoUrl, "");
  assert.deepEqual(body.ranked[0].socials, { twitter: "", telegram: "", website: "" });
  assert.equal(body.ranked[1].logoUrl, "https://example.test/valid.png");
  assert.deepEqual(body.ranked[1].socials, { twitter: "", telegram: "https://t.me/valid", website: "https://valid.test/" });
});

test("metric timestamps preserve actual source freshness in seconds or milliseconds", async () => {
  const s = setup({ state: { coins: [
    coin(1, { at: (NOW - 60_000) / 1000 }), coin(2, { at: NOW - 300_000 }),
    coin(3, { at: NOW + 10_000 }), coin(4, { at: "1788000000" }),
  ] } });
  const { body } = await s.read();
  assert.deepEqual(body.ranked.map((row) => row.metricsAt), [NOW - 60_000, NOW - 300_000, null, null]);
  assert.equal(body.at, NOW);
});

test("ranking is immutable, stable, null-last even for all losses and extreme finite values", () => {
  const rows = [{ id: "null", k: null }, { id: "loss", k: -8 }, { id: "missing" }, { id: "high", k: -1 },
    { id: "nan", k: NaN }, { id: "infinity", k: Infinity }, { id: "string", k: "999" }];
  const before = structuredClone(rows);
  assert.deepEqual(rankLauncherRows(rows, "k").map((r) => r.id), ["high", "loss", "null", "missing", "nan", "infinity", "string"]);
  assert.deepEqual(rows, before);
  assert.deepEqual(rankLauncherRows([{ k: -Number.MAX_VALUE }, { k: Number.MAX_VALUE }], "k")
    .map((r) => r.k), [Number.MAX_VALUE, -Number.MAX_VALUE]);
});

test("full roster survives old top-60 limits; disjoint union is 150 with 100/30 batches and bounded concurrency", async () => {
  const coins = fullRoster().map((row) => ({ ...row, image: "", rewardCycle: 0 }));
  const info = { imageUrl: "https://example.test/dex.png", socials: [{ type: "twitter", url: "https://x.com/dex" }] };
  const s = setup({ state: { coins, accounts: new Map(coins.map((c) => [derive(c.mint), account()])),
    dex: { pairs: coins.map((c) => pair(c.mint, { info })) } } });
  const { body } = await s.read();
  assert.equal(body.ranked.length, 220);
  assert.equal(body.candidateCount, 150);
  assert.equal(body.statusChecked, 150);
  assert.equal(body.statusError, null);
  assert.equal(body.nearThreshold, 90);
  assert.equal(launcherCandidates(body.ranked).length, 150);
  assert.deepEqual(s.calls.filter((c) => c.type === "rpc").map((c) => c.params[0].length), [100, 50]);
  assert.deepEqual(s.calls.filter((c) => c.type === "dex").map((c) => c.url.slice(DEX.length).split(",").length), [30, 30, 30, 30, 30]);
  assert.equal(s.calls.length, 8, "Metadata adds no requests to the one coins, two RPC and five DEX batches");
  assert.equal(body.ranked.filter((r) => r.logoUrl === info.imageUrl).length, 150);
  assert.equal(body.ranked.filter((r) => r.socials.twitter === "https://x.com/dex").length, 150);
  assert.ok(body.ranked.every((r) => r.payoutInfo.rewardCycle === 0), "Source payout coverage is not candidate-limited");
  assert.ok(s.maxActive() <= 3);
  for (const i of [65, 125]) assert.equal(body.ranked.find((r) => r.mint === mint(i)).status, "GRADUATED");
  for (const i of [150, 199, 219]) {
    const row = body.ranked.find((r) => r.mint === mint(i));
    assert.equal(row.status, "UNKNOWN");
    assert.equal(row.logoUrl, "");
    assert.deepEqual(row.socials, { twitter: "", telegram: "", website: "" });
    for (const key of ["curveProgress", "curveComplete", "statusAt"]) assert.equal(row[key], null);
  }
});

test("overlapping candidate lists are deduplicated, not padded up to 150", async () => {
  const coins = Array.from({ length: 100 }, (_, i) => coin(i, { volume24h: 100 - i, change24h: 100 - i }));
  const { body } = await setup({ state: { coins } }).read();
  assert.equal(body.ranked.length, 100);
  assert.equal(body.candidateCount, 60);
  assert.equal(body.statusChecked, 60);
});

test("30-second cache expiry refreshes metrics, ages, ranking and status evidence", async () => {
  const s = setup({ state: { coins: [coin(1, { volume24h: 10 }), coin(2, { volume24h: 5 })] } });
  const first = await s.read();
  assert.equal(first.response.headers.get("X-Launcher-Cache"), "miss");
  assert.equal(first.response.headers.get("Cache-Control"), "no-store");
  assert.equal(first.body.stale, false);
  s.state.coins = [coin(1, { volume24h: 1 }), coin(2, { volume24h: 50, change24h: 42 })];
  s.state.accounts.set(derive(mint(2)), account(near));
  s.advance(29_999);
  const hit = await s.read();
  assert.equal(hit.response.headers.get("X-Launcher-Cache"), "hit");
  assert.deepEqual(hit.body, first.body);
  s.advance(1);
  const fresh = await s.read();
  assert.equal(fresh.response.headers.get("X-Launcher-Cache"), "miss");
  assert.equal(fresh.body.at, NOW + 30_000);
  assert.equal(fresh.body.ranked[0].mint, mint(2));
  assert.equal(fresh.body.ranked[0].change24h, 42);
  assert.equal(fresh.body.ranked[0].status, "ABOUT_TO_GRADUATE");
  assert.equal(fresh.body.ranked[0].statusAt, NOW + 30_000);
  assert.ok(fresh.body.ranked[0].ageH > first.body.ranked[1].ageH);
  assert.equal(s.calls.filter((c) => c.type === "coins").length, 2);
});

test("metadata is retained on cache hits/stale responses and rebuilt without carrying missing data forward", async () => {
  const s = setup({ state: { coins: [coin(1, {}, { image: "", rewardCycle: 0 })], dex: { pairs: [pair(mint(1), {
    info: { imageUrl: "https://example.test/cached.png", socials: [{ type: "twitter", url: "https://x.com/cached" }] },
  })] } } });
  const first = await s.read(), calls = s.calls.length;
  assert.equal(first.body.ranked[0].payoutInfo.rewardCycle, 0);
  assert.equal(first.body.ranked[0].logoUrl, "https://example.test/cached.png");
  s.state.coins = [coin(1, {}, { image: "" })];
  s.state.dex = { pairs: [] };
  s.advance(29_999);
  const hit = await s.read();
  assert.equal(hit.response.headers.get("X-Launcher-Cache"), "hit");
  assert.deepEqual(hit.body, first.body);
  assert.equal(s.calls.length, calls);
  s.advance(1);
  s.state.failCoins = true;
  const stale = await s.read();
  assert.equal(stale.response.headers.get("X-Launcher-Cache"), "stale");
  assert.equal(stale.body.at, first.body.at);
  assert.deepEqual(stale.body.ranked, first.body.ranked);
  assert.equal(s.calls.length, calls + 1, "A failed roster does not trigger metadata probes");
  s.state.failCoins = false;
  s.state.failDex = true;
  const fresh = await s.read(), row = fresh.body.ranked[0];
  assert.equal(fresh.response.headers.get("X-Launcher-Cache"), "miss");
  assert.equal(fresh.body.stale, false);
  assert.equal(row.logoUrl, "");
  assert.deepEqual(row.socials, { twitter: "", telegram: "", website: "" });
  assert.equal(row.payoutInfo, null);
  assert.equal(row.status, "BONDING");
  assert.deepEqual(fresh.body.statusError, ["DEXSCREENER_UNAVAILABLE"]);
});

test("cold and expired concurrent requests singleflight the entire rebuild", async () => {
  const s = setup();
  for (let round = 0; round < 2; round++) {
    const entered = deferred(), release = deferred();
    s.state.coinsHook = async () => { entered.resolve(); await release.promise; };
    const first = s.read();
    await entered.promise;
    const others = Array.from({ length: 5 }, () => s.read());
    await tick();
    assert.equal(s.calls.filter((c) => c.type === "coins").length, round + 1);
    release.resolve();
    const responses = await Promise.all([first, ...others]);
    assert.ok(responses.every((r) => r.response.headers.get("X-Launcher-Cache") === "miss"));
    for (const r of responses) assert.deepEqual(r.body, responses[0].body);
    s.advance(30_000);
  }
});

test("failed coins use clearly stale data only through total age 120 seconds and recover on retry", async () => {
  const s = setup(), initial = await s.read();
  s.state.failCoins = true;
  s.advance(30_000);
  const stale = await s.read();
  assert.equal(stale.response.headers.get("X-Launcher-Cache"), "stale");
  assert.equal(stale.body.stale, true);
  assert.equal(stale.body.sourceError, "COINS_UNAVAILABLE");
  assert.equal(stale.body.at, initial.body.at);
  assert.deepEqual(stale.body.ranked, initial.body.ranked);
  s.advance(90_000);
  assert.equal((await s.read()).response.status, 200);
  s.advance(1);
  const expired = await s.read();
  assert.equal(expired.response.status, 502);
  assert.equal(expired.response.headers.get("X-Launcher-Cache"), "error");
  assert.equal(JSON.stringify(expired.body).includes("unsafe upstream detail"), false);
  assert.equal(expired.body.ranked, undefined);
  s.state.failCoins = false;
  const recovered = await s.read();
  assert.equal(recovered.response.status, 200);
  assert.equal(recovered.body.stale, false);
  assert.equal(recovered.body.at, s.clock());
});

test("stale limit is checked after a slow failure and cache age begins at coin observation", async () => {
  const s = setup();
  s.state.rpcHook = async (addresses) => { s.advance(10_000); return { value: addresses.map(() => null) }; };
  assert.equal((await s.read()).body.at, NOW);
  s.advance(109_000);
  s.state.failCoins = true;
  s.state.coinsHook = async () => { s.advance(2000); };
  assert.equal((await s.read()).response.status, 502);
});

test("cache state belongs to the handler instance, not to a global cross-isolate store", async () => {
  const a = setup(), b = setup({ state: { failCoins: true } });
  assert.equal((await a.read()).response.status, 200);
  assert.equal((await b.read()).response.status, 502);
});

test("supported roster envelopes, empty rosters and missing symbols are valid; malformed feeds are cold 502", async () => {
  for (const coins of [[coin(1)], { coins: [coin(1)] }, { data: [coin(1)] }, { tokens: [coin(1)] }, [coin(1, {}, { symbol: null })]]) {
    assert.equal((await setup({ state: { coins } }).read()).body.ranked.length, 1);
  }
  const empty = await setup({ state: { coins: [] } }).read();
  assert.equal(empty.response.status, 200);
  assert.equal(empty.body.ranked.length, 0);
  assert.equal(empty.body.candidateCount, 0);
  for (const coins of [null, {}, { data: {} }, { error: "unavailable" }, [null, {}]]) {
    assert.equal((await setup({ state: { coins } }).read()).response.status, 502);
  }
  assert.equal((await setup({ state: { failCoins: true } }).read()).response.status, 502);
});

test("status precedence keeps completion pending, absent/invalid accounts unknown, and AMM evidence authoritative", async () => {
  const s = setup({ state: { coins: Array.from({ length: 6 }, (_, i) => coin(i + 1)),
    accounts: new Map([
      [derive(mint(1)), account()], [derive(mint(2)), account(near)],
      [derive(mint(3)), account({ complete: true })], [derive(mint(4)), { ...account(), owner: mint(99) }],
      [derive(mint(6)), account({ realToken: 1000n })],
    ]), dex: { pairs: [pair(mint(1)), pair(mint(3), { dexId: "pumpfun" }), pair(mint(5), { chainId: "ethereum" })] } } });
  const { body } = await s.read();
  assert.deepEqual(body.ranked.map((r) => r.status), ["GRADUATED", "ABOUT_TO_GRADUATE", "ABOUT_TO_GRADUATE", "UNKNOWN", "UNKNOWN", "UNKNOWN"]);
  assert.equal(body.ranked[0].curveProgress, 0, "AMM evidence must not invent 100% reserves");
  assert.equal(body.ranked[2].curveComplete, true);
  assert.equal(body.ranked[2].curveProgress, 100);
  assert.equal(body.ranked[3].curveComplete, null);
  assert.equal(body.ranked[4].curveProgress, null);
  assert.equal(body.ranked[5].curveComplete, false);
  assert.equal(body.statusChecked, 6, "successful empty probes count as checked, not known");
  assert.deepEqual(body.statusError, ["CURVE_ACCOUNT_INVALID", "CURVE_RESERVES_INVALID"]);
});

test("probe outages keep fresh metrics, report unavailability, and never carry old statuses forward", async () => {
  const s = setup({ state: { dex: { pairs: [pair(mint(1))] } } });
  assert.equal((await s.read()).body.ranked[0].status, "GRADUATED");
  s.advance(30_000);
  s.state.failRpc = true;
  s.state.failDex = true;
  s.state.coins[0].snapshot.change24h = 37;
  const { response, body } = await s.read();
  assert.equal(response.status, 200);
  assert.equal(body.stale, false);
  assert.equal(body.ranked[0].change24h, 37);
  assert.equal(body.ranked[0].status, "UNKNOWN");
  assert.equal(body.ranked[0].curveComplete, null);
  assert.equal(body.ranked[0].statusAt, null);
  assert.equal(body.statusChecked, 0);
  assert.deepEqual(body.statusError, ["CURVE_RPC_UNAVAILABLE", "DEXSCREENER_UNAVAILABLE"]);
});

test("each surviving source can supply evidence without fabricating the unavailable source", async () => {
  const rpcFailed = await setup({ state: { failRpc: true, dex: { pairs: [pair(mint(1))] } } }).read();
  assert.equal(rpcFailed.body.ranked[0].status, "GRADUATED");
  assert.equal(rpcFailed.body.ranked[0].curveComplete, null);
  assert.equal(rpcFailed.body.statusChecked, 1);
  const dexFailed = await setup({ state: { failDex: true } }).read();
  assert.equal(dexFailed.body.ranked[0].status, "BONDING");
  assert.deepEqual(dexFailed.body.statusError, ["DEXSCREENER_UNAVAILABLE"]);
});

test("one failing batch does not discard other candidate results", async () => {
  const coins = fullRoster(), s = setup({ state: { coins } });
  let rpcCalls = 0, dexCalls = 0;
  s.state.rpcHook = async (addresses) => {
    if (++rpcCalls === 1) throw new Error("unavailable");
    return { value: addresses.map(() => account()) };
  };
  s.state.dexHook = async () => {
    if (++dexCalls === 1) return new Response(null, { status: 429 });
    return Response.json({ pairs: [] });
  };
  const { body } = await s.read();
  assert.equal(body.ranked.length, 220);
  assert.equal(body.statusChecked, 120);
  assert.equal(body.ranked.filter((r) => r.status === "BONDING").length, 50);
  assert.deepEqual(body.statusError, ["CURVE_RPC_UNAVAILABLE", "DEXSCREENER_UNAVAILABLE"]);
});

test("malformed probes are errors, while null accounts and null pairs are successful empty checks", async () => {
  const invalid = await setup({ state: { rpcResult: { value: [] }, dex: {} } }).read();
  assert.equal(invalid.body.statusChecked, 0);
  assert.deepEqual(invalid.body.statusError, ["CURVE_RPC_UNAVAILABLE", "DEXSCREENER_UNAVAILABLE"]);
  const empty = await setup({ state: { accounts: new Map(), dex: { pairs: null } } }).read();
  assert.equal(empty.body.statusChecked, 1);
  assert.equal(empty.body.statusError, null);
  assert.equal(empty.body.ranked[0].status, "UNKNOWN");
  assert.equal(empty.body.ranked[0].statusAt, NOW);
});

test("invalid source mints are retained as unknown, never forwarded into RPC/DEX URLs", async () => {
  const s = setup({ state: { coins: [coin(1, {}, { mint: "../arbitrary,query?" })] } });
  const { body } = await s.read();
  assert.equal(body.ranked.length, 1);
  assert.equal(body.ranked[0].status, "UNKNOWN");
  assert.equal(body.candidateCount, 1);
  assert.equal(body.statusChecked, 0);
  assert.deepEqual(body.statusError, ["INVALID_MINT"]);
  assert.deepEqual(s.calls.map((c) => c.type), ["coins"]);
});

test("probe deadlines release responses, but hung RPCs retain capacity across refreshes", async () => {
  const s = setup({ probeTimeoutMs: 10, state: { coins: fullRoster(), rpcHook: () => new Promise(() => {}) } });
  for (let i = 0; i < 3; i++) {
    const { response, body } = await s.read();
    assert.equal(response.status, 200);
    assert.deepEqual(body.statusError, ["CURVE_RPC_UNAVAILABLE"]);
    assert.equal(body.statusChecked, 150);
    s.advance(30_000);
  }
  assert.equal(s.calls.filter((c) => c.type === "rpc").length, 2);
  const dexHung = setup({ probeTimeoutMs: 10, state: { dexHook: () => new Promise(() => {}) } });
  const { body } = await dexHung.read();
  assert.deepEqual(body.statusError, ["DEXSCREENER_UNAVAILABLE"]);
  assert.equal(body.ranked[0].status, "BONDING");
});

test("public GET and SDK POST {} work; arbitrary query/body mints are rejected before cache or probes", async () => {
  const s = setup();
  const preflight = await s.handler(new Request("https://example.test", { method: "OPTIONS" }));
  assert.equal(preflight.status, 204);
  assert.equal(s.calls.length, 0);
  assert.equal((await s.read(new Request("https://example.test", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: "{}" }))).response.status, 200);
  const calls = s.calls.length;
  for (const query of ["?mint=anything", "?mints=anything", "?limit=1000", "?sort=change24h"]) {
    assert.equal((await s.read(request(query))).response.status, 400);
  }
  for (const body of ['{"mint":"anything"}', '{"mints":["anything"]}', "[]", "null", "invalid"]) {
    const result = await s.read(new Request("https://example.test", { method: "POST",
      headers: { "Content-Type": "application/json" }, body }));
    assert.equal(result.response.status, 400);
  }
  assert.equal((await s.read(new Request("https://example.test", { method: "DELETE" }))).response.status, 405);
  assert.equal(s.calls.length, calls);
});