import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import React from "react";
import ts from "typescript";
import { PUBLIC_API_META } from "../base44/shared/publicApiCatalog.js";
import * as api from "../src/lib/publicApi.js";

const componentPath = new URL("../src/components/otc/ApiAgentPanel.jsx", import.meta.url);
const compiled = ts.transpileModule(readFileSync(componentPath, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const at = 1800000000000;
const payload = (overrides = {}) => ({ ...PUBLIC_API_META.examples.metrics, at, limit: 1, ...overrides });
const response = (body = payload()) => ({ ok: true, status: 200, json: async () => body });
const publicRoute = PUBLIC_API_META.endpoints.find((endpoint) => endpoint.name === "getPublicMetrics");
function CopyBlock() { return null; }
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

// Actual JSX/transpiled component, deterministic hook/effect/timer stubs.
// This covers public request behavior without a browser, network, or new deps;
// it is not a React lifecycle/E2E test.
function harness(fetchImpl = async () => response()) {
  const slots = [], effects = [], pending = [], timers = new Map(), requests = [];
  let cursor = 0, effectCursor = 0, timerId = 0, clock = at + 500, writes = 0;
  const module = { exports: {} };
  const modules = {
    react: {
      __esModule: true, default: React,
      useState: (initial) => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [slots[index], (next) => { writes++; slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
      },
      useRef: (initial) => {
        const index = cursor++;
        return slots[index] ?? (slots[index] = { current: initial });
      },
      useEffect: (setup, deps) => {
        const index = effectCursor++, previous = effects[index];
        if (previous && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return;
        pending.push(() => {
          previous?.cleanup?.();
          effects[index] = { deps, setup, cleanup: setup() };
        });
      },
    },
    "@/components/otc/CopyBlock": { __esModule: true, default: CopyBlock },
    "../../../base44/shared/publicApiCatalog.js": { PUBLIC_API_META },
    "@/lib/publicApi": api,
  };
  runInNewContext(compiled, {
    module, exports: module.exports, AbortController,
    Date: class extends Date { static now() { return clock; } },
    window: { location: { origin: "https://dashboard.example" } },
    fetch: (url, options) => { requests.push({ url, options }); return fetchImpl(url, options); },
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout: (id) => timers.delete(id),
    require: (name) => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected import (must be browser-safe): ${name}`);
      return modules[name];
    },
  });
  const h = {
    requests, timers,
    get writes() { return writes; },
    get probe() { return slots[0]; },
    render() {
      cursor = 0; effectCursor = 0;
      h.tree = module.exports.default();
      pending.splice(0).forEach((setup) => setup());
      return h.tree;
    },
    button: () => nodes(h.tree).find((node) => node.type === "button"),
    check: () => h.button().props.onClick(),
    setTime: (time) => { clock = time; },
    fireTimer(delay) {
      const entry = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `Missing timer with delay ${delay}`);
      timers.delete(entry[0]); entry[1].fn();
    },
    unmount: () => effects.forEach((effect) => effect.cleanup?.()),
    replayEffects: () => effects.forEach((effect) => { effect.cleanup?.(); effect.cleanup = effect.setup(); }),
  };
  h.render();
  return h;
}

test("hosted base is same-origin /functions/, never an app route or query", () => {
  assert.equal(api.getPublicApiBaseUrl("https://dashboard.example/connect?view=docs#api"), "https://dashboard.example/functions/");
  assert.equal(api.getPublicApiBaseUrl("http://localhost:5173/nested/"), "http://localhost:5173/functions/");
  for (const origin of [undefined, null, "null", "", "invalid", "file:///preview", "javascript:void(0)"]) {
    assert.equal(api.getPublicApiBaseUrl(origin), "/functions/");
  }
});

test("status distinguishes known, checking, error, read evidence, and snapshot age", () => {
  const snapshot = api.readPublicMetricsSnapshot(payload());
  const probe = { phase: "success", snapshot };
  assert.equal(api.getPublicApiStatus(publicRoute, { phase: "idle" }), "KNOWN / NOT PROBED");
  assert.equal(api.getPublicApiStatus(publicRoute, { phase: "loading" }), "CHECKING PUBLIC READ");
  assert.equal(api.getPublicApiStatus(publicRoute, { ...probe, phase: "error" }), "ERROR / LAST CHECK");
  assert.equal(api.getPublicApiStatus(publicRoute, probe, at + 299999), "READ OK / LAST CHECK");
  assert.equal(api.getPublicApiStatus(publicRoute, probe, at + 300000), "STALE / LAST READ");
  for (const fields of [{ stale: true }, { cache: "stale" }]) {
    assert.equal(api.getPublicApiStatus(publicRoute, { ...probe, snapshot: { ...snapshot, ...fields } }, at), "STALE / LAST READ");
  }
  for (const endpoint of PUBLIC_API_META.endpoints.filter((route) => route.access !== "public")) {
    for (const phase of ["idle", "loading", "success", "error"]) {
      assert.equal(api.getPublicApiStatus(endpoint, { ...probe, phase }, at), "GATED / NOT PROBED");
    }
  }
  assert.equal(api.getPublicApiStatus({ name: "anotherPublicRoute", access: "public" }, probe, at), "KNOWN / NOT PROBED");
});

test("metrics validation rejects success-shaped errors, bad timestamps and invalid rows", () => {
  assert.deepEqual(api.readPublicMetricsSnapshot(payload()), { at, stale: false, cache: "hit" });
  assert.ok(api.readPublicMetricsSnapshot(payload({ data: [], total: 0 })));
  const malformed = [null, {}, "<html>SPA fallback</html>", { error: { code: "FAIL" } }];
  for (const overrides of [{ schemaVersion: 2 }, { at: NaN }, { at: -1 }, { at: Number.MAX_SAFE_INTEGER },
    { stale: "false" }, { cache: "unknown" }, { sort: "mcap" }, { limit: 15 }, { scope: "all" },
    { total: -1 }, { total: 0 }, { data: null }, { data: [null] }, { data: [{ mint: "invalid" }] },
    { data: [payload().data[0], payload().data[0]] },
    { data: [{ ...payload().data[0], vol24: Infinity }] }]) malformed.push(payload(overrides));
  malformed.forEach((body) => assert.equal(api.readPublicMetricsSnapshot(body), null));
});

test("static route docs render metadata schemas/examples exactly, with safety and units", () => {
  const h = harness(), tree = h.tree, all = nodes(tree);
  assert.equal(h.requests.length, 0, "Mount/effects must never probe automatically");
  assert.equal(all.filter((node) => node.type === "input" || node.type === "textarea" || node.type === "form").length, 0);
  assert.equal(all.find((node) => node.type === "details").props.open, undefined, "Documentation starts collapsed");
  const copy = (label) => all.find((node) => node.type === CopyBlock && node.props.label.startsWith(label)).props.value;
  assert.equal(copy("HOSTED BASE"), "https://dashboard.example/functions/");
  assert.equal(copy("EXAMPLES"), JSON.stringify(PUBLIC_API_META.examples, null, 2));
  assert.equal(copy("SCHEMAS"), JSON.stringify(PUBLIC_API_META.schemas, null, 2));
  assert.match(copy("HEADERS"), /Authorization: Bearer <operator API key>/);
  for (const node of all.filter((item) => item.type === CopyBlock)) {
    assert.equal(typeof node.props.note, "string", "CopyBlock requires an explanatory note");
  }
  for (const endpoint of PUBLIC_API_META.endpoints) {
    const row = all.find((node) => node.type === "li" && node.key === endpoint.name);
    for (const value of [endpoint.name, endpoint.methods.join(" / "), endpoint.access, endpoint.rateLimit.scope,
      `${endpoint.rateLimit.limit} requests / ${endpoint.rateLimit.windowSeconds}s`]) assert.ok(text(row).includes(value));
    assert.match(text(row), endpoint.access === "public" ? /KNOWN \/ NOT PROBED/ : /GATED \/ NOT PROBED/);
  }
  const content = text(tree);
  for (const term of ["SYNTHETIC EXAMPLES ONLY", "USD", "percent", "epoch milliseconds", "expiresAt", "300000ms",
    "momentum proxy", "not measured statistical volatility", "$100,000", "$25,000", "10–100%", "disabled by default",
    "per-isolate", "not global quotas", "1,800s", "Cache-Control: no-store", "not a rate limit", "LAST CHECKED :: NEVER"]) {
    assert.ok(content.includes(term), `Missing documentation: ${term}`);
  }
  h.unmount();
});

test("manual check makes only the public read, prevents overlap and tracks last check", async () => {
  let resolve;
  const h = harness(() => new Promise((done) => { resolve = done; }));
  const first = h.check();
  await h.check(); // Repeated click before React has rendered disabled state.
  h.render();
  assert.equal(h.button().props.disabled, true);
  assert.match(text(h.tree), /CHECKING PUBLIC READ/);
  assert.equal(h.requests.length, 1);
  const { url, options } = h.requests[0];
  assert.equal(url, "https://dashboard.example/functions/getPublicMetrics");
  assert.equal(options.method, "POST");
  assert.deepEqual(JSON.parse(options.body), { sort: "change24h", limit: 1 });
  assert.deepEqual(Object.entries(options.headers), [["Content-Type", "application/json"]]);
  assert.equal(options.mode, "same-origin");
  assert.equal(options.credentials, "omit");
  assert.equal(options.redirect, "error");
  assert.equal(options.cache, "no-store");
  assert.equal(options.signal.aborted, false);
  resolve(response()); await first; h.render();
  assert.equal(h.button().props.disabled, false);
  assert.match(text(h.tree), /READ OK \/ LAST CHECK/);
  assert.match(text(h.tree), /SOURCE at :: 2027-/);
  assert.equal(h.probe.checkedAt, at + 500);
  assert.equal(h.probe.snapshot.at, at, "Source at must not be browser request time");
  assert.ok(![...h.timers.values()].some((timer) => timer.delay === api.PUBLIC_PROBE_TIMEOUT_MS));
  const second = h.check(); resolve(response(payload({ stale: true, cache: "stale" }))); await second; h.render();
  assert.match(text(h.tree), /STALE \/ LAST READ/);
  assert.equal(h.requests.length, 2);
  h.unmount(); assert.equal(h.timers.size, 0);
});

test("snapshot ages to stale without further requests and cleans up expiry timers", async () => {
  const h = harness(); await h.check(); h.render();
  h.setTime(at + api.PUBLIC_SNAPSHOT_TTL_MS + 1);
  h.fireTimer(api.PUBLIC_SNAPSHOT_TTL_MS - 500 + 1); h.render();
  assert.match(text(h.tree), /STALE \/ LAST READ/);
  assert.equal(h.requests.length, 1);
  h.unmount(); assert.equal(h.timers.size, 0);
});

test("HTTP errors, invalid JSON and invalid envelopes never fabricate availability", async () => {
  for (const fail of [async () => ({ ok: false, status: 503 }), async () => response({ ok: true }),
    async () => ({ ok: true, json: async () => { throw new Error("DO_NOT_DISPLAY_PROVIDER_DETAILS"); } }),
    async () => { throw new Error("DO_NOT_DISPLAY_PROVIDER_DETAILS"); }]) {
    let attempt = 0;
    const h = harness((...args) => attempt++ === 0 ? response() : fail(...args));
    await h.check(); h.render(); await h.check(); h.render();
    assert.equal(h.probe.phase, "error");
    assert.match(text(h.tree), /ERROR \/ LAST CHECK/);
    assert.match(text(h.tree), /LAST SUCCESSFUL READ/);
    assert.doesNotMatch(text(h.tree), /READ OK|DO_NOT_DISPLAY_PROVIDER_DETAILS/);
    assert.equal((text(h.tree).match(/GATED \/ NOT PROBED/g) ?? []).length, 2);
    h.unmount(); assert.equal(h.timers.size, 0);
  }
});

test("timeout aborts a pending public read, clears the timer and permits retry", async () => {
  const h = harness((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }));
  const first = h.check(); h.fireTimer(api.PUBLIC_PROBE_TIMEOUT_MS); await first; h.render();
  assert.equal(h.requests[0].options.signal.aborted, true);
  assert.match(text(h.tree), /timed out after 8s/);
  assert.equal(h.button().props.disabled, false);
  assert.equal(h.timers.size, 0);
  const retry = h.check(); h.fireTimer(api.PUBLIC_PROBE_TIMEOUT_MS); await retry;
  assert.equal(h.requests.length, 2);
  h.unmount();
});

test("cleanup ignores late completion and StrictMode replay cannot overwrite a new check", async () => {
  const pending = [];
  const h = harness(() => new Promise((resolve) => pending.push(resolve)));
  const old = h.check();
  h.replayEffects();
  assert.equal(h.requests[0].options.signal.aborted, true);
  const current = h.check();
  pending[0](response()); await old;
  assert.equal(h.probe.phase, "loading");
  assert.equal(h.probe.checkedAt, null);
  pending[1](response()); await current; h.render();
  const late = h.check(); h.unmount();
  const writes = h.writes;
  assert.equal(h.requests[2].options.signal.aborted, true);
  assert.equal(h.timers.size, 0);
  pending[2](response()); await late;
  assert.equal(h.writes, writes, "Unmounted requests must not set state");
});

test("AgentConnectSection mounts one API dashboard while retaining MCP blocks", () => {
  const source = readFileSync(new URL("../src/components/otc/AgentConnectSection.jsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("AgentConnectSection.jsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  assert.equal(ast.statements.filter((node) => ts.isImportDeclaration(node)
    && node.moduleSpecifier.text === "@/components/otc/ApiAgentPanel").length, 1);
  const tags = [];
  const visit = (node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) tags.push(node.tagName.getText(ast));
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(tags.filter((tag) => tag === "ApiAgentPanel").length, 1);
  assert.equal(tags.filter((tag) => tag === "McpApiExamples").length, 1);
  assert.equal(tags.filter((tag) => tag === "CopyBlock").length, 2);
  assert.match(source, /value=\{MCP_URL\}/);
  assert.match(source, /value=\{AGENT_PROMPT\}/);
});