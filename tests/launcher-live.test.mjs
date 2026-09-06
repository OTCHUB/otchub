import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { setImmediate as tick } from "node:timers/promises";
import { PublicKey } from "@solana/web3.js";
import { createLauncherLiveHandler, launcherCandidates, rankLauncherRows } from "../base44/functions/getLauncherLive/handler.js";
import { createCurveAddressDeriver, curveFundingProgress, decodeLauncherCurve, hasConfirmedAmmPair,
  launcherStatus, PUMP_CURVE_DISCRIMINATOR, PUMP_PROGRAM_ID } from "../base44/shared/launcherCurve.js";
import { createLauncherRiskService, emptyLauncherRisk, isLauncherRiskMint, LAUNCHER_RISK_REFERENCES,
  normalizeLauncherRiskReport } from "../base44/shared/launcherRisk.js";

const NOW = 1_800_000_000_000;
const COINS = "https://otcdesks.cash/api/coins";
const DEX = "https://api.dexscreener.com/latest/dex/tokens/";
const RUG = "https://api.rugcheck.xyz/v1/tokens/";
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
    // Legacy metric regressions explicitly disable risk starts. Integration tests
    // below use the real default-enabled service with all three hosts stubbed.
    riskService: options.riskService, riskOptions: options.riskOptions ?? { maxRequests: 0 },
    rpc: (method, params) => tracked({ type: "rpc", method, params }, async () => {
      assert.equal(method, "getMultipleAccounts");
      assert.ok(params[0].length <= 100);
      assert.deepEqual(params[1], { encoding: "base64", commitment: "confirmed", dataSlice: { offset: 0, length: 49 } });
      if (state.failRpc) throw new Error("unsafe upstream detail");
      if (state.rpcHook) return state.rpcHook(params[0]);
      if (Object.hasOwn(state, "rpcResult")) return state.rpcResult;
      return { value: params[0].map((address) => state.accounts.get(address) ?? null) };
    }),
    fetchImpl: (url, options) => tracked({ type: url === COINS ? "coins" : url.startsWith(RUG) ? "risk" : "dex", url }, async () => {
      assert.ok(options.signal instanceof AbortSignal);
      if (url === COINS) {
        if (state.coinsHook) await state.coinsHook();
        if (state.failCoins) throw new Error("unsafe upstream detail");
        // Keep NaN/Infinity intact to test sanitization before JSON serialization.
        return { ok: true, json: async () => structuredClone(state.coins) };
      }
      if (url.startsWith(RUG)) {
        const token = url.slice(RUG.length, -"/report".length);
        assert.equal(url, `${RUG}${token}/report`);
        assert.ok(isLauncherRiskMint(token));
        assert.equal(options.method, "GET");
        assert.equal(options.redirect, "error");
        return state.riskHook ? state.riskHook(token, options)
          : Response.json(state.reports?.get(token) ?? riskReport(token));
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
    "change24h", "ageH", "metricsAt", "curveProgress", "status", "curveComplete", "statusAt", "risk"].sort());
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

test("bounded roster ships all 150 candidates; disjoint union kept with 100/30 batches and bounded concurrency", async () => {
  const coins = fullRoster().map((row) => ({ ...row, image: "", rewardCycle: 0 }));
  const info = { imageUrl: "https://example.test/dex.png", socials: [{ type: "twitter", url: "https://x.com/dex" }] };
  const s = setup({ state: { coins, accounts: new Map(coins.map((c) => [derive(c.mint), account()])),
    dex: { pairs: coins.map((c) => pair(c.mint, { info })) } } });
  const { body } = await s.read();
  // Bounded shipping: ranked carries the 150 status-checked candidates (the
  // fixture's uniform mcap adds no top-mcap rows); exact full-roster counts
  // travel in statusCounts instead of the row list.
  assert.equal(body.ranked.length, 150);
  assert.equal(body.rosterTotal, 220);
  assert.equal(body.statusCounts.ALL, 220);
  assert.equal(body.statusCounts.GRADUATED, 150);
  assert.equal(body.statusCounts.UNKNOWN, 70);
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
    // Non-candidate roster rows are no longer shipped; they remain counted
    // server-side in statusCounts.UNKNOWN instead of inflating the payload.
    assert.equal(body.ranked.find((r) => r.mint === mint(i)), undefined);
  }
});

test("overlapping candidate lists are deduplicated, not padded up to 150", async () => {
  const coins = Array.from({ length: 100 }, (_, i) => coin(i, { volume24h: 100 - i, change24h: 100 - i }));
  // No curve accounts, so every status stays UNKNOWN and the full-roster
  // counts below are deterministic (the default setup maps mint(1) to a
  // BONDING curve account).
  const { body } = await setup({ state: { coins, accounts: new Map() } }).read();
  // Bounded shipping: only the 60 deduped candidates travel in ranked; the
  // remaining 40 roster rows are counted server-side, not shipped.
  assert.equal(body.ranked.length, 60);
  assert.equal(body.candidateCount, 60);
  assert.equal(body.statusChecked, 60);
  assert.equal(body.statusCounts.ALL, 100);
  assert.equal(body.statusCounts.UNKNOWN, 100);
});

test("paged tape serves the full roster with server-side filter, sort and paging", async () => {
  const coins = Array.from({ length: 120 }, (_, i) => coin(i, { volume24h: 100 - i, change24h: 100 - i }));
  const s = setup({ state: { coins, accounts: new Map() } });
  const first = await s.read(request("?page=1&pageSize=50&sort=vol24"));
  assert.equal(first.response.status, 200);
  assert.equal(first.body.matches, 120);
  assert.equal(first.body.rosterTotal, 120);
  assert.equal(first.body.pageCount, 3);
  assert.equal(first.body.ranked.length, 50);
  assert.equal(first.body.ranked[0].mint, mint(0));
  assert.equal(first.body.statusCounts.ALL, 120);
  assert.equal(first.body.statusCounts.UNKNOWN, 120);
  const last = await s.read(request("?page=3&pageSize=50"));
  assert.equal(last.body.ranked.length, 20);
  assert.equal(last.body.ranked.at(-1).mint, mint(119));
  // Pages past the end are clamped to the last page, never empty.
  const clamped = await s.read(request("?page=99"));
  assert.equal(clamped.body.page, 3);
  assert.equal(clamped.body.ranked.length, 20);
  // Timeframe filter: coins are 1..120h old, so a 24h window keeps the first 24.
  const day = await s.read(request("?maxAgeHours=24&pageSize=100"));
  assert.equal(day.body.matches, 24);
  assert.deepEqual(day.body.ranked.map((r) => r.mint), Array.from({ length: 24 }, (_, i) => mint(i)));
  // Search matches name/symbol/mint substrines across the whole roster.
  const found = await s.read(request("?search=coin 5&pageSize=100"));
  assert.equal(found.body.matches, 11);
  // POST body params drive the same paged tape (SDK invoke path).
  const posted = await s.read(new Request("https://example.test/getLauncherLive", { method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ page: 2, pageSize: 10, status: "ALL", sort: "mcap" }) }));
  assert.equal(posted.body.ranked.length, 10);
  assert.equal(posted.body.page, 2);
  assert.equal(posted.body.pageSize, 10);
  assert.equal(posted.body.statusCounts.ALL, 120);
});

test("every status category pages at the 50-entry default when its count exceeds one page", async () => {
  const bonding = Array.from({ length: 55 }, (_, i) => coin(100 + i, { volume24h: 6000 - i, change24h: -1 }));
  const graduated = Array.from({ length: 55 }, (_, i) => coin(200 + i, { volume24h: 1, change24h: 100 - i }));
  const near = Array.from({ length: 30 }, (_, i) => coin(300 + i, { volume24h: 1, change24h: -2 },
    { createdAt: NOW / 1000 - 1800 }));
  const filler = Array.from({ length: 100 }, (_, i) => coin(400 + i, { volume24h: 50 - i / 10, change24h: -3 }));
  const coins = [...bonding, ...graduated, ...near, ...filler];
  const accounts = new Map();
  for (const c of bonding) accounts.set(derive(c.mint), account());
  for (const c of graduated) accounts.set(derive(c.mint), account());
  for (const c of near) accounts.set(derive(c.mint), account({ complete: true }));
  const s = setup({ state: { coins, accounts, dex: { pairs: graduated.map((c) => pair(c.mint)) } } });
  const read = async (query) => (await s.read(request(query))).body;
  const keyOf = (row) => ["GRADUATED", "BONDING", "ABOUT_TO_GRADUATE"].includes(row.status) ? row.status : "UNKNOWN";
  // GRADUATED/BONDING/UNKNOWN exceed 50 entries (multi-page); ABOUT_TO_GRADUATE
  // fits a single page (no pager, over-range pages clamp).
  const categories = { GRADUATED: 55, BONDING: 55, UNKNOWN: 100, ABOUT_TO_GRADUATE: 30, ALL: 240 };
  for (const [status, total] of Object.entries(categories)) {
    const first = await read(`?status=${status}`);
    assert.equal(first.pageSize, 50, `${status}: default page size is 50`);
    assert.equal(first.matches, total);
    assert.equal(first.statusCounts[status], total, `${status}: faceted tab count is scope-wide`);
    assert.equal(first.statusCounts.GRADUATED, 55, `${status}: other tab counts stay visible`);
    assert.equal(first.pageCount, Math.ceil(total / 50));
    assert.equal(first.ranked.length, Math.min(50, total));
    assert.ok(first.ranked.every((r) => status === "ALL" || keyOf(r) === status));
    if (total > 50) {
      const second = await read(`?status=${status}&page=2`);
      assert.equal(second.page, 2);
      assert.equal(second.ranked.length, Math.min(50, total - 50));
      const pageOne = new Set(first.ranked.map((r) => r.mint));
      assert.ok(second.ranked.every((r) => !pageOne.has(r.mint) && (status === "ALL" || keyOf(r) === status)),
        `${status}: page 2 continues the same category without repeating page 1`);
    } else {
      const clamped = await read(`?status=${status}&page=9`);
      assert.equal(clamped.page, 1);
      assert.equal(clamped.ranked.length, total);
    }
  }
});

test("curve progress is a server sort key: highest progress first, unknowns last", async () => {
  const coins = Array.from({ length: 3 }, (_, i) => coin(i, { volume24h: 100 - i }));
  const s = setup({ state: { coins, accounts: new Map([
    [derive(mint(1)), account(near)], [derive(mint(2)), account()],
  ]) } });
  const body = (await s.read(request("?sort=curveProgress"))).body;
  assert.deepEqual(body.ranked.map((r) => [r.mint, r.curveProgress]),
    [[mint(1), 90], [mint(2), 0], [mint(0), null]], "Highest progress first, unknown progress last");
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
  // All 150 candidates ship (checked or not); unchecked non-candidates are
  // counted server-side in statusCounts instead of inflating the payload.
  assert.equal(body.ranked.length, 150);
  assert.equal(body.statusChecked, 120);
  assert.equal(body.ranked.filter((r) => r.status === "BONDING").length, 50);
  assert.equal(body.statusCounts.ALL, 220);
  assert.equal(body.statusCounts.BONDING, 50);
  assert.equal(body.statusCounts.UNKNOWN, 170);
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
  // Unknown query keys (gateway markers, junk) are ignored, never consumed.
  for (const query of ["?mint=anything", "?mints=anything", "?limit=1000", "?sort=change24h", "?marker=proxy-junk"]) {
    assert.equal((await s.read(request(query))).response.status, 200);
  }
  // Known keys are validated: bad values never reach the cache or probes.
  for (const query of ["?page=0", "?pageSize=999", "?sort=bogus", "?status=BOGUS", "?maxAgeHours=0",
    `?search=${"x".repeat(65)}`]) {
    assert.equal((await s.read(request(query))).response.status, 400);
  }
  // An SDK POST with a gateway-appended query string still serves the feed.
  assert.equal((await s.read(new Request("https://example.test/getLauncherLive?marker=proxy-junk", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  }))).response.status, 200);
  for (const body of ['{"mint":"anything"}', '{"mints":["anything"]}', "[]", "null", "invalid"]) {
    const result = await s.read(new Request("https://example.test", { method: "POST",
      headers: { "Content-Type": "application/json" }, body }));
    assert.equal(result.response.status, 400);
  }
  assert.equal((await s.read(new Request("https://example.test", { method: "DELETE" }))).response.status, 405);
  assert.equal(s.calls.length, calls);
});

// All risk data below is synthetic. Creator identities are deliberately different
// from live wallets: attribution must come from exact, validated runtime reports.
const [ETF, PUMPCAT] = LAUNCHER_RISK_REFERENCES;
function holderSample(pcts = [...Array(5).fill(0), ...Array(14).fill(2), 7]) {
  return pcts.map((pct, i) => ({ address: mint(10_000 + i), owner: mint(20_000 + i), pct }));
}
function riskReport(token, extra = {}) {
  return { mint: token, creator: mint(9000), score: 1, score_normalised: 1, rugged: false,
    risks: [], topHolders: holderSample(), totalHolders: 100,
    detectedAt: new Date(NOW - 5000).toISOString(), ...extra };
}
function referenceReports() {
  return new Map([[ETF.mint, riskReport(ETF.mint, { creator: mint(9001) })],
    [PUMPCAT.mint, riskReport(PUMPCAT.mint, { creator: mint(9002) })]]);
}
function riskHarness(options = {}) {
  let now = NOW, active = 0, maxActive = 0;
  const calls = [], state = { reports: referenceReports(), hook: null };
  const service = createLauncherRiskService({ ...options, clock: () => now, fetchImpl: async (url, init) => {
    assert.equal(new URL(url).origin, "https://api.rugcheck.xyz");
    const token = url.slice(RUG.length, -"/report".length);
    assert.equal(url, `${RUG}${token}/report`);
    assert.ok(isLauncherRiskMint(token));
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
    calls.push({ token, at: now }); maxActive = Math.max(maxActive, ++active);
    try { return state.hook ? await state.hook(token, init)
      : Response.json(state.reports.get(token) ?? riskReport(token)); }
    finally { active--; }
  } });
  return { service, calls, state, clock: () => now, advance: (ms) => { now += ms; },
    setClock: (value) => { now = value; }, maxActive: () => maxActive };
}
const riskOf = (body, token = mint(1)) => body.ranked.find((r) => r.mint === token).risk;
const riskCalls = (s) => s.calls.filter((c) => c.type === "risk");

test("risk integration: ETF user-reference negative despite score 1/rugged false; pumpcat exact creator positive", async () => {
  const reports = referenceReports();
  reports.set(mint(1), riskReport(mint(1), { creator: mint(9001) }));
  reports.set(mint(2), riskReport(mint(2), { creator: mint(9002) }));
  reports.set(mint(3), riskReport(mint(3), { creator: mint(9003) }));
  const s = setup({ riskOptions: {}, state: { reports, coins: [coin(1), coin(2), coin(3, {}, { symbol: "ETF" }),
    coin(4, {}, { mint: ETF.mint }), coin(5, {}, { mint: PUMPCAT.mint })] } });
  const { body } = await s.read(), negative = riskOf(body), positive = riskOf(body, mint(2));
  assert.equal(negative.score, 1);
  assert.equal(negative.rugged, false);
  assert.equal(negative.level, "NONE");
  assert.equal(negative.state, "READY");
  assert.equal(negative.deployer, mint(9001));
  assert.equal(negative.reputation.status, "MALICIOUS_REPORTED");
  assert.deepEqual(negative.reputation.evidence, [{ ...ETF, source: "USER_REFERENCE", checkedAt: NOW }]);
  assert.equal(negative.highRisk, true);
  assert.equal(positive.reputation.status, "SUCCESS_REPORTED");
  assert.deepEqual(positive.reputation.evidence, [{ ...PUMPCAT, source: "USER_REFERENCE", checkedAt: NOW }]);
  assert.equal(positive.highRisk, false);
  assert.equal(riskOf(body, mint(3)).reputation.status, "UNKNOWN", "Never match a symbol");
  assert.equal(riskOf(body, ETF.mint).reputation.status, "MALICIOUS_REPORTED");
  assert.equal(riskOf(body, PUMPCAT.mint).reputation.status, "SUCCESS_REPORTED");
  assert.deepEqual(Object.keys(negative).sort(), Object.keys(emptyLauncherRisk()).sort());
  assert.equal(negative.reportedAt, NOW - 5000);
  assert.deepEqual(body.riskCoverage, { total: 5, checked: 5, stale: 0, unavailable: 0,
    notChecked: 0, requested: 5, limited: false, nextRetryAt: null });
  assert.equal(body.ranked[0].status, "BONDING");
  assert.equal(body.ranked[0].mcap, 2000);
  assert.equal(body.statusError, null);
});

test("risk integration: fresh warm-cache rugged history propagates across mints and overrides curated success", async () => {
  const reports = referenceReports();
  reports.set(mint(1), riskReport(mint(1), { creator: mint(9002), rugged: true }));
  reports.set(mint(2), riskReport(mint(2), { creator: mint(9002) }));
  const s = setup({ riskOptions: {}, state: { reports, coins: [coin(1)] } });
  assert.equal(riskOf((await s.read()).body).level, "DANGER");
  s.advance(30_000);
  s.state.coins = [coin(2, { volume24h: 1000 })];
  const { body } = await s.read(), risk = riskOf(body, mint(2));
  assert.equal(risk.reputation.status, "MALICIOUS_REPORTED");
  assert.deepEqual(risk.reputation.evidence, [{ mint: mint(1), label: "RugCheck rugged report",
    outcome: "MALICIOUS_REPORTED", source: "RUGCHECK_RUGGED", checkedAt: NOW }]);
  assert.equal(risk.highRisk, true);
  assert.equal(riskCalls(s).length, 4, "Only the new row needs another report; history is local cache");
  assert.equal(body.ranked[0].vol24, 1000);
});

test("risk integration: shared ETF/pumpcat creator has negative precedence without claiming ETF is rugged", async () => {
  const reports = referenceReports();
  reports.set(PUMPCAT.mint, riskReport(PUMPCAT.mint, { creator: mint(9001) }));
  reports.set(mint(1), riskReport(mint(1), { creator: mint(9001) }));
  const { body } = await setup({ riskOptions: {}, state: { reports } }).read();
  assert.equal(riskOf(body).reputation.status, "MALICIOUS_REPORTED");
  assert.deepEqual(riskOf(body).reputation.evidence.map((e) => e.source), ["USER_REFERENCE"]);
  assert.equal(riskOf(body).rugged, false);
});

test("risk integration: unresolved, mismatched and error-shaped seeds cannot propagate or substitute other authorities", async () => {
  for (const seed of [null, { creator: null }, { creator: "bad" }, { mint: mint(50) },
    { error: "private upstream detail" }, { success: false }, { creator: undefined }, { creatorTokens: [mint(1)], creator: null }]) {
    const reports = referenceReports();
    reports.set(mint(1), riskReport(mint(1), { creator: mint(9001) }));
    const s = setup({ riskOptions: {}, state: { reports, riskHook: (token) => token === ETF.mint
      ? seed === null ? new Response(null, { status: 404 })
        : Response.json(riskReport(token, { ...seed, mintAuthority: mint(9001), owner: mint(9001) }))
      : Response.json(reports.get(token) ?? riskReport(token)) } });
    const { body } = await s.read();
    assert.equal(riskOf(body).reputation.status, "UNKNOWN");
    assert.equal(JSON.stringify(body).includes("private upstream detail"), false);
  }
});

test("risk normalization: only normalized 0..100 uses local >=50; raw score has no invented threshold", () => {
  const normalize = (extra) => normalizeLauncherRiskReport(riskReport(mint(1), extra), mint(1), NOW);
  for (const score_normalised of [undefined, null, -1, 101, Infinity, "99"]) {
    const risk = normalize({ score: 99_999_999, score_normalised });
    assert.equal(risk.scoreNormalised, null);
    assert.equal(risk.level, "NONE");
    assert.equal(risk.highRisk, false);
  }
  assert.equal(normalize({ score_normalised: 49.99 }).level, "NONE");
  assert.equal(normalize({ score: -1 }).score, -1, "Raw score is display-only, not a classification cutoff");
  assert.equal(normalize({ score_normalised: 50 }).level, "DANGER");
  assert.equal(normalize({ rugged: true }).level, "DANGER");
  for (const level of ["warn", "warning", "WARNING"]) {
    const risk = normalize({ risks: [{ level, name: "Warning", value: 0, score: 0 }] });
    assert.equal(risk.level, "WARNING"); assert.equal(risk.highRisk, true);
    assert.equal(risk.factors[0].value, 0); assert.equal(risk.factors[0].score, 0);
  }
  assert.equal(normalize({ risks: [{ level: "danger" }, { level: "warn" }] }).level, "DANGER");
  assert.equal(normalize({ risks: [{ level: "info" }] }).level, "NONE");
  for (const risks of [undefined, null, [null], [{ level: "other" }], [{ level: "__proto__" }], [{ level: "toString" }]]) {
    const risk = normalize({ risks });
    assert.equal(risk.level, "UNKNOWN"); assert.equal(risk.highRisk, null);
  }
  for (const extra of [{ mint: mint(2) }, { score: "1" }, { rugged: "false" }, { risks: {} }, { error: null },
    { status: 500 }, { status: "error" }, { message: "upstream failure" }, { ok: false },
    { score: Infinity }, { risks: Array(65).fill({ level: "info" }) }]) assert.throws(() => normalize(extra), /INVALID_REPORT/);
  const bounded = normalize({ detectedAt: new Date(NOW + 1).toISOString(), risks: [{ level: "info",
    name: "N".repeat(1000), description: "D".repeat(2000), value: "V".repeat(1000), score: "1" }] });
  assert.equal(bounded.reportedAt, null);
  assert.deepEqual([bounded.factors[0].name.length, bounded.factors[0].description.length,
    bounded.factors[0].value.length, bounded.factors[0].score], [128, 1024, 256, null]);
});

test("risk integration: unsorted top15 uses strict >35 with no rounding and gross accounts, not owners", async () => {
  for (const peak of [7, 7.01, 7.000001]) {
    const topHolders = holderSample([...Array(5).fill(0), ...Array(14).fill(2), peak])
      .map((h) => ({ ...h, owner: mint(99) }));
    const reports = referenceReports(); reports.set(mint(1), riskReport(mint(1), { topHolders }));
    const { body } = await setup({ riskOptions: {}, state: { reports } }).read(), risk = riskOf(body);
    assert.ok(Math.abs(risk.top15Pct - (28 + peak)) < 1e-10);
    assert.equal(risk.holderSampleSize, 20);
    assert.equal(risk.holderConcentrationHigh, peak > 7);
    assert.equal(risk.highRisk, peak > 7);
  }
});

test("holder safeguards: identical accounts deduplicate, conflicting/malformed/overfull/truncated samples stay unknown", () => {
  const normalize = (extra) => normalizeLauncherRiskReport(riskReport(mint(1), extra), mint(1), NOW);
  const full = holderSample();
  assert.equal(normalize({ topHolders: [...full, full[0]] }).top15Pct, 35);
  assert.equal(normalize({ topHolders: [...full, full[0]] }).holderSampleSize, 20);
  const bad = [undefined, null, [], full.slice(0, 14), Array(20).fill(full[0]),
    [...full, { ...full[0], pct: 10 }], [...full, { ...full[0], owner: mint(1) }],
    full.map((h) => ({ ...h, pct: 6 })), ...["0", null, false, -1, 101, NaN, Infinity].map((pct) => [{ ...full[0], pct }, ...full.slice(1)]),
    [{ ...full[0], owner: null }, ...full.slice(1)], [{ ...full[0], address: "bad" }, ...full.slice(1)]];
  for (const topHolders of bad) {
    const risk = normalize({ topHolders });
    assert.equal(risk.top15Pct, null); assert.equal(risk.holderConcentrationHigh, null);
    assert.equal(risk.highRisk, null);
  }
  assert.equal(normalize({ topHolders: full.slice(0, 10), totalHolders: 10 }).top15Pct, 10);
  assert.equal(normalize({ topHolders: full.slice(0, 10), totalHolders: 9 }).top15Pct, 10);
  for (const totalHolders of ["10", undefined, 11, 0, -1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(normalize({ topHolders: full.slice(0, 10), totalHolders }).top15Pct, null);
  }
});

test("risk integration: cold/expired concurrent readers singleflight and five-minute reports survive 30-second rebuilds", async () => {
  const s = setup({ riskOptions: {} });
  const responses = await Promise.all(Array.from({ length: 8 }, () => s.read()));
  for (const result of responses) assert.deepEqual(result.body, responses[0].body);
  assert.equal(riskCalls(s).length, 3);
  const total = s.calls.length;
  assert.deepEqual((await s.read()).body, responses[0].body);
  assert.equal(s.calls.length, total, "Full-response cache must make no requests");
  for (let i = 0; i < 9; i++) {
    s.advance(30_000);
    const { body } = await s.read();
    assert.equal(body.riskCoverage.requested, 0);
    assert.equal(body.riskCoverage.checked, 1);
    assert.equal(riskOf(body).checkedAt, NOW);
  }
  assert.equal(riskCalls(s).length, 3);
  s.advance(30_000);
  await Promise.all(Array.from({ length: 5 }, () => s.read()));
  assert.equal(riskCalls(s).length, 6);
});

test("risk integration: full-response hits recheck report age and suppress expired curated success without fetches", async () => {
  const reports = referenceReports(); reports.set(mint(1), riskReport(mint(1), { creator: mint(9002) }));
  const s = setup({ riskOptions: {}, state: { reports } });
  assert.equal(riskOf((await s.read()).body).reputation.status, "SUCCESS_REPORTED");
  s.advance(280_000); await s.read();
  const calls = s.calls.length;
  s.advance(20_000);
  const { body, response } = await s.read(), risk = riskOf(body);
  assert.equal(response.headers.get("X-Launcher-Cache"), "hit");
  assert.equal(s.calls.length, calls);
  assert.equal(risk.state, "STALE"); assert.equal(risk.highRisk, null);
  assert.equal(risk.reputation.status, "UNKNOWN"); assert.deepEqual(risk.reputation.evidence, []);
  assert.equal(body.riskCoverage.checked, 0); assert.equal(body.riskCoverage.stale, 1);
});

test("risk integration: errors retain stale negatives, never propagate expired seeds to new rows, and preserve ranking", async () => {
  const reports = referenceReports();
  for (const i of [1, 2]) reports.set(mint(i), riskReport(mint(i), { creator: mint(9001) }));
  const s = setup({ riskOptions: {}, state: { reports } });
  await s.read();
  s.advance(300_000);
  s.state.coins = [coin(1, { volume24h: 1 }), coin(2, { volume24h: 999 })];
  s.state.riskHook = (token) => [ETF.mint, PUMPCAT.mint].includes(token)
    ? new Response(null, { status: 404 }) : Response.json(reports.get(token));
  const { body } = await s.read();
  assert.deepEqual(body.ranked.map((r) => r.mint), [mint(2), mint(1)]);
  assert.equal(body.stale, false); assert.equal(body.statusError, null);
  assert.equal(riskOf(body).state, "STALE"); assert.equal(riskOf(body).error, "STALE_EVIDENCE");
  assert.equal(riskOf(body).highRisk, true);
  assert.equal(riskOf(body, mint(2)).reputation.status, "UNKNOWN");
  assert.equal(riskOf(body, mint(2)).state, "READY");
});

test("risk integration: failed report refresh is stale for at most 30min and does not poison fresh metrics", async () => {
  const reports = referenceReports(); reports.set(mint(1), riskReport(mint(1), { risks: [{ level: "danger" }] }));
  const s = setup({ riskOptions: {}, state: { reports } }); await s.read();
  s.state.riskHook = () => new Response(null, { status: 503 });
  s.advance(300_000); s.state.coins[0].snapshot.change24h = 42;
  let result = await s.read();
  assert.equal(riskOf(result.body).state, "STALE");
  assert.equal(riskOf(result.body).checkedAt, NOW);
  assert.equal(riskOf(result.body).error, "UPSTREAM_UNAVAILABLE");
  assert.equal(riskOf(result.body).highRisk, true);
  assert.equal(result.body.ranked[0].change24h, 42); assert.equal(result.body.stale, false);
  s.advance(1_500_000); result = await s.read();
  assert.equal(riskOf(result.body).state, "STALE", "Inclusive 30-minute bound");
  s.advance(1); result = await s.read();
  assert.equal(riskOf(result.body).state, "UNAVAILABLE");
  assert.equal(riskOf(result.body).score, null); assert.equal(riskOf(result.body).highRisk, null);
});

test("risk integration: stale coin fallback suppresses success while preserving metric data", async () => {
  const reports = referenceReports(); reports.set(mint(1), riskReport(mint(1), { creator: mint(9002) }));
  const s = setup({ riskOptions: {}, state: { reports } }); const first = await s.read();
  s.advance(30_000); s.state.failCoins = true;
  const { body } = await s.read();
  assert.equal(body.stale, true); assert.equal(body.ranked[0].vol24, first.body.ranked[0].vol24);
  assert.equal(riskOf(body).state, "STALE"); assert.equal(riskOf(body).error, "FEED_STALE");
  assert.equal(riskOf(body).reputation.status, "UNKNOWN");
  assert.equal(riskCalls(s).length, 3);
});

test("risk 429 honors default, seconds and HTTP-date Retry-After globally without queued starts", async () => {
  for (const [header, delay] of [[null, 60_000], ["1", 60_000], ["180", 180_000],
    [new Date(NOW + 240_000).toUTCString(), 240_000], ["invalid", 60_000]]) {
    const h = riskHarness(), rows = [coin(1), coin(2)];
    h.state.hook = () => new Response(null, { status: 429, headers: header ? { "Retry-After": header } : {} });
    const coverage = await h.service.enrich(rows);
    assert.equal(h.calls.length, 2); assert.equal(coverage.requested, 2);
    assert.equal(coverage.nextRetryAt, NOW + delay); assert.equal(coverage.limited, true);
    assert.ok(rows.every((r) => r.risk.state === "NOT_CHECKED" && r.risk.highRisk === null));
    h.advance(delay - 1); await h.service.enrich(rows); assert.equal(h.calls.length, 2);
    h.advance(1); h.state.hook = null;
    const fresh = await h.service.enrich(rows);
    assert.equal(fresh.checked, 2); assert.equal(fresh.requested, 4);
  }
});

test("risk integration: 429 on refresh keeps old report stale and metrics available during cooldown", async () => {
  const s = setup({ riskOptions: {} }); await s.read(); s.advance(300_000);
  s.state.riskHook = () => new Response(null, { status: 429, headers: { "Retry-After": "180" } });
  const { body } = await s.read();
  assert.equal(body.riskCoverage.nextRetryAt, NOW + 480_000);
  assert.equal(riskOf(body).state, "STALE"); assert.equal(body.statusError, null);
  const calls = riskCalls(s).length;
  s.advance(30_000); s.state.coins[0].snapshot.marketCap = 9876;
  assert.equal((await s.read()).body.ranked[0].mcap, 9876);
  assert.equal(riskCalls(s).length, calls);
});

test("risk errors are independent, sanitized, negatively cached; wrong mint and oversized/error bodies never become READY", async () => {
  const h = riskHarness(), rows = Array.from({ length: 7 }, (_, i) => coin(i + 1));
  const responses = new Map([[mint(1), () => new Response(null, { status: 403 })],
    [mint(2), () => new Response(null, { status: 404 })], [mint(3), () => new Response("not JSON")],
    [mint(4), () => Response.json(riskReport(mint(99)))],
    [mint(5), () => Response.json(riskReport(mint(5), { error: "unsafe upstream detail" }))],
    [mint(6), () => new Response(" ".repeat(524_289))]]);
  h.state.hook = (token) => responses.has(token) ? responses.get(token)()
    : Response.json(h.state.reports.get(token) ?? riskReport(token));
  let coverage = await h.service.enrich(rows);
  assert.equal(coverage.checked, 1); assert.equal(coverage.unavailable, 6);
  assert.deepEqual(rows.slice(0, 6).map((r) => r.risk.error),
    ["FORBIDDEN", "NOT_FOUND", "INVALID_REPORT", "INVALID_REPORT", "INVALID_REPORT", "PAYLOAD_TOO_LARGE"]);
  assert.ok(!JSON.stringify(rows).includes("unsafe upstream detail"));
  const count = h.calls.length;
  h.advance(30_000); await h.service.enrich(rows); assert.equal(h.calls.length, count);
  h.advance(30_000); h.state.hook = null;
  coverage = await h.service.enrich(rows); assert.equal(coverage.checked, 7); assert.equal(coverage.requested, 6);
});

test("risk whole-stage timeout overlaps curve/DEX; ignored aborts retain two slots across rebuilds and cannot write late", async () => {
  const entered = deferred(), release = deferred(); let started = 0;
  const s = setup({ riskOptions: { budgetMs: 100, timeoutMs: 10 }, state: { riskHook: async (token) => {
    if (++started === 2) entered.resolve(); await release.promise;
    return Response.json(riskReport(token));
  } } });
  const pending = s.read(); await entered.promise; await tick();
  assert.ok(s.calls.some((c) => c.type === "rpc") && s.calls.some((c) => c.type === "dex"));
  const { body } = await pending;
  assert.equal(body.riskCoverage.requested, 2); assert.equal(body.riskCoverage.notChecked, 1);
  assert.equal(body.ranked[0].status, "BONDING"); assert.equal(body.statusError, null);
  for (let i = 0; i < 3; i++) { s.advance(60_000); await s.read(); }
  assert.equal(riskCalls(s).length, 2, "Abort-ignoring fetches cannot multiply on refresh");
  release.resolve(); await tick();
  s.advance(30_000); s.state.riskHook = () => new Response(null, { status: 404 });
  const after = await s.read();
  assert.equal(after.body.riskCoverage.checked, 0, "Late seed success must not enter cache");
  assert.equal(riskCalls(s).length, 5, "Both timed-out seeds still require a real retry after late settlement");
});

test("risk body reads share the stage deadline and retain slots until abort-ignoring streams settle", async () => {
  const h = riskHarness({ budgetMs: 15 }), controllers = [];
  h.state.hook = () => new Response(new ReadableStream({ start(controller) { controllers.push(controller); } }));
  const rows = [{ mint: ETF.mint }, { mint: PUMPCAT.mint }];
  const coverage = await h.service.enrich(rows);
  assert.equal(coverage.unavailable, 2); assert.ok(rows.every((r) => r.risk.error === "TIMEOUT"));
  assert.equal(h.service.inspect().activeRequests, 2);
  h.advance(60_000); await h.service.enrich(rows); assert.equal(h.calls.length, 2);
  for (const controller of controllers) controller.close();
  await tick();
  assert.equal(h.service.inspect().activeRequests, 0);
  h.service.attach(rows); assert.ok(rows.every((r) => r.risk.state !== "READY"));
});

test("risk production ceilings apply to 3000-row rosters and repeated rebuilds in a rolling window", async () => {
  const h = riskHarness({ maxRequests: 999, concurrency: 999 }), rows = Array.from({ length: 3000 }, (_, i) => coin(i + 1));
  const first = await h.service.enrich(rows, rows.slice(0, 150));
  assert.equal(first.requested, 12); assert.equal(first.checked, 10); assert.equal(first.notChecked, 2990);
  assert.equal(first.limited, true); assert.equal(first.nextRetryAt, NOW + 30_000);
  assert.ok(h.maxActive() <= 2);
  h.advance(29_999); assert.equal((await h.service.enrich(rows)).requested, 0);
  assert.equal(h.calls.length, 12);
  h.advance(1); assert.equal((await h.service.enrich(rows)).requested, 12);
  assert.equal(h.calls.length, 24);
  assert.equal(rows.filter((r) => r.risk.state === "READY").length, 22, "Cache attaches beyond current requests");
});

test("risk rotation eventually checks non-priority rows despite bounded eviction and repeated hot candidates", async () => {
  const h = riskHarness({ maxEntries: 6, maxRequests: 4 }), rows = Array.from({ length: 40 }, (_, i) => coin(i + 1));
  for (let i = 0; i < 35; i++) {
    const coverage = await h.service.enrich(rows, rows.slice(0, 2));
    assert.ok(coverage.requested <= 4); assert.ok(h.service.inspect().cacheSize <= 6);
    h.advance(30_000);
  }
  const checked = new Set(h.calls.map((c) => c.token));
  for (const row of rows) assert.ok(checked.has(row.mint), `Rotating coverage missed ${row.mint}`);
  assert.ok(rows.some((r) => r.risk.state === "NOT_CHECKED"), "Evicted data must not masquerade as safe");
});

test("risk canonical validation rejects oversized base58, non-canonical encodings, and URL injection without requests", async () => {
  const invalid = ["bad", "../escape?mint=other", "z".repeat(44), "1".repeat(33), ` ${mint(1)}`, `${mint(1)} `,
    "0".repeat(32), null, undefined];
  for (const value of invalid) assert.equal(isLauncherRiskMint(value), false);
  for (const value of [mint(0), mint(1), ETF.mint, PUMPCAT.mint]) assert.equal(isLauncherRiskMint(value), true);
  const h = riskHarness(), rows = invalid.map((mint) => ({ mint }));
  const coverage = await h.service.enrich(rows);
  assert.equal(h.calls.length, 0); assert.equal(coverage.unavailable, invalid.length);
  assert.ok(rows.every((r) => r.risk.error === "INVALID_MINT" && r.risk.highRisk === null));
  const s = setup({ riskOptions: {}, state: { coins: [coin(1, {}, { mint: "../escape" })] } });
  assert.equal(riskOf((await s.read()).body, "../escape").error, "INVALID_MINT");
  assert.equal(riskCalls(s).length, 0);
});

test("risk clock rollback/future cache timestamps fail unknown and keep pressure bounded; isolate caches are separate", async () => {
  const h = riskHarness(), rows = [coin(1)]; await h.service.enrich(rows);
  assert.equal(rows[0].risk.state, "READY");
  h.advance(-1); h.service.attach(rows);
  assert.equal(rows[0].risk.state, "NOT_CHECKED"); assert.equal(rows[0].risk.highRisk, null);
  await h.service.enrich(rows); assert.equal(h.calls.length, 3);
  const other = riskHarness(); other.service.attach(rows);
  assert.equal(rows[0].risk.state, "NOT_CHECKED");
  h.setClock(NaN); h.service.attach(rows);
  assert.equal(rows[0].risk.state, "UNAVAILABLE"); assert.equal(rows[0].risk.error, "CLOCK_INVALID");
});

test("risk body processing consumes the common monotonic budget even before the real timeout timer fires", async () => {
  let elapsed = 0;
  const h = riskHarness({ budgetMs: 25, monotonicClock: () => elapsed });
  h.state.hook = (token) => new Response(new ReadableStream({ pull(controller) {
    elapsed += 15;
    controller.enqueue(new TextEncoder().encode(JSON.stringify(riskReport(token))));
    controller.close();
  } }));
  const rows = Array.from({ length: 50 }, (_, i) => coin(i + 1));
  const coverage = await h.service.enrich(rows);
  assert.ok(elapsed >= 25);
  assert.ok(coverage.requested <= 2, "Body processing exhausted the stage before queued tokens could start");
  assert.equal(coverage.checked, 0);
  assert.equal(coverage.limited, true);
});

test("risk data handed to consumers cannot mutate cache, and refreshed creator identity discards old reputation", async () => {
  const h = riskHarness(), rows = [coin(1)];
  h.state.reports.set(mint(1), riskReport(mint(1), { creator: mint(9001), risks: [{ level: "info", name: "original" }] }));
  await h.service.enrich(rows);
  rows[0].risk.factors[0].name = "changed";
  rows[0].risk.reputation.evidence[0].checkedAt = NOW + 999_999;
  h.service.attach(rows);
  assert.equal(rows[0].risk.factors[0].name, "original");
  assert.equal(rows[0].risk.reputation.evidence[0].checkedAt, NOW);
  h.advance(300_000);
  h.state.reports.set(mint(1), riskReport(mint(1), { creator: mint(9003) }));
  await h.service.enrich(rows);
  assert.equal(rows[0].risk.state, "READY");
  assert.equal(rows[0].risk.reputation.status, "UNKNOWN");
  assert.deepEqual(rows[0].risk.reputation.evidence, []);
});

test("risk degradation: a throwing risk service never empties the feed on miss, hit, or stale paths", async () => {
  // An injected service that fails in both directions. The feed must degrade to
  // explicit NOT_CHECKED rows and fabricated zero coverage, never an error page.
  const broken = {
    enrich: async () => { throw new Error("unsafe risk detail"); },
    attach: () => { throw new Error("unsafe risk detail"); },
  };
  const s = setup({ riskService: broken });
  const miss = await s.read();
  assert.equal(miss.response.status, 200);
  assert.equal(miss.body.ranked.length, 1);
  assert.equal(miss.body.ranked[0].mint, mint(1));
  assert.equal(miss.body.statusError, null);
  assert.deepEqual(miss.body.ranked[0].risk, emptyLauncherRisk());
  assert.deepEqual(miss.body.riskCoverage, { total: 1, checked: 0, stale: 0, unavailable: 0,
    notChecked: 1, requested: 0, limited: false, nextRetryAt: null });
  assert.equal(JSON.stringify(miss.body).includes("unsafe risk detail"), false);
  const hit = await s.read();
  assert.equal(hit.response.headers.get("X-Launcher-Cache"), "hit");
  assert.equal(hit.body.ranked.length, 1);
  assert.deepEqual(hit.body.ranked[0].risk, emptyLauncherRisk());
  // Stale fallback path: coins fail after the warm response expired.
  s.advance(31_000);
  s.state.failCoins = true;
  const stale = await s.read();
  assert.equal(stale.response.headers.get("X-Launcher-Cache"), "stale");
  assert.equal(stale.body.stale, true);
  assert.equal(stale.body.ranked.length, 1);
  assert.deepEqual(stale.body.ranked[0].risk, emptyLauncherRisk());
});

test("risk degradation: enrich-only failure keeps attach-projected cached rows on rebuild", async () => {
  // enrich throws but attach is healthy: rows already warm in the shared cache
  // must still be projected rather than reset to NOT_CHECKED.
  const inner = createLauncherRiskService({ fetchImpl: async () => Response.json(riskReport(mint(1))), clock: () => NOW });
  const rows = [{ mint: mint(1) }];
  await inner.enrich(rows);
  let fail = true;
  const flaky = { enrich: async (...args) => { if (fail) throw new Error("boom"); return inner.enrich(...args); },
    attach: (...args) => inner.attach(...args) };
  const s = setup({ riskService: flaky });
  const { body } = await s.read();
  assert.equal(body.ranked[0].risk.state, "READY");
  assert.equal(body.riskCoverage.checked, 1);
});