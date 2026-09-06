import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React from "react";
import ts from "typescript";

function compile(path) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
}
const nodes = (node) => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object"
  ? [node, ...nodes(node.props?.children)] : [];

// Transpiled parent + real callbacks; children are inert. No browser/network.
function harness(path, modules = {}, initialProps = {}) {
  const slots = [], effects = [], queued = [], timers = new Map(), scrolls = [];
  let cursor = 0, effectCursor = 0, dirty = false, nextTimer = 0, props = initialProps;
  const hooks = {
    __esModule: true, default: React,
    useState: (initial) => {
      const id = cursor++;
      if (!(id in slots)) slots[id] = typeof initial === "function" ? initial() : initial;
      return [slots[id], (next) => { slots[id] = typeof next === "function" ? next(slots[id]) : next; dirty = true; }];
    },
    useRef: (initial) => { const id = cursor++; return slots[id] ?? (slots[id] = { current: initial }); },
    useCallback: (fn) => fn,
    useEffect: (fn, deps) => {
      const id = effectCursor++, prev = effects[id];
      if (!prev || deps.some((d, i) => !Object.is(d, prev.deps[i]))) queued.push(() => {
        prev?.cleanup?.(); effects[id] = { deps, cleanup: fn() };
      });
    },
  };
  const module = { exports: {} }, children = {};
  runInNewContext(compile(path), {
    module, exports: module.exports,
    require: (name) => {
      if (name === "react") return hooks;
      if (modules[name]) return modules[name];
      if (name.startsWith("@/components/otc/")) {
        const id = name.split("/").at(-1);
        children[id] ||= function Child() { return null; };
        return { __esModule: true, default: children[id] };
      }
      throw new Error(`Unknown module ${name}`);
    },
    document: { getElementById: (id) => ({ scrollIntoView: () => scrolls.push(id) }) },
    window: { location: { hash: "" }, localStorage: { getItem: () => null } },
    setInterval: () => 1, clearInterval: () => {},
    setTimeout: (fn) => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: (id) => timers.delete(id),
  });
  const h = {
    timers, scrolls,
    render(patch = {}) {
      props = { ...props, ...patch }; cursor = 0; effectCursor = 0; dirty = false;
      h.tree = module.exports.default(props); queued.splice(0).forEach((fn) => fn()); return h.tree;
    },
    async flush() { for (let i = 0; i < 10; i++) { await Promise.resolve(); if (dirty) h.render(); } },
    child: (id) => nodes(h.tree).find((node) => node.type === children[id]),
  };
  h.render(); return h;
}

test("Home selection opens the swap, updates exact mint, preserves it on refresh, and locks during swaps", async () => {
  const h = harness("../src/pages/Home.jsx", {
    "@/api/base44Client": { base44: { functions: { invoke: async () => ({ data: { latest: {} } }) } } },
    "lucide-react": { RefreshCw: () => null },
    "@/lib/format": { timeAgo: () => "now" }, "@/lib/useLiveOtcPrice": { useLiveOtcPrice: () => null },
    "@/lib/solanaWallets": { silentReconnect: () => {} },
  });
  h.child("BootScreen").props.onComplete(); await h.flush();
  assert.equal(h.child("JupiterSwapPanel").props.token, undefined);
  const row = { mint: "launcher-mint", symbol: "ALT", mcap: 100 };
  h.child("LauncherAnalytics").props.onTrade(row); await h.flush();
  assert.equal(h.child("JupiterSwapPanel").props.token, row);
  assert.equal(h.child("LauncherAnalytics").props.selectedMint, row.mint);
  const card = nodes(h.tree).find((n) => n.props?.title === "TRADE :: $ALT");
  assert.equal(card.props.openSignal, 1);
  for (const fn of h.timers.values()) fn(); assert.ok(h.scrolls.includes("otc-swap"));
  const updated = { ...row, mcap: 200 };
  h.child("LauncherAnalytics").props.onSnapshot({ ranked: [updated] }); await h.flush();
  assert.equal(h.child("JupiterSwapPanel").props.token, updated);
  const swap = h.child("JupiterSwapPanel"), analytics = h.child("LauncherAnalytics");
  swap.props.onBusyChange(true);
  analytics.props.onTrade({ mint: "must-not-select" }); // before React re-renders
  swap.props.onResetToken();
  await h.flush();
  assert.equal(h.child("JupiterSwapPanel").props.token, updated);
  assert.equal(h.child("LauncherAnalytics").props.tradingDisabled, true);
  assert.equal(nodes(h.tree).find((n) => n.props?.title === "TRADE :: $ALT").props.locked, true);
  h.child("JupiterSwapPanel").props.onBusyChange(false); await h.flush();
  h.child("JupiterSwapPanel").props.onResetToken(); await h.flush();
  assert.equal(h.child("JupiterSwapPanel").props.token, undefined);
});

test("CollapsibleCard keeps the signer panel mounted while locked and honors open signals", async () => {
  const h = harness("../src/components/otc/CollapsibleCard.jsx", {}, { children: "CONTENT", locked: true });
  const toggle = () => nodes(h.tree).find((n) => n.props?.onClick).props.onClick();
  toggle(); await h.flush(); assert.equal(h.tree.props.children[1].props.children, "CONTENT");
  h.render({ locked: false }); toggle(); await h.flush(); assert.equal(h.tree.props.children[1], false);
  h.render({ openSignal: 1 }); await h.flush(); assert.equal(h.tree.props.children[1].props.children, "CONTENT");
});