import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { eligibleMetrics, isIssuedSignal, isTokenMint, signalCandidates, signalIdentity,
  strategyConfig } from "../base44/shared/ruFomoStrategy.js";
import { SIGNAL_CODES, SIGNAL_STATUSES, SOL_MINT } from "../base44/shared/ruFomoContract.js";
import { AT, MINT, ROW } from "./ru-fomo-api-fixtures.mjs";

const enabled = strategyConfig({ RU_FOMO_SIGNALS_ENABLED: "true" });
const candidates = (row = {}, snapshot = {}, config = enabled) => signalCandidates({ at: AT,
  ranked: [{ ...ROW, ...row }], stale: false, ...snapshot }, config, AT);

test("signal strategy has safe defaults and exact fixed wire fields", () => {
  assert.equal(strategyConfig({}).enabled, false);
  assert.deepEqual(candidates({}, {}, strategyConfig({})), []);
  const [signal] = candidates();
  assert.deepEqual(signal, { id: `RU_FOMO:6000000:${MINT}`, mint: MINT, action: "buy", baseAsset: "SOL",
    createdAt: AT, expiresAt: AT + 300000, reason: "volume_and_momentum",
    metrics: { volume24hUsd: 100000, marketCapUsd: 500000, change24hPct: 10, liquidityUsd: 25000 } });
  assert.equal(isIssuedSignal(signal), true);
});

test("thresholds are inclusive at both boundaries and exclusive outside", () => {
  for (const [field, value, expected] of [
    ["vol24", 99999.99, 0], ["vol24", 100000, 1], ["liquidity", 24999.99, 0], ["liquidity", 25000, 1],
    ["change24h", 9.999, 0], ["change24h", 10, 1], ["change24h", 100, 1], ["change24h", 100.001, 0],
  ]) assert.equal(candidates({ [field]: value }).length, expected, `${field}=${value}`);
  const custom = strategyConfig({ RU_FOMO_SIGNALS_ENABLED: "true", RU_FOMO_MIN_VOLUME_USD: "200000",
    RU_FOMO_MIN_CHANGE_PCT: "20", RU_FOMO_MAX_CHANGE_PCT: "30", RU_FOMO_MIN_LIQUIDITY_USD: "50000" });
  assert.equal(candidates({}, {}, custom).length, 0);
  assert.equal(candidates({ vol24: 200000, liquidity: 50000, change24h: 30 }, {}, custom).length, 1);
});

test("unknown and impossible values never become actionable metrics", () => {
  for (const field of ["vol24", "liquidity", "change24h"]) {
    for (const value of [null, undefined, NaN, Infinity, -Infinity, "100000", {}, true, -101, Number.MAX_VALUE]) {
      assert.equal(candidates({ [field]: value }).length, 0, `${field}: ${String(value)}`);
    }
  }
  for (const value of [-1, 0, NaN, Infinity, "500000", {}, Number.MAX_VALUE]) {
    assert.equal(candidates({ mcap: value }).length, 0);
  }
  assert.equal(candidates({ mcap: null }).length, 1, "market cap is explicitly nullable in the wire contract");
  assert.equal(eligibleMetrics({ ...candidates()[0].metrics, change24hPct: -101 },
    { minChange: -200, maxChange: 100, minVolume: 0, minLiquidity: 0 }), false);
});

test("stale, future and exactly expired snapshots are suppressed", () => {
  for (const snapshot of [{ stale: true }, { at: AT + 1 }, { at: AT - 300000 }, { at: null }, { at: NaN }]) {
    assert.deepEqual(candidates({}, snapshot), []);
  }
  assert.equal(candidates({}, { at: AT - 299999 }).length, 1);
});

test("identities are deterministic per mint/bucket with in-response duplicate elimination", () => {
  assert.equal(signalIdentity(AT, MINT), signalIdentity(AT + 299999, MINT));
  assert.notEqual(signalIdentity(AT, MINT), signalIdentity(AT + 300000, MINT));
  assert.equal(candidates({}, { ranked: [ROW, { ...ROW, change24h: 50 }] }).length, 1);
  assert.equal(candidates({}, { ranked: Array.from({ length: 100 }, () => ROW) }).length, 1);
});

test("base58 token mint validation excludes SOL, system program, malformed and wrong decoded lengths", () => {
  assert.equal(isTokenMint(MINT), true);
  for (const mint of [SOL_MINT, "SOL", "1".repeat(32), "2".repeat(32), "z".repeat(44), "0".repeat(44),
    `${MINT}?apiKey=x`, {}, null, "<script>"]) assert.equal(isTokenMint(mint), false);
});

test("malformed server thresholds and flags fail closed even when disabled", () => {
  for (const key of ["RU_FOMO_MIN_VOLUME_USD", "RU_FOMO_MIN_CHANGE_PCT", "RU_FOMO_MAX_CHANGE_PCT", "RU_FOMO_MIN_LIQUIDITY_USD"]) {
    for (const value of ["", " ", "-1", "0", "NaN", "Infinity", "1e309", "100x", 100, {}, "9007199254740992"]) {
      assert.throws(() => strategyConfig({ [key]: value }), { code: "CONFIG_INVALID" });
    }
  }
  for (const value of [true, 1, "TRUE", "1", "yes", ""]) {
    assert.throws(() => strategyConfig({ RU_FOMO_SIGNALS_ENABLED: value }), { code: "CONFIG_INVALID" });
  }
  assert.throws(() => strategyConfig({ RU_FOMO_MIN_CHANGE_PCT: "101" }), { code: "CONFIG_INVALID" });
});

test("private entity RLS denies ALL direct client operations and report enums match shared constants", async () => {
  for (const name of ["RuFomoSignal", "RuFomoReport"]) {
    const schema = JSON.parse(await readFile(new URL(`../base44/entities/${name}.jsonc`, import.meta.url), "utf8"));
    for (const operation of ["create", "read", "update", "delete", "write"]) assert.equal(schema.rls[operation], false);
    if (name === "RuFomoReport") {
      assert.deepEqual(schema.properties.status.enum, SIGNAL_STATUSES);
      assert.deepEqual(schema.properties.code.enum, SIGNAL_CODES);
      assert.equal(schema.properties.error, undefined);
    }
  }
});

test("runtime secrets and SDK clients are confined to thin authorized wrappers", async () => {
  for (const name of ["ruFomoSignals", "ruFomoReport"]) {
    const wrapper = await readFile(new URL(`../base44/functions/${name}/entry.ts`, import.meta.url), "utf8");
    assert.match(wrapper, /base44:runtime/);
    assert.match(wrapper, /getStore:.*asServiceRole\.entities/);
    assert.match(wrapper, /createClientFromRequest\(serviceRoleRequest\(req\)\)/);
    assert.match(wrapper, /export default createRuFomo/);
    const handler = await readFile(new URL(`../base44/functions/${name}/handler.js`, import.meta.url), "utf8");
    assert.doesNotMatch(handler, /base44:runtime|Deno\.env|process\.env|console\.|dataLock/);
  }
  const store = await readFile(new URL("../base44/shared/ruFomoStore.js", import.meta.url), "utf8");
  assert.doesNotMatch(store, /\.update\(|\.delete\(|dataLock/);
  assert.match(store, /Duplicate rows/);
});