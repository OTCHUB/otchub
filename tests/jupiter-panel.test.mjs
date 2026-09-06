import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import React from "react";
import ts from "typescript";
import * as amounts from "../src/lib/swapAmounts.js";
import * as format from "../src/lib/format.js";

const source = readFileSync(new URL("../src/components/otc/JupiterSwapPanel.jsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("JupiterSwapPanel.jsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
assert.equal(ast.parseDiagnostics.length, 0, "Panel JSX must parse");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
const SOL = "So11111111111111111111111111111111111111112";
const OTC = "MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump";
const OTHER = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const token = { mint: OTHER, symbol: "ALT", name: "Selected token", decimals: 0, mcap: 4321, change24h: -4, vol24: 321, liquidity: 654, metricsAt: 1800000000000 };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const quote = (inputMint = SOL, outputMint = OTC, inAmount = "100000000", slippageBps = 100, label = "fixture-route") => ({
  inputMint, outputMint, inAmount, slippageBps, swapMode: "ExactIn", outAmount: "123456789", otherAmountThreshold: "120000000", priceImpactPct: "0.1", routePlan: [{ swapInfo: { label } }],
});
function nodes(element) {
  if (Array.isArray(element)) return element.flatMap(nodes);
  if (!element || typeof element !== "object") return [];
  return [element, ...nodes(element.props?.children)];
}
function text(element) {
  if (Array.isArray(element)) return element.map(text).join("");
  if (typeof element === "string" || typeof element === "number") return String(element);
  return element && typeof element === "object" ? text(element.props?.children) : "";
}
function PriceCandles() { return null; }
function RecentSwaps() { return null; }
function Stub() { return null; }

// Real transpiled JSX with deterministic hooks/microtasks/timers; no DOM, wallet,
// provider, private keys or network. This models races, not React DOM/E2E behavior.
function harness(initialProps = {}, overrides = {}) {
  const slots = [], effects = [], pendingEffects = [], timers = new Map();
  const calls = { info: [], balances: [], sol: [], prices: [], quotes: [], builds: [], executions: [], signatures: [], sends: [], busy: [], copies: [] };
  let cursor = 0, effectCursor = 0, timerId = 0, dirty = false, unmounted = false, writes = 0;
  let props = { wallet: "wallet-a", latest: { token_market_cap: 999999999999, token_price_change_1h: 9876 }, history: ["OTC history"], onBusyChange: (value) => calls.busy.push(value), ...initialProps };
  let signerWallet = props.wallet;
  const hooks = {
    __esModule: true, default: React,
    useState: (initial) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next) => { writes++; dirty = true; slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useRef: (initial) => { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }); },
    useEffect: (setup, deps) => {
      const index = effectCursor++, previous = effects[index];
      if (previous && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return;
      pendingEffects.push(() => { previous?.cleanup?.(); effects[index] = { deps, setup, cleanup: setup() }; });
    },
  };
  const swap = {
    SOL_MINT: SOL, OTC_MINT: OTC,
    getTokenInfo: async (mint) => { calls.info.push(mint); return overrides.info ? overrides.info(mint) : { mint, decimals: 6, tokenProgram: "verified-program" }; },
    fetchTokenBalance: async (wallet, info) => { calls.balances.push([wallet, info]); return overrides.balance ? overrides.balance(wallet, info) : 10000000n; },
    fetchSolBalanceRaw: async (wallet) => { calls.sol.push(wallet); return overrides.sol ? overrides.sol(wallet) : 1000000000n; },
    getQuote: async (...args) => { calls.quotes.push(args); return overrides.quote ? overrides.quote(...args) : quote(...args); },
    getSwapTx: async (...args) => { calls.builds.push(args); return overrides.build ? overrides.build(...args) : { swapTransaction: "offline-fixture" }; },
    executeSwap: async (tx, sign, log, wallet, phase, shouldContinue, shouldBroadcast) => {
      calls.executions.push({ tx, wallet, shouldContinue, shouldBroadcast });
      phase("sim");
      await overrides.simulate?.();
      if (!shouldContinue()) return { ok: false, reason: "context_changed" };
      phase("sign");
      await sign({});
      if (!shouldBroadcast()) return { ok: false, reason: "wallet_changed" };
      phase("send"); calls.sends.push(wallet); log({ type: "ok", msg: "offline sent" }); phase("confirm");
      return { ok: true, sig: "offline-signature" };
    },
  };
  const modules = {
    react: hooks, "lucide-react": { Check: Stub, Copy: Stub, Zap: Stub }, "@/lib/jupiterSwap": swap,
    "@/lib/swapAmounts": amounts, "@/lib/format": format,
    "@/lib/walletSigner": { getSignerForAddress: (wallet) => wallet === signerWallet ? {
      signTransactionRaw: async (tx) => { calls.signatures.push(wallet); return overrides.sign ? overrides.sign(tx) : new Uint8Array([1]); },
    } : null },
    "@/lib/stockPrices": { fetchTokenPricesUsd: async (mints) => { calls.prices.push(mints); return overrides.prices ? overrides.prices(mints) : Object.fromEntries(mints.map((mint) => [mint, mint === SOL ? 100 : 0.5])); } },
    "@/components/otc/PriceCandles": { __esModule: true, default: PriceCandles },
    "@/components/otc/RecentSwaps": { __esModule: true, default: RecentSwaps },
  };
  for (const name of ["HelpNote", "TxStatusOverlay", "WalletConnect"]) modules[`@/components/otc/${name}`] = { __esModule: true, default: Stub };
  const module = { exports: {} };
  runInNewContext(compiled, { module, exports: module.exports, AbortController,
    navigator: { clipboard: { writeText: async (value) => { calls.copies.push(value); } } },
    fetch: overrides.fetch || (() => { throw new Error("Unexpected network request"); }),
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout: (id) => timers.delete(id),
    require: (name) => { assert.ok(Object.hasOwn(modules, name), `Unexpected import ${name}`); return modules[name]; },
  });
  const h = {
    calls, timers,
    get writes() { return writes; },
    get content() { return text(h.tree); },
    render(patch = {}, runEffects = true) {
      if (Object.hasOwn(patch, "wallet")) signerWallet = patch.wallet;
      props = { ...props, ...patch }; dirty = false; cursor = 0; effectCursor = 0;
      h.tree = module.exports.default(props);
      if (runEffects) h.effects();
      return h.tree;
    },
    effects: () => pendingEffects.splice(0).forEach((setup) => setup()),
    async flush() { for (let i = 0; i < 25; i++) { await Promise.resolve(); if (dirty && !unmounted) h.render(); } },
    button: (label) => { const node = nodes(h.tree).find((node) => node.type === "button" && text(node).includes(label)); assert.ok(node, `Missing button ${label}`); return node; },
    click: (label) => h.button(label).props.onClick(),
    input: () => nodes(h.tree).find((node) => node.props?.["aria-label"] === "Swap amount"),
    amount: (value) => h.input().props.onChange({ target: { value } }),
    slip: (value) => nodes(h.tree).find((node) => node.props?.title === "Custom slippage in %").props.onChange({ target: { value } }),
    fire(delay) {
      const entry = [...timers].find(([, timer]) => timer.delay === delay); assert.ok(entry, `Missing ${delay}ms timer`);
      timers.delete(entry[0]); return entry[1].fn();
    },
    setSignerWallet: (value) => { signerWallet = value; },
    unmount: () => { unmounted = true; effects.forEach((effect) => effect.cleanup?.()); },
    replay: () => { effects.forEach((effect) => effect.cleanup?.()); effects.forEach((effect) => { effect.cleanup = effect.setup(); }); },
  };
  h.render(); return h;
}

test("default OTC UI and public metadata/quotes work without a connected wallet", async () => {
  const h = harness({ wallet: null });
  assert.deepEqual(h.calls.info, [OTC]);
  await h.flush(); h.fire(500); await h.flush();
  assert.deepEqual(h.calls.quotes[0], [SOL, OTC, "100000000", 100]);
  assert.ok(nodes(h.tree).some((node) => node.type === PriceCandles));
  assert.ok(nodes(h.tree).some((node) => node.type === RecentSwaps));
  assert.equal(h.button("[SWAP").props.disabled, true);
  assert.match(h.content, /123.456789/);
  assert.equal(h.calls.balances.length, 0);
  h.unmount();
});

test("selected token owns labels, links, prices, snapshot stats and verified decimals", async () => {
  const h = harness({ wallet: null, token }, { info: async (mint) => ({ mint, decimals: 9 }) });
  await h.flush(); h.fire(500); await h.flush();
  assert.equal(h.calls.quotes[0][1], OTHER);
  assert.deepEqual(Array.from(h.calls.prices[0]), [SOL, OTHER]);
  assert.match(h.content, /0.123456789/);
  assert.match(h.content, /ON-CHAIN DECIMALS: 9/);
  assert.match(h.content, /SELECTED-TOKEN SNAPSHOT.*AS OF.*NOT LIVE \/ MAY BE STALE/);
  assert.doesNotMatch(h.content, /999\.99B|9876|OTC history|\$OTC_BAL|SWAP.*\$OTC/);
  assert.equal(nodes(h.tree).some((node) => node.type === PriceCandles || node.type === RecentSwaps), false);
  assert.ok(nodes(h.tree).some((node) => node.props?.href === `https://solscan.io/token/${OTHER}`));
  assert.ok(nodes(h.tree).some((node) => node.props?.href === `https://dexscreener.com/solana/${OTHER}`));
  await h.click("COPY CA"); assert.deepEqual(h.calls.copies, [OTHER]);
  h.click("[SELL"); await h.flush(); h.amount("0.000000001"); await h.flush();
  await h.click("[QUOTE]"); await h.flush();
  assert.deepEqual(h.calls.quotes.at(-1), [OTHER, SOL, "1", 100]);
  h.unmount();
});

test("MAX preserves every base unit for 0/6/9/high decimals including above 2^53", async () => {
  for (const decimals of [0, 6, 9, 30, 255]) {
    const h = harness({ token }, { info: async (mint) => ({ mint, decimals }), balance: async () => amounts.U64_MAX });
    await h.flush(); h.click("[SELL"); await h.flush();
    h.amount(amounts.formatRawAmount(1n, decimals)); await h.flush();
    h.click("[MAX]"); await h.flush();
    assert.equal(h.input().props.value, amounts.formatRawAmount(amounts.U64_MAX, decimals));
    await h.click("[QUOTE]");
    assert.equal(h.calls.quotes.at(-1)[2], amounts.U64_MAX.toString());
    assert.match(h.content, /STANDARD ATA ONLY/);
    h.unmount();
  }
});

test("SOL MAX reserves exact lamports and invalid/excess precision inputs disable swap", async () => {
  const h = harness(); await h.flush(); h.click("[MAX]"); await h.flush();
  assert.equal(h.input().props.value, "0.99");
  for (const value of ["", "1e2", "-1", "0", "0.0000000001", "18446744073.709551616"]) {
    h.amount(value); await h.flush();
    assert.equal(h.button("[SWAP").props.disabled, true);
    assert.equal(h.button("[QUOTE]").props.disabled, true);
  }
  h.amount("0.1"); h.slip("0.001"); await h.flush();
  assert.equal(h.button("[SWAP").props.disabled, true);
  h.slip("1.23"); await h.flush(); await h.click("[QUOTE]");
  assert.equal(h.calls.quotes.at(-1)[3], 123);
  h.unmount();
});

test("late quotes cannot attach after immediate amount/slippage/mode or wallet/mint changes", async () => {
  const mutations = [(h) => h.amount(""), (h) => h.slip("1.1"), (h) => h.click("[SELL"),
    (h) => h.render({ wallet: "wallet-b" }), (h) => h.render({ token })];
  for (const mutate of mutations) {
    const pending = deferred(); const h = harness({}, { quote: () => pending.promise });
    await h.flush(); const request = h.click("[QUOTE]");
    mutate(h); // Settle before a render to cover synchronous invalidation too.
    pending.resolve(quote(SOL, OTC, "100000000", 100, "STALE-ROUTE")); await request; await h.flush();
    assert.doesNotMatch(h.content, /STALE-ROUTE/); h.unmount();
  }
});

test("overlapping manual quotes are last-request-wins and old finally cannot end new loading", async () => {
  const first = deferred(), second = deferred(); let count = 0;
  const h = harness({}, { quote: () => ++count === 1 ? first.promise : second.promise });
  await h.flush(); const old = h.click("[QUOTE]"); const current = h.click("[QUOTE]");
  first.reject(new Error("OLD ERROR")); await old; await h.flush();
  assert.equal(h.button("QUOTING").props.disabled, true); assert.doesNotMatch(h.content, /OLD ERROR/);
  second.resolve(quote(SOL, OTC, "100000000", 100, "NEW-ROUTE")); await current; await h.flush();
  assert.match(h.content, /NEW-ROUTE/); h.unmount();
});

test("mint A→B→A ignores first metadata response and clears displayed quote before effects", async () => {
  const reads = []; const h = harness({}, { info: () => { const d = deferred(); reads.push(d); return d.promise; } });
  h.render({ token }); h.render({ token: undefined });
  reads[0].resolve({ mint: OTC, decimals: 0 }); await h.flush();
  assert.match(h.content, /VERIFYING MINT/); assert.doesNotMatch(h.content, /ON-CHAIN DECIMALS: 0/);
  reads[2].resolve({ mint: OTC, decimals: 6 }); await h.flush();
  await h.click("[QUOTE]"); await h.flush(); assert.match(h.content, /fixture-route/);
  h.render({ token }, false); assert.doesNotMatch(h.content, /fixture-route/); h.effects();
  reads[1].resolve({ mint: OTHER, decimals: 19 }); await h.flush();
  assert.match(h.content, /VERIFYING MINT/); h.unmount();
});

test("balances reuse delayed reads across amount, slippage and direction edits", async () => {
  const mutations = [(h) => h.amount("0.2"), (h) => h.slip("3"), (h) => h.click("[SELL")];
  for (const mutate of mutations) {
    const balance = deferred(), sol = deferred();
    const h = harness({}, { balance: () => balance.promise, sol: () => sol.promise });
    await h.flush(); mutate(h);
    // Settle before the edit renders: form invalidation must not cancel reads.
    balance.resolve(2222222n); sol.resolve(777777777n); await h.flush();
    assert.equal(h.calls.balances.length, 1); assert.equal(h.calls.sol.length, 1);
    assert.match(h.content, /2.222222/); assert.match(h.content, /0.777777777/);
    assert.doesNotMatch(h.content, /READING/); h.unmount();
  }
});

test("keystrokes and form toggles keep settled balances without extra RPCs or loading", async () => {
  const h = harness({}, { balance: async () => 2222222n, sol: async () => 777777777n });
  await h.flush();
  const mutations = [
    ...["", "0", "0.", "0.2", "0.25"].map((value) => (h) => h.amount(value)),
    ...["", "2", "2.", "2.5"].map((value) => (h) => h.slip(value)),
    (h) => h.click("0.5%"), (h) => h.click("[SELL"), (h) => h.click("[MAX]"), (h) => h.click("[BUY"),
  ];
  for (const mutate of mutations) {
    mutate(h); await h.flush();
    assert.equal(h.calls.info.length, 1);
    assert.equal(h.calls.balances.length, 1); assert.equal(h.calls.sol.length, 1);
    assert.match(h.content, /2.222222/); assert.match(h.content, /0.777777777/);
    assert.doesNotMatch(h.content, /READING/);
  }
  h.unmount();
});

test("balances ignore delayed reads only across actual mint/wallet epochs, including A→B→A", async () => {
  const changes = [[{ wallet: "wallet-b" }], [{ token }],
    [{ wallet: "wallet-b" }, { wallet: "wallet-a" }], [{ token }, { token: undefined }],
    [{ wallet: null }, { wallet: "wallet-a" }]];
  for (const patches of changes) {
    const balances = [], sols = [];
    const h = harness({}, {
      balance: () => { const d = deferred(); balances.push(d); return d.promise; },
      sol: () => { const d = deferred(); sols.push(d); return d.promise; },
    });
    await h.flush();
    for (const patch of patches) { h.render(patch); await h.flush(); }
    balances.at(-1).resolve(2222222n); sols.at(-1).resolve(777777777n); await h.flush();
    h.amount("0.3"); h.slip("2"); await h.flush();
    for (const d of balances.slice(0, -1)) d.resolve(9876543n);
    for (const d of sols.slice(0, -1)) d.resolve(987654321n);
    await h.flush();
    assert.equal(h.calls.balances.length, patches.filter((patch) => patch.wallet !== null).length + 1);
    assert.equal(h.calls.sol.length, h.calls.balances.length);
    assert.match(h.content, /2.222222/); assert.match(h.content, /0.777777777/);
    assert.doesNotMatch(h.content, /9.876543|0.987654321/); h.unmount();
  }
});

test("settled balances are hidden before effects on mint/wallet replacement", async () => {
  for (const patch of [{ token }, { wallet: "wallet-b" }]) {
    const h = harness({}, { balance: async () => 2222222n, sol: async () => 777777777n });
    await h.flush(); h.render(patch, false);
    assert.match(h.content, /READING/); assert.doesNotMatch(h.content, /2.222222|0.777777777/);
    assert.equal(h.button("[SWAP").props.disabled, true);
    h.effects(); await h.flush(); h.unmount();
  }
});

test("overlapping manual balance retries remain last-request-wins across form edits", async () => {
  const balances = [], sols = [];
  const h = harness({}, {
    balance: () => { const d = deferred(); balances.push(d); return d.promise; },
    sol: () => { const d = deferred(); sols.push(d); return d.promise; },
  });
  await h.flush(); h.click("[RETRY BALANCES]"); h.amount("0.2"); await h.flush();
  balances[1].resolve(2222222n); sols[1].resolve(777777777n); await h.flush();
  balances[0].reject(new Error("STALE BALANCE ERROR")); sols[0].resolve(987654321n); await h.flush();
  assert.equal(h.calls.balances.length, 2); assert.equal(h.calls.sol.length, 2);
  assert.match(h.content, /2.222222/); assert.match(h.content, /0.777777777/);
  assert.doesNotMatch(h.content, /STALE BALANCE ERROR|0.987654321/); h.unmount();
});

test("balance errors persist across form edits without implicit RPC retries", async () => {
  for (const kind of ["balance", "sol"]) {
    const h = harness({}, { [kind]: async () => { throw new Error("RPC offline"); } });
    await h.flush();
    for (const mutate of [(h) => h.amount("0.2"), (h) => h.slip("2"), (h) => h.click("[SELL")]) {
      mutate(h); await h.flush();
      assert.match(h.content, /UNAVAILABLE.*RPC offline/); assert.doesNotMatch(h.content, /READING/);
      assert.equal(h.calls.balances.length, 1); assert.equal(h.calls.sol.length, 1);
    }
    h.unmount();
  }
});

test("RPC failures stay unavailable, retry recovers, and insufficient token balance uses bigint", async () => {
  let fail = true;
  const h = harness({ token }, { info: async (mint) => ({ mint, decimals: 0 }), balance: async () => { if (fail) throw new Error("RPC offline"); return 9007199254740993n; } });
  await h.flush(); assert.match(h.content, /UNAVAILABLE.*RPC offline/);
  h.click("[SELL"); await h.flush(); assert.equal(h.button("[SWAP").props.disabled, true);
  assert.equal(h.calls.balances.length, 1); assert.equal(h.calls.sol.length, 1);
  fail = false; await h.click("[RETRY BALANCES]"); await h.flush();
  h.amount("9007199254740994"); await h.flush(); await h.click("[SWAP"); await h.flush();
  assert.equal(h.calls.balances.length, 2); assert.equal(h.calls.sol.length, 2);
  assert.match(h.content, /balance too low/); assert.equal(h.calls.quotes.length, 0); h.unmount();
});

test("only an actual mint change resets SELL size to BUY 0.1 SOL, blocking pre-reset actions", async () => {
  const h = harness(); await h.flush(); h.click("[SELL"); await h.flush(); h.amount("7"); await h.flush();
  h.render({ token: { mint: OTC, symbol: "RENAMED" }, wallet: "wallet-b" }); await h.flush();
  assert.equal(h.input().props.value, "7"); assert.match(h.content, /YOU PAY \(\$RENAMED\)/);
  await h.click("[QUOTE]"); await h.flush();
  assert.deepEqual(h.calls.quotes.at(-1), [OTC, SOL, "7000000", 100]);
  const oldSwap = h.button("[SWAP");
  h.render({ token }, false);
  assert.match(h.content, /Resetting swap form/); assert.doesNotMatch(h.content, /fixture-route/);
  assert.equal(h.button("[SWAP").props.disabled, true); assert.equal(h.button("[QUOTE]").props.disabled, true);
  const resettingSwap = h.button("[SWAP");
  await oldSwap.props.onClick(); await resettingSwap.props.onClick();
  assert.equal(h.calls.quotes.length, 1); assert.equal(h.calls.builds.length, 0);
  h.effects(); await h.flush();
  assert.equal(h.input().props.value, "0.1"); assert.match(h.content, /YOU PAY \(SOL\)/);
  // Even a saved handler from before the reset cannot trade its old SELL size.
  await resettingSwap.props.onClick(); assert.equal(h.calls.quotes.length, 1);
  await h.click("[SWAP"); await h.flush();
  assert.deepEqual(h.calls.quotes.at(-1), [SOL, OTHER, "100000000", 100]);
  assert.equal(h.calls.sends.length, 1); h.unmount();
});

test("metadata retry recovers without remounting and uses verified decimals, even without a wallet", async () => {
  for (const wallet of [null, "wallet-a"]) {
    const pending = deferred(); let attempt = 0;
    const h = harness({ token, wallet }, { info: () => {
      if (++attempt < 3) throw new Error("Mint RPC offline");
      return pending.promise;
    } });
    await h.flush(); assert.match(h.content, /Mint RPC offline/);
    assert.equal(h.button("[SWAP").props.disabled, true); assert.equal(h.button("[QUOTE]").props.disabled, true);
    assert.equal(h.calls.balances.length, 0); assert.equal(h.calls.sol.length, 0);
    h.click("[RETRY MINT METADATA]"); await h.flush(); assert.match(h.content, /Mint RPC offline/);
    h.click("[RETRY MINT METADATA]"); await h.flush();
    assert.match(h.content, /VERIFYING MINT/); assert.doesNotMatch(h.content, /Mint RPC offline|RETRY MINT METADATA/);
    h.amount("0.2"); h.slip("2"); await h.flush();
    assert.equal(h.calls.info.length, 3); assert.equal(h.calls.quotes.length, 0);
    assert.equal(h.calls.balances.length, 0); assert.equal(h.calls.sol.length, 0);
    const verified = { mint: OTHER, decimals: 9, tokenProgram: "verified-retry-program" };
    pending.resolve(verified); await h.flush();
    assert.match(h.content, /ON-CHAIN DECIMALS: 9/); assert.equal(h.input().props.value, "0.2");
    assert.equal(h.calls.balances.length, wallet ? 1 : 0);
    if (wallet) assert.equal(h.calls.balances[0][1], verified);
    h.click("[SELL"); await h.flush(); h.amount("0.000000001"); await h.flush();
    await h.click("[QUOTE]"); await h.flush();
    assert.deepEqual(h.calls.quotes.at(-1), [OTHER, SOL, "1", 200]); h.unmount();
  }
});

test("metadata retries ignore responses and saved retry handlers across mint A→B→A", async () => {
  const reads = [];
  const h = harness({}, { info: () => { const d = deferred(); reads.push(d); return d.promise; } });
  reads[0].reject(new Error("Mint RPC offline")); await h.flush();
  const retry = h.button("[RETRY MINT METADATA]"); retry.props.onClick(); await h.flush();
  h.render({ token }); h.render({ token: undefined });
  retry.props.onClick(); assert.equal(h.calls.info.length, 4);
  reads[1].resolve({ mint: OTC, decimals: 19 }); await h.flush();
  assert.match(h.content, /VERIFYING MINT/); assert.doesNotMatch(h.content, /ON-CHAIN DECIMALS: 19/);
  reads[3].resolve({ mint: OTC, decimals: 6 }); await h.flush();
  reads[2].reject(new Error("STALE MINT ERROR")); await h.flush();
  assert.match(h.content, /ON-CHAIN DECIMALS: 6/); assert.doesNotMatch(h.content, /STALE MINT ERROR/);
  h.unmount();
});

test("metadata retries are last-request-wins and unmounted retries cannot write or restart", async () => {
  const reads = [];
  const h = harness({}, { info: () => { const d = deferred(); reads.push(d); return d.promise; } });
  reads[0].reject(new Error("Mint RPC offline")); await h.flush();
  const retry = h.button("[RETRY MINT METADATA]"); retry.props.onClick(); retry.props.onClick();
  reads[1].reject(new Error("STALE RETRY ERROR")); await h.flush();
  assert.match(h.content, /VERIFYING MINT/); assert.doesNotMatch(h.content, /STALE RETRY ERROR/);
  h.unmount(); const writes = h.writes;
  reads[2].resolve({ mint: OTC, decimals: 9 }); await h.flush(); retry.props.onClick();
  assert.equal(h.writes, writes); assert.equal(h.calls.info.length, 3);
});

test("swap locks duplicate clicks and reset synchronously, not just through disabled state", async () => {
  const pending = deferred(); let resets = 0;
  const h = harness({ token, onResetToken: () => { resets++; } }, { quote: () => pending.promise });
  await h.flush(); const swapButton = h.button("[SWAP"), resetButton = h.button("RESET");
  const request = swapButton.props.onClick(); swapButton.props.onClick(); resetButton.props.onClick();
  assert.deepEqual(h.calls.busy, [true]); assert.equal(h.calls.quotes.length, 1); assert.equal(resets, 0);
  await h.flush(); assert.equal(h.button("RESET").props.disabled, true);
  pending.resolve(quote(SOL, OTHER)); await request; await h.flush();
  assert.deepEqual(h.calls.busy, [true, false]); assert.equal(h.calls.sends.length, 1);
  h.click("RESET"); assert.equal(resets, 1); h.unmount();
});

test("swap busy invalidates pending balance retries and blocks new balance requests", async () => {
  const balance = deferred(), sol = deferred(), pending = deferred(); let balanceReads = 0, solReads = 0;
  const h = harness({}, {
    balance: () => ++balanceReads === 1 ? 2222222n : balance.promise,
    sol: () => ++solReads === 1 ? 777777777n : sol.promise,
    quote: () => pending.promise,
  });
  await h.flush(); const retry = h.button("[RETRY BALANCES]"); retry.props.onClick();
  const request = h.click("[SWAP"); retry.props.onClick(); h.amount("0.2"); await h.flush();
  assert.equal(h.button("[RETRY BALANCES]").props.disabled, true);
  balance.resolve(9876543n); sol.resolve(987654321n); await h.flush();
  assert.equal(h.calls.balances.length, 2); assert.equal(h.calls.sol.length, 2);
  assert.equal(h.input().props.value, "0.1"); assert.match(h.content, /2.222222/);
  assert.doesNotMatch(h.content, /9.876543|0.987654321/);
  pending.resolve(quote()); await request; await h.flush();
  assert.deepEqual(h.calls.busy, [true, false]); assert.equal(h.calls.balances.length, 3); h.unmount();
});

test("metadata retry is locked during a swap and recovers after busy releases", async () => {
  const pending = deferred(); let fail = true;
  const h = harness({}, { quote: () => pending.promise, info: (mint) => {
    if (mint === OTHER && fail) throw new Error("Mint RPC offline");
    return { mint, decimals: 6 };
  } });
  await h.flush(); const request = h.click("[SWAP"); h.render({ token }); await h.flush();
  assert.equal(h.button("[RETRY MINT METADATA]").props.disabled, true);
  h.click("[RETRY MINT METADATA]"); assert.equal(h.calls.info.length, 2);
  pending.resolve(quote()); await request; await h.flush(); fail = false;
  assert.equal(h.button("[RETRY MINT METADATA]").props.disabled, false);
  h.click("[RETRY MINT METADATA]"); await h.flush();
  assert.match(h.content, /ON-CHAIN DECIMALS: 6/); assert.equal(h.calls.info.length, 3);
  assert.equal(h.calls.signatures.length, 0); assert.deepEqual(h.calls.busy, [true, false]); h.unmount();
});

for (const stage of ["quote", "build", "simulate"]) {
  for (const change of ["mint", "wallet", "unmount", "signer"]) {
    test(`${change} during ${stage} stops before the wallet signature prompt`, async () => {
      const pending = deferred(); const h = harness({}, { [stage]: () => pending.promise });
      await h.flush(); const request = h.click("[SWAP"); await h.flush();
      if (change === "mint") h.render({ token });
      if (change === "wallet") h.render({ wallet: "wallet-b" });
      if (change === "signer") h.setSignerWallet("wallet-b");
      if (change === "unmount") h.unmount();
      const writes = h.writes;
      pending.resolve(stage === "quote" ? quote() : stage === "build" ? { swapTransaction: "fixture" } : undefined);
      await request; await h.flush();
      assert.equal(h.calls.signatures.length, 0); assert.equal(h.calls.sends.length, 0);
      assert.deepEqual(h.calls.busy, [true, false]);
      if (change === "unmount") assert.equal(h.writes, writes, "Unmounted work cannot set state");
      else h.unmount();
    });
  }
}

test("token changes/unmount after signature prompt do not drop approval; wallet change prevents send", async () => {
  for (const change of ["mint", "unmount", "wallet"]) {
    const pending = deferred(); const h = harness({}, { sign: () => pending.promise });
    await h.flush(); const request = h.click("[SWAP"); await h.flush();
    assert.equal(h.calls.signatures.length, 1);
    if (change === "mint") h.render({ token });
    else if (change === "wallet") h.render({ wallet: "wallet-b" });
    else h.unmount();
    pending.resolve(new Uint8Array([1])); await request; await h.flush();
    assert.equal(h.calls.sends.length, change === "wallet" ? 0 : 1);
    assert.deepEqual(h.calls.busy, [true, false]);
    if (change !== "unmount") h.unmount();
  }
});

test("delayed post-swap balance refresh survives form edits without redundant RPCs", async () => {
  const h = harness(); await h.flush(); await h.click("[SWAP"); await h.flush();
  const reads = h.calls.balances.length;
  h.amount("0.2"); h.slip("2"); await h.flush(); h.click("[SELL"); await h.flush();
  assert.equal(h.calls.balances.length, reads); assert.equal(h.calls.sol.length, reads);
  h.fire(3000); await h.flush();
  assert.equal(h.calls.balances.length, reads + 1); assert.equal(h.calls.sol.length, reads + 1); h.unmount();
});

test("delayed post-swap balance refresh cannot start against replaced mint/wallet epochs", async () => {
  for (const patches of [[{ wallet: "wallet-b" }], [{ token }],
    [{ wallet: "wallet-b" }, { wallet: "wallet-a" }], [{ token }, { token: undefined }]]) {
    const h = harness(); await h.flush(); await h.click("[SWAP"); await h.flush();
    for (const patch of patches) { h.render(patch); await h.flush(); }
    const reads = h.calls.balances.length;
    h.fire(3000); await h.flush();
    assert.equal(h.calls.balances.length, reads); assert.equal(h.calls.sol.length, reads);
    h.unmount(); assert.equal(h.timers.size, 0);
  }
});

test("StrictMode effect replay invalidates pending quotes and pre-sign work", async () => {
  const pending = deferred(); const h = harness({}, { quote: () => pending.promise });
  await h.flush(); const request = h.click("[SWAP"); await h.flush(); h.replay();
  pending.resolve(quote()); await request; await h.flush();
  assert.equal(h.calls.builds.length, 0); assert.equal(h.calls.signatures.length, 0);
  assert.deepEqual(h.calls.busy, [true, false]); h.unmount();
});

test("StrictMode metadata re-verification safely hides decimal-dependent data without resetting the form", async () => {
  for (const mode of ["BUY", "SELL"]) {
    const h = harness(); await h.flush(); h.click(`[${mode}`); await h.flush(); h.amount("0.2"); await h.flush();
    await h.click("[QUOTE]"); await h.flush(); assert.match(h.content, /fixture-route/);
    h.replay(); h.render();
    assert.match(h.content, /VERIFYING MINT/); assert.doesNotMatch(h.content, /fixture-route/);
    assert.equal(h.input().props.value, "0.2"); await h.flush();
    assert.match(h.content, /ON-CHAIN DECIMALS: 6/); assert.equal(h.input().props.value, "0.2");
    assert.match(h.content, mode === "BUY" ? /YOU PAY \(SOL\)/ : /YOU PAY \(\$OTC\)/); h.unmount();
  }
});

test("route failures surface honestly without build/sign and release busy", async () => {
  const h = harness({ token }, { quote: async () => { throw new Error("No Jupiter route is available for this token and amount"); } });
  await h.flush(); await h.click("[SWAP"); await h.flush();
  assert.match(h.content, /No Jupiter route is available/);
  assert.equal(h.calls.builds.length, 0); assert.equal(h.calls.signatures.length, 0);
  assert.deepEqual(h.calls.busy, [true, false]); h.unmount();
});

test("late prices never attach to the replacement mint, including shared maps with both mints", async () => {
  const reads = [];
  const h = harness({}, { prices: () => { const pending = deferred(); reads.push(pending); return pending.promise; } });
  await h.flush(); h.render({ token }); await h.flush();
  reads[1].resolve({ [SOL]: 200, [OTHER]: 3 }); await h.flush();
  assert.match(h.content, /\$20\.00/); assert.match(h.content, /\$30\.00/);
  reads[0].resolve({ [SOL]: 999, [OTC]: 999, [OTHER]: 999 }); await h.flush();
  assert.match(h.content, /\$20\.00/); assert.doesNotMatch(h.content, /\$99\.90/); h.unmount();
});

test("missing shared-cache price fetches only the selected Solana mint's best-liquidity price", async () => {
  const requests = [];
  const h = harness({ token }, {
    prices: async () => ({ [SOL]: 100, [OTC]: 999 }),
    fetch: async (url) => { requests.push(url); return { ok: true, json: async () => ({ pairs: [
      { chainId: "ethereum", baseToken: { address: OTHER }, priceUsd: "999" },
      { chainId: "solana", baseToken: { address: OTC }, priceUsd: "999" },
      { chainId: "solana", baseToken: { address: OTHER }, priceUsd: "2", liquidity: { usd: 1 } },
      { chainId: "solana", baseToken: { address: OTHER }, priceUsd: "3", liquidity: { usd: 50 } },
    ] }) }; },
  });
  await h.flush();
  assert.deepEqual(requests, [`https://api.dexscreener.com/latest/dex/tokens/${OTHER}`]);
  assert.match(h.content, /\$30\.00/); h.unmount();
});

test("unmounted prices, metadata and balance reads never write state or start fallback fetches", async () => {
  for (const kind of ["info", "prices", "balance"]) {
    const pending = deferred(); let fetched = 0;
    const h = harness({ token }, { [kind]: () => pending.promise, fetch: async () => { fetched++; throw new Error("not allowed"); } });
    await h.flush(); h.unmount(); const writes = h.writes;
    pending.resolve(kind === "info" ? { mint: OTHER, decimals: 9 } : kind === "balance" ? 1n : { [SOL]: 100 });
    await h.flush(); assert.equal(h.writes, writes); assert.equal(fetched, 0);
  }
});