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
function render(rows, kpi = "change24h") {
  const states = [{ ranked: rows, feeModel: [] }, null, kpi];
  const module = { exports: {} };
  const modules = {
    react: {
      __esModule: true, default: React,
      useState: () => [states.shift(), () => {}],
      useMemo: (fn) => fn(), useEffect: () => {},
    },
    "@/api/base44Client": { base44: {} },
    "@/lib/format": format,
  };
  runInNewContext(compiled, {
    module, exports: module.exports,
    require: (name) => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected import: ${name}`);
      return modules[name];
    },
  });
  return module.exports.default();
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
  for (const kpi of ["vol24", "feesEst24h", "velocity"]) {
    const rows = [coin("empty", 100, { [kpi]: null }), coin("small", -1, { [kpi]: 5 }), coin("large", 0, { [kpi]: 9 })];
    assert.deepEqual(order(render(rows, kpi)), ["large", "small", "empty"]);
  }
  const rows = Array.from({ length: 20 }, (_, i) => coin(String(i), i));
  assert.deepEqual(order(render(rows)), Array.from({ length: 15 }, (_, i) => String(19 - i)));
  assert.deepEqual(order(render([])), []);
});

test("each Trade link selects SOL input and that row's mint as Jupiter output", () => {
  const mints = ["So11111111111111111111111111111111111111112", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"];
  const tree = render(mints.map((mint) => coin(mint, 1)));
  const trades = links(tree, "jup.ag");
  assert.equal(trades.length, mints.length);
  trades.forEach(({ props }, i) => {
    const url = new URL(props.href);
    assert.equal(url.origin, "https://jup.ag");
    assert.equal(url.pathname, `/swap/SOL-${mints[i]}`);
    assert.equal(props.target, "_blank");
    assert.match(props.rel, /noreferrer/);
    assert.match(props.children, /TRADE/);
  });
  const copies = nodes(tree).filter((n) => typeof n.type === "function" && n.type.name === "CopyCa");
  assert.deepEqual(copies.map((n) => n.props.mint), mints);
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