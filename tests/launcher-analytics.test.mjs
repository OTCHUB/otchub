import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import React from "react";
import ts from "typescript";
import * as format from "../src/lib/format.js";

const componentPath = new URL("../src/components/otc/LauncherAnalytics.jsx", import.meta.url);
const compiled = ts.transpileModule(readFileSync(componentPath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;

// Exercise the actual component's useMemo and rendered link props without a
// browser or network. Effects are disabled; this is not a lifecycle/E2E test.
function render(rows, kpi = "change24h", options = {}) {
  const states = [{ ranked: rows, feeModel: [] }, null, kpi, options.status ?? "ALL", options.search ?? ""];
  const module = { exports: {} };
  const modules = {
    react: {
      __esModule: true, default: React,
      useState: () => [states.shift(), () => {}],
      useMemo: (fn) => fn(), useEffect: () => {},
    },
    "@/api/base44Client": { base44: {} },
    "@/lib/format": format,
    "@/lib/useLauncherLive": { useLauncherLive: () => ({ data: { ranked: rows, at: 1800000000000, ...options.feed }, error: options.error }) },
    "@/lib/usePumpSample": { usePumpSample: () => null },
  };
  runInNewContext(compiled, {
    module, exports: module.exports,
    require: (name) => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected import: ${name}`);
      return modules[name];
    },
  });
  return module.exports.default(options.props);
}

function nodes(element) {
  if (Array.isArray(element)) return element.flatMap(nodes);
  if (!element || typeof element !== "object") return [];
  return [element, ...nodes(element.props?.children)];
}
const links = (tree, host) => nodes(tree).filter((n) => n.type === "a" && n.props.href.includes(host));
const order = (tree) => links(tree, "dexscreener.com").map((n) => n.props.href.split("/").at(-1));
const coin = (mint, change24h, extra = {}) => ({ mint, symbol: mint, change24h, vol24: 1200, mcap: 32000, ...extra });

test("TOP_GAINERS ranks unknown changes below losses and preserves unknown ties", () => {
  const rows = [coin("unknown", null), coin("loss", -8), coin("missing", undefined), coin("gain", 23), coin("flat", 0)];
  const before = structuredClone(rows);
  assert.deepEqual(order(render(rows)), ["gain", "flat", "loss", "unknown", "missing"]);
  assert.deepEqual(rows, before, "Sorting must not mutate the cached payload");
});

test("all-negative and all-unknown rankings remain stable", () => {
  assert.deepEqual(order(render([coin("low", -99), coin("unknown", null), coin("high", -1)])), ["high", "low", "unknown"]);
  assert.deepEqual(order(render([coin("first", null), coin("second", null)])), ["first", "second"]);
});

test("other KPIs retain descending order and the feed is capped at 15", () => {
  for (const kpi of ["vol24", "mcap"]) {
    const rows = [coin("empty", 100, { [kpi]: null }), coin("small", -1, { [kpi]: 5 }), coin("large", 0, { [kpi]: 9 })];
    assert.deepEqual(order(render(rows, kpi)), ["large", "small", "empty"]);
  }
  const rows = Array.from({ length: 20 }, (_, i) => coin(String(i), i));
  assert.deepEqual(order(render(rows)), Array.from({ length: 15 }, (_, i) => String(19 - i)));
  assert.deepEqual(order(render([])), []);
});

test("Trade and token-name buttons select the exact row in-app, not a Jupiter redirect", () => {
  const mints = ["So11111111111111111111111111111111111111112", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"];
  const rows = mints.map((mint) => coin(mint, 1)), selected = [];
  const tree = render(rows, "vol24", { props: { onTrade: (row) => selected.push(row) } });
  const trades = nodes(tree).filter((n) => n.type === "button" && n.props.children === "[⇄ TRADE]");
  assert.equal(trades.length, mints.length);
  trades.forEach(({ props }, i) => {
    assert.equal(props.disabled, false);
    props.onClick();
    assert.equal(selected[i], rows[i]);
  });
  assert.equal(links(tree, "jup.ag").length, 0);
  const nameButtons = nodes(tree).filter((n) => n.type === "button" && n.props.title?.endsWith("select for in-app swap"));
  nameButtons[0].props.onClick();
  assert.equal(selected.at(-1), rows[0]);
  const copies = nodes(tree).filter((n) => typeof n.type === "function" && n.type.name === "CopyCa");
  assert.deepEqual(copies.map((n) => n.props.mint), mints);
});

const text = (node) => Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object"
  ? text(node.props?.children) : typeof node === "string" || typeof node === "number" ? String(node) : "";

test("status tabs filter before ranking; unknown and completed-pending are not graduated", () => {
  const rows = [coin("grad", -5, { status: "GRADUATED" }), coin("bond", 6, { status: "BONDING" }),
    coin("near", 9, { status: "ABOUT_TO_GRADUATE", curveComplete: true }), coin("unknown", 99)];
  for (const [status, expected] of [["GRADUATED", "grad"], ["BONDING", "bond"], ["ABOUT_TO_GRADUATE", "near"], ["UNKNOWN", "unknown"]]) {
    const tree = render(rows, "change24h", { status });
    assert.deepEqual(order(tree), [expected]);
    const tabs = nodes(tree).filter((n) => n.props?.role === "tab");
    assert.equal(tabs.filter((n) => n.props["aria-selected"]).length, 1);
    assert.ok(text(tabs.find((n) => n.props["aria-selected"])).startsWith(status));
  }
});

test("curve progress replaces row fees with real zero, bounded percentage or unknown", () => {
  const rows = [coin("zero", 0, { curveProgress: 0 }), coin("near", 0, { curveProgress: 91.25 }),
    coin("missing", 0), coin("pending", 0, { curveProgress: 100, curveComplete: true })];
  const tree = render(rows);
  assert.equal(nodes(tree).filter((n) => n.type?.name === "SplitBar").length, 0);
  const progress = nodes(tree).filter((n) => n.type?.name === "CurveProgress")
    .map((n) => nodes(n.type(n.props)).find((child) => child.props?.role === "progressbar"));
  assert.deepEqual(progress.map((n) => n.props["aria-valuenow"]), [0, 91.25, undefined, 100]);
  assert.match(progress[2].props["aria-valuetext"], /unavailable/);
  assert.match(progress[3].props["aria-valuetext"], /migration pending/);
});

test("fresh snapshots re-rank, search reaches outside top15, empty/stale states are honest", () => {
  const rows = Array.from({ length: 30 }, (_, i) => coin(`mint${i}`, i));
  assert.deepEqual(order(render(rows, "vol24", { search: "mint29" })), ["mint29"]);
  assert.deepEqual(order(render([coin("a", 1), coin("b", 2)])), ["b", "a"]);
  assert.deepEqual(order(render([coin("a", 3), coin("b", 2)])), ["a", "b"]);
  assert.match(text(render([], "vol24")), /NO MATCHING LAUNCHES/);
  assert.doesNotMatch(text(render([], "vol24")), /LOADING/);
  assert.match(text(render(rows, "vol24", { error: "offline", feed: { stale: true } })), /STALE/);
  const locked = render(rows, "vol24", { props: { onTrade: () => {}, tradingDisabled: true } });
  assert.ok(nodes(locked).filter((n) => n.type === "button" && n.props.children === "[⇄ TRADE]").every((n) => n.props.disabled));
});

test("market cap and volume use fmtUsd and price change is signed", () => {
  const text = nodes(render([coin("a", -1.25)])).flatMap((n) => React.Children.toArray(n.props?.children))
    .filter((n) => typeof n === "string").join(" ");
  assert.ok(text.includes(format.fmtUsd(32000)));
  assert.ok(text.includes(format.fmtUsd(1200)));
  assert.ok(text.includes("-1.3"));
});

test("Home imports and mounts exactly one LauncherAnalytics panel", () => {
  const source = readFileSync(new URL("../src/pages/Home.jsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("Home.jsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  const imports = ast.statements.filter((s) => ts.isImportDeclaration(s)
    && s.moduleSpecifier.text === "@/components/otc/LauncherAnalytics");
  assert.equal(imports.length, 1);
  assert.equal(imports[0].importClause.name.text, "LauncherAnalytics");
  let mounted = 0;
  const walk = (node) => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(ast) === "LauncherAnalytics") mounted++;
    ts.forEachChild(node, walk);
  };
  walk(ast);
  assert.equal(mounted, 1);
});