import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as web3 from "@solana/web3.js";
import * as spl from "@solana/spl-token";
import * as amounts from "../src/lib/swapAmounts.js";

const source = readFileSync(new URL("../src/lib/jupiterSwap.js", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const SOL = "So11111111111111111111111111111111111111112";
const OTC = "MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump";
const mint = new web3.PublicKey(OTC);
// Public points only; no keypairs, keys, real signatures, network or funds.
const wallet = Array.from({ length: 255 }, (_, i) => new web3.PublicKey(new Uint8Array(32).fill(i + 1)))
  .find((key) => web3.PublicKey.isOnCurve(key.toBytes()));
const address = wallet.toBase58();
const legacy = spl.TOKEN_PROGRAM_ID.toBase58();
const token2022 = spl.TOKEN_2022_PROGRAM_ID.toBase58();
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function harness({ rpc = async () => { throw new Error("Unexpected RPC"); }, invoke = async () => { throw new Error("Unexpected build/quote"); } } = {}) {
  const calls = [], confirmed = [], module = { exports: {} };
  const modules = {
    buffer: { Buffer }, "@/lib/bufferPolyfill": {}, "@solana/web3.js": web3, "@solana/spl-token": spl,
    "./swapAmounts.js": amounts,
    "@/api/base44Client": { base44: { functions: { invoke: (...args) => { calls.push(["invoke", ...args]); return invoke(...args); } } } },
    "@/lib/otcClaim": {
      relay: (...args) => { calls.push(args); return rpc(...args); },
      ensureConfirmed: async (...args) => { confirmed.push(args); },
    },
  };
  runInNewContext(compiled, { module, exports: module.exports, require: (name) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected dependency ${name}`); return modules[name];
  } });
  return { ...module.exports, calls, confirmed };
}

// Hand-built on-chain binary fixtures, independent of the production decoders.
function mintData(decimals = 6, size = 82) {
  const data = Buffer.alloc(size);
  data.writeBigUInt64LE(123456789n, 36); data[44] = decimals; data[45] = 1;
  if (size > 165) data[165] = 1;
  return data;
}
function accountData(raw = amounts.U64_MAX, size = 165) {
  const data = Buffer.alloc(size);
  mint.toBuffer().copy(data, 0); wallet.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(raw, 64); data[108] = 1;
  if (size > 165) data[165] = 2;
  return data;
}
const account = (pubkey, owner, data) => ({ pubkey, owner, data: data.toString("base64") });
const envelope = (acc) => ({ ok: true, accounts: [acc] });
const quote = (overrides = {}) => ({ inputMint: SOL, outputMint: OTC, inAmount: "100000000", outAmount: "1234567", otherAmountThreshold: "1222221",
  swapMode: "ExactIn", slippageBps: 100, routePlan: [{ swapInfo: { label: "fixture", inputMint: SOL, outputMint: OTC } }], ...overrides });

test("mint verification handles legacy and Token-2022 base/extended binary layouts", async () => {
  for (const [program, size] of [[legacy, 82], [token2022, 82], [token2022, 170]]) {
    for (const decimals of [0, 6, 9, 19, 255]) {
      const h = harness({ rpc: async () => envelope(account(OTC, program, mintData(decimals, size))) });
      const info = await h.getTokenInfo(OTC);
      assert.equal(info.mint, OTC); assert.equal(info.decimals, decimals); assert.equal(info.tokenProgram, program);
      assert.equal(Object.isFrozen(info), true);
      assert.deepEqual(Array.from(h.calls[0][1].pubkeys), [OTC]);
    }
  }
});

test("non-mints, missing/invalid accounts, owners and uninitialized mints reject", async () => {
  const badInit = mintData(); badInit[45] = 0;
  const badType = mintData(6, 166); badType[165] = 2;
  const badAuthority = mintData(); badAuthority.writeUInt32LE(2, 0);
  const fixtures = [null, account(OTC, legacy, Buffer.alloc(81)), account(OTC, address, mintData()),
    account(SOL, legacy, mintData()), account(OTC, legacy, badInit), account(OTC, token2022, badType),
    account(OTC, legacy, badAuthority), account(OTC, legacy, accountData()), account(OTC, token2022, accountData()),
    account(OTC, legacy, mintData(6, 170)), account(OTC, token2022, mintData(6, 355)),
    { pubkey: OTC, owner: legacy, data: "!invalid!" }];
  for (const fixture of fixtures) {
    const h = harness({ rpc: async () => envelope(fixture) });
    await assert.rejects(h.getTokenInfo(OTC));
  }
  for (const response of [{}, { ok: true, accounts: [] }, { ok: false, accounts: [null] }]) {
    await assert.rejects(harness({ rpc: async () => response }).getTokenInfo(OTC));
  }
});

test("ATA balance derives the verified program and returns raw bigint without rounding", async () => {
  for (const [program, size] of [[legacy, 165], [token2022, 165], [token2022, 174]]) {
    const ata = spl.getAssociatedTokenAddressSync(mint, wallet, false, new web3.PublicKey(program)).toBase58();
    const h = harness({ rpc: async (_mode, args) => envelope(args.pubkeys[0] === OTC
      ? account(OTC, program, mintData(19)) : account(ata, program, accountData(amounts.U64_MAX, size))) });
    const info = await h.getTokenInfo(OTC);
    assert.equal(await h.fetchTokenBalance(address, info), amounts.U64_MAX);
    assert.equal(h.calls[1][1].pubkeys[0], ata);
    await assert.rejects(h.fetchTokenBalance(address, { ...info, decimals: 6 }), /verified/);
  }
});

test("only explicit missing ATA is zero; owner/mint/wallet/state and RPC errors reject", async () => {
  const ata = spl.getAssociatedTokenAddressSync(mint, wallet, false, spl.TOKEN_2022_PROGRAM_ID).toBase58();
  const wrongMint = accountData(); new web3.PublicKey(SOL).toBuffer().copy(wrongMint, 0);
  const wrongOwner = accountData(); new web3.PublicKey(SOL).toBuffer().copy(wrongOwner, 32);
  const frozen = accountData(); frozen[108] = 2;
  const uninitialized = accountData(); uninitialized[108] = 0;
  const wrongType = accountData(1n, 170); wrongType[165] = 1;
  for (const fixture of [null, account(ata, legacy, accountData()), account(ata, token2022, wrongMint),
    account(ata, token2022, wrongOwner), account(ata, token2022, frozen), account(ata, token2022, uninitialized),
    account(ata, token2022, wrongType), account(ata, token2022, Buffer.alloc(164)), account(SOL, token2022, accountData()), undefined]) {
    let reads = 0;
    const h = harness({ rpc: async () => ++reads === 1 ? envelope(account(OTC, token2022, mintData())) : envelope(fixture) });
    const info = await h.getTokenInfo(OTC);
    if (fixture === null) assert.equal(await h.fetchTokenBalance(address, info), 0n);
    else await assert.rejects(h.fetchTokenBalance(address, info));
  }
  let reads = 0;
  const h = harness({ rpc: async () => { if (++reads === 1) return envelope(account(OTC, token2022, mintData())); throw new Error("RPC offline"); } });
  await assert.rejects(h.fetchTokenBalance(address, await h.getTokenInfo(OTC)), /RPC offline/);
});

test("legacy balance exports keep numeric units but failures and unsafe lamports reject", async () => {
  const h = harness({ rpc: async (mode, args) => mode === "balance" ? { ok: true, lamports: 1234567890 } :
    envelope(account(args.pubkeys[0], token2022, args.pubkeys[0] === OTC ? mintData() : accountData(1234567n))) });
  assert.equal(await h.fetchOtcBalance(address), 1.234567);
  assert.equal(await h.fetchSolBalanceRaw(address), 1234567890n);
  assert.equal(await h.fetchSolBalance(address), 1.23456789);
  for (const lamports of [null, undefined, -1, 1.5, 9007199254740992]) {
    await assert.rejects(harness({ rpc: async () => ({ ok: true, lamports }) }).fetchSolBalanceRaw(address));
  }
  await assert.rejects(harness().fetchOtcBalance(address), /Unexpected RPC/);
  await assert.rejects(harness().fetchSolBalance(address), /Unexpected RPC/);
});

test("quote relay receives lossless strings and validates ExactIn, pair, size, slippage and route", async () => {
  const h = harness({ invoke: async (_name, args) => ({ data: { quote: quote({ inAmount: args.amount }) } }) });
  await h.getQuote(SOL, OTC, amounts.U64_MAX, 100);
  assert.equal(h.calls[0][1], "jupiterSwapRelay");
  assert.equal(h.calls[0][2].amount, "18446744073709551615");
  for (const overrides of [{ inputMint: OTC }, { outputMint: SOL }, { inAmount: "1" }, { inAmount: 100000000 },
    { slippageBps: 50 }, { swapMode: "ExactOut" }, { routePlan: [] }, { routePlan: [null] }, { outAmount: "0" },
    { outAmount: "18446744073709551616" }, { otherAmountThreshold: "999999999" }, { error: "bad" }]) {
    assert.throws(() => h.validateQuote(quote(overrides), SOL, OTC, "100000000", 100));
  }
  const sell = quote({ inputMint: OTC, outputMint: SOL });
  assert.equal(h.validateQuote(sell, OTC, SOL, "100000000", 100), sell);
  await assert.rejects(h.getQuote(SOL, SOL, 1n));
  await assert.rejects(h.getQuote(SOL, OTC, 9007199254740992));
  await assert.rejects(h.getQuote(SOL, OTC, 1n, 5001));
  await assert.rejects(harness({ invoke: async () => ({ data: {} }) }).getQuote(SOL, OTC, 1n));
  await assert.rejects(harness({ invoke: async () => ({ data: {} }) }).getSwapTx(quote(), address), /no transaction/);
});

function transaction() {
  const message = new web3.TransactionMessage({ payerKey: wallet, recentBlockhash: web3.PublicKey.default.toBase58(), instructions: [] }).compileToV0Message();
  return Buffer.from(new web3.VersionedTransaction(message).serialize()).toString("base64");
}
// Synthetic signature bytes for offline plumbing only; deliberately not signed.
const syntheticSign = async (tx) => { tx.signatures[0][0] = 1; return tx.serialize(); };
const rpcSuccess = async (mode) => mode === "simulate" ? { ok: true, err: null, units: 123, logs: [] } : { ok: true, sig: "synthetic-offline-signature" };

test("swap preserves fee-payer -> simulate -> wallet -> send -> confirm ordering", async () => {
  const h = harness({ rpc: rpcSuccess }), phases = [];
  const result = await h.executeSwap(transaction(), syntheticSign, () => {}, address, (phase) => phases.push(phase));
  assert.equal(result.ok, true);
  assert.deepEqual(phases, ["sim", "sign", "send", "confirm"]);
  assert.deepEqual(h.calls.map(([mode]) => mode), ["simulate", "send"]);
  assert.equal(h.confirmed.length, 1);
  let signed = 0;
  const badPayer = await h.executeSwap(transaction(), () => { signed++; }, () => {}, SOL);
  assert.equal(badPayer.reason, "fee_payer_mismatch"); assert.equal(signed, 0);
});

test("simulation failures and stale contexts never request signatures", async () => {
  for (const response of [{}, { ok: true, err: false }, { ok: true, err: "simulation failed" }]) {
    let signed = 0;
    const h = harness({ rpc: async () => response });
    assert.equal((await h.executeSwap(transaction(), () => { signed++; }, () => {}, address)).ok, false);
    assert.equal(signed, 0);
  }
  const pending = deferred(); let current = true, signed = 0;
  const h = harness({ rpc: () => pending.promise });
  const result = h.executeSwap(transaction(), () => { signed++; }, () => {}, address, undefined, () => current);
  current = false; pending.resolve(await rpcSuccess("simulate"));
  assert.equal((await result).reason, "context_changed"); assert.equal(signed, 0);
  const untouched = harness();
  assert.equal((await untouched.executeSwap(transaction(), syntheticSign, () => {}, address, undefined, () => false)).reason, "context_changed");
  assert.equal(untouched.calls.length, 0);
});

test("approved tx still broadcasts after UI invalidation, but not after wallet changes or mutation", async () => {
  const pending = deferred(), started = deferred(); let current = true;
  const h = harness({ rpc: rpcSuccess });
  const result = h.executeSwap(transaction(), async (tx) => { started.resolve(); await pending.promise; return syntheticSign(tx); },
    () => {}, address, undefined, () => current);
  await started.promise; current = false; pending.resolve();
  assert.equal((await result).ok, true);
  assert.equal(h.calls.some(([mode]) => mode === "send"), true);
  const switched = harness({ rpc: rpcSuccess });
  assert.equal((await switched.executeSwap(transaction(), syntheticSign, () => {}, address, undefined, () => true, () => false)).reason, "wallet_changed");
  assert.equal(switched.calls.some(([mode]) => mode === "send"), false);
  const mutated = harness({ rpc: rpcSuccess });
  const bad = await mutated.executeSwap(transaction(), (tx) => { tx.message.recentBlockhash = SOL; return syntheticSign(tx); }, () => {}, address);
  assert.equal(bad.ok, false); assert.match(bad.reason, /changed or unsigned/);
  assert.equal(mutated.calls.some(([mode]) => mode === "send"), false);
});