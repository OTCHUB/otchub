import assert from "node:assert/strict";
import test from "node:test";
import { U64_MAX, parseAmountToRaw, formatRawAmount, validateRawAmount, parseSlippageBps } from "../src/lib/swapAmounts.js";

test("exact amounts and MAX round-trip for every mint precision, including 0/6/9/255", () => {
  for (const decimals of [0, 1, 6, 9, 18, 19, 20, 30, 100, 255]) {
    for (const raw of [0n, 1n, 999999n, 9007199254740993n, U64_MAX]) {
      const amount = formatRawAmount(raw, decimals);
      assert.equal(parseAmountToRaw(amount, decimals), raw);
      assert.doesNotMatch(amount, /[eE+-]/);
    }
  }
  assert.equal(formatRawAmount(U64_MAX, 6), "18446744073709.551615");
  assert.equal(parseAmountToRaw("9007199254740993", 0), 9007199254740993n);
  assert.equal(parseAmountToRaw("0.000000001", 9), 1n);
  assert.equal(parseAmountToRaw(".000001", 6), 1n);
  assert.equal(parseAmountToRaw("0001.0000000", 6), 1000000n);
  assert.equal(parseAmountToRaw("1.000", 0), 1n);
  assert.equal(parseAmountToRaw("1.", 0), 1n);
  assert.equal(formatRawAmount(1000000000n - 10000000n, 9), "0.99");
});

test("invalid/excess precision amounts never round, wrap, coerce, or use exponents", () => {
  for (const value of ["", ".", "1e3", "1E-6", "NaN", "Infinity", "-1", "+1", "1,000", " 1", "1 ", "0x10", 1, null, undefined]) {
    assert.throws(() => parseAmountToRaw(value, 6), /plain decimal/);
  }
  for (const [value, decimals] of [["0.1", 0], ["0.0000001", 6], ["0.0000000001", 9], ["1.00000000000000000001", 19]]) {
    assert.throws(() => parseAmountToRaw(value, decimals), /decimal places/);
  }
  for (const decimals of [-1, 256, 1.5, "6", undefined]) {
    assert.throws(() => parseAmountToRaw("1", decimals), /Invalid mint decimals/);
    assert.throws(() => formatRawAmount(1n, decimals), /Invalid mint decimals/);
  }
  assert.throws(() => parseAmountToRaw((U64_MAX + 1n).toString(), 0), /u64/);
  assert.throws(() => parseAmountToRaw("18446744073709.551616", 6), /u64/);
  assert.throws(() => parseAmountToRaw("1", 255));
});

test("raw input validates u64 and rejects already-rounded numbers", () => {
  assert.equal(validateRawAmount(U64_MAX.toString()), U64_MAX);
  assert.equal(validateRawAmount(100), 100n);
  for (const value of [-1, 1.5, 9007199254740992, NaN, Infinity, null, undefined, {}, "-1", "1e3", "", "1.0", U64_MAX + 1n]) {
    assert.throws(() => validateRawAmount(value));
  }
  assert.throws(() => validateRawAmount(0n, { positive: true }), /greater than zero/);
});

test("slippage is exact basis points and respects the existing relay bounds", () => {
  assert.equal(parseSlippageBps("0"), 0);
  assert.equal(parseSlippageBps("0.01"), 1);
  assert.equal(parseSlippageBps("0.5"), 50);
  assert.equal(parseSlippageBps("1.23"), 123);
  assert.equal(parseSlippageBps("50"), 5000);
  for (const value of ["", "-1", "0.001", "50.01", "1e1", "NaN"]) assert.throws(() => parseSlippageBps(value));
});