import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import React from "react";
import ts from "typescript";
import * as format from "../src/lib/format.js";
import * as rewardIcons from "../src/lib/rewardIcons.js";
import { createLauncherLiveHandler } from "../base44/functions/getLauncherLive/handler.js";

function compileJsx(relPath) {
  return ts.transpileModule(readFileSync(new URL(relPath, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
}
// Real JSX for the panel plus its two nested payout components: the harness
// renders all three so payout content (Stonk payout card, tape-row badge) is
// genuinely reachable instead of stopping at a placeholder tag.
const compiledAnalytics = compileJsx("../src/components/otc/LauncherAnalytics.jsx");
const compiledRewardSection = compileJsx("../src/components/otc/RewardPayoutSection.jsx");
const compiledRowPayout = compileJsx("../src/components/otc/RowPayout.jsx");

function evalJsx(compiledSrc, requireFn) {
  const mod = { exports: {} };
  runInNewContext(compiledSrc, { module: mod, exports: mod.exports, URL, require: requireFn });
  return mod.exports;
}

const PagerStub = (props) => null;

// Exercise real JSX, state setters and rendered props without DOM/network. Radix
// and effects are stubbed: focus trapping/ESC/portal behavior still needs hosted QA.
//
// Hook-slot order below MUST mirror LauncherAnalytics' own top-to-bottom
// useState/useRef call order exactly (data, err, kpi, status, payout, venue,
// search, detailMint, detailTrigger, panelRef, timeframe, filtersOpen, page,
// pageSize, prevOrderRef, flash) — the harness seeds only the slots a test
// needs to override and lets the component's own initial values fill the rest.
function harness(rows, kpi = "change24h", options = {}) {
  const seed = [];
  seed[2] = kpi;
  seed[3] = options.status ?? "ALL";
  seed[4] = options.payout ?? "ALL";
  seed[5] = options.venue ?? "ALL";
  seed[6] = options.search ?? "";
  if (options.timeframe !== undefined) seed[10] = options.timeframe;
  if (options.filtersOpen !== undefined) seed[11] = options.filtersOpen;
  if (options.page !== undefined) seed[12] = options.page;
  const state = new Map([["root", seed]]);
  let active = state.get("root"), cursor = 0, props = options.props, lastParams = null;
  const useState = (initial) => {
    const slots = active, index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
  };
  const reactShim = {
    __esModule: true, default: React,
    useState, useRef: (initial) => useState({ current: initial })[0], useId: () => "token-details-test",
    useMemo: (fn) => fn(), useEffect: () => {},
  };
  const rewardSectionModule = evalJsx(compiledRewardSection, (name) => {
    if (name === "react") return reactShim;
    if (name === "@/lib/rewardIcons") return rewardIcons;
    assert.fail(`Unexpected import in RewardPayoutSection: ${name}`);
  });
  const rowPayoutModule = evalJsx(compiledRowPayout, (name) => {
    if (name === "react") return reactShim;
    if (name === "@/components/otc/RewardPayoutSection") return rewardSectionModule;
    assert.fail(`Unexpected import in RowPayout: ${name}`);
  });
  const module = { exports: {} };
  const modules = {
    react: reactShim,
    "lucide-react": { Twitter: "Twitter", Send: "Send", Globe: "Globe", ArrowLeftRight: "ArrowLeftRight", Check: "Check", Copy: "Copy", LineChart: "LineChart" },
    "@/components/otc/XIcon": { __esModule: true, default: "XIcon" },
    "@/components/otc/RowPayout": rowPayoutModule,
    "@/components/otc/RewardPayoutSection": rewardSectionModule,
    "@/lib/hubMint": { isOfficialHubMint: (mint) => options.officialHubMint === mint },
    "@/lib/useDexQuotes": { useDexQuotes: () => ({ quotes: options.dexQuotes ?? {}, at: options.dexAt ?? null }) },
    "@/lib/launcherGraduationConfirm": { confirmPendingGraduations: () => {} },
    "@/lib/launcherFeed": { fetchLauncherAnalyticsMirror: async () => { throw new Error("no mirror in test"); } },
    "@/components/ui/dialog": Object.fromEntries(["Dialog", "DialogContent", "DialogHeader", "DialogTitle", "DialogDescription"].map((name) => [name, name])),
    "@/api/base44Client": { base44: {} },
    "@/lib/format": format,
    "@/lib/useLauncherLive": { useLauncherLive: (params) => {
      // Plain host objects: the component runs in a VM sandbox whose object
      // prototypes differ, which would fail host-side deepStrictEqual.
      lastParams = JSON.parse(JSON.stringify(params ?? {}));
      return { data: { ranked: rows, at: 1800000000000, ...options.feed }, error: options.error };
    } },
    "@/lib/usePumpSample": { usePumpSample: () => null },
    "@/components/otc/Pager": { __esModule: true, default: PagerStub },
  };
  runInNewContext(compiledAnalytics, {
    module, exports: module.exports, URL,
    require: (name) => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected import: ${name}`);
      return modules[name];
    },
  });
  const h = {
    render(nextRows = rows, nextProps = props) {
      rows = nextRows; props = nextProps; active = state.get("root"); cursor = 0;
      return h.tree = module.exports.default(props);
    },
    component(node, key = node.type.name) {
      if (!state.has(key)) state.set(key, []);
      active = state.get(key); cursor = 0;
      return node.type(node.props);
    },
    params: () => lastParams,
    logo: () => nodes(h.tree).find((node) => node.type === "button" && node.props["aria-haspopup"] === "dialog"),
    dialog: () => nodes(h.tree).find((node) => node.type === "Dialog"),
    details: () => h.component(nodes(h.tree).find((node) => node.type?.name === "TokenDetails")),
    // Descends one further level into the details dialog's nested Stonk
    // payout card (a separate component since the payout-UI split).
    payout: (tree) => h.component(nodes(tree ?? h.details()).find((node) => node.type?.name === "RewardPayoutSection"), "RewardPayoutSection"),
  };
  h.render(); return h;
}
const render = (rows, kpi = "change24h", options = {}) => harness(rows, kpi, options).tree;

function nodes(element) {
  if (Array.isArray(element)) return element.flatMap(nodes);
  if (!element || typeof element !== "object") return [];
  return [element, ...nodes(element.props?.children)];
}
const links = (tree, host) => nodes(tree).filter((n) => n.type === "a" && n.props.href.includes(host));
const order = (tree) => links(tree, "dexscreener.com").map((n) => n.props.href.split("/").at(-1));
const coin = (mint, change24h, extra = {}) => ({ mint, symbol: mint, change24h, vol24: 1200, mcap: 32000, ...extra });
const text = (node) => Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object"
  ? text(node.props?.children) : typeof node === "string" || typeof node === "number" ? String(node) : "";
// Quick-access status/rank buttons render `{label} ({count})` (array children)
// or a bare `{label}` (rank-only buttons); tab-role controls behind the
// Filters expander follow the same two shapes.
const findByLabel = (tree, label) => nodes(tree).find((n) => n.type === "button" &&
  (n.props.children === label || (Array.isArray(n.props.children) && n.props.children[0] === label)));
const findTab = (tree, label) => nodes(tree).find((n) => n.type === "button" && n.props.role === "tab" &&
  (n.props.children === label || (Array.isArray(n.props.children) && n.props.children[0] === label)));
const findFiltersToggle = (tree) => nodes(tree).find((n) => n.type === "button" &&
  (n.props.title === "No filters active" || n.props.title?.startsWith("Active filters")));
const openFilters = (h) => { findFiltersToggle(h.tree).props.onClick(); h.render(); };
const findTradeButtons = (tree) => nodes(tree).filter((n) => n.type === "button" && n.props["aria-label"]?.startsWith("Swap "));
// Each tape row is its own bordered grid div; scoping a query to one lets us
// read that row's own status badge/text instead of the whole flattened tree.
const rowDivs = (tree) => nodes(tree).filter((n) => n.type === "div" && n.props?.className?.includes("last:border-0"));
const rowFor = (tree, mint) => rowDivs(tree).find((row) => nodes(row).some((n) => n.props?.["aria-label"] === `Open profile for ${mint}`));

test("KPI buttons drive the server sort; rows render in server order, unmutated", () => {
  const rows = [coin("unknown", null), coin("loss", -8), coin("gain", 23)];
  const before = structuredClone(rows);
  const h = harness(rows, "change24h");
  assert.deepEqual(h.params(), { page: 1, pageSize: 25, status: "ALL", sort: "change24h" });
  assert.deepEqual(order(h.tree), ["unknown", "loss", "gain"], "Server order is authoritative, not the panel");
  assert.deepEqual(rows, before, "The panel must not mutate the feed payload");
  findByLabel(h.tree, "MCAP").props.onClick();
  h.render();
  assert.equal(h.params().sort, "mcap");
  assert.equal(h.params().page, 1, "Switching rank resets to page one");
});

test("timeframe windows and the pager drive the paged tape", () => {
  const rows = [coin("low", -99), coin("unknown", null), coin("high", -1)];
  const h = harness(rows, "vol24");
  assert.equal("maxAgeHours" in h.params(), false, "ALL timeframe ships no age window");
  assert.doesNotMatch(text(h.tree), /NaN%|Infinity%/);
  openFilters(h);
  findTab(h.tree, "24H").props.onClick(); h.render();
  assert.equal(h.params().maxAgeHours, 24);
  findTab(h.tree, "7D").props.onClick(); h.render();
  assert.equal(h.params().maxAgeHours, 168);
  assert.equal(h.params().page, 1);
  const pager = nodes(h.tree).find((n) => n.type === PagerStub);
  assert.equal(pager.props.label, "launches");
  pager.props.onPage(1); h.render();
  assert.equal(h.params().page, 2, "Pager pages are 0-based upstream, 1-based in the request");
});

test("feed rows render verbatim with honest empty, stale and locked states", () => {
  const rows = Array.from({ length: 20 }, (_, i) => coin(String(i), i));
  assert.deepEqual(order(render(rows, "vol24")), rows.map((r) => r.mint), "No client-side cap: the page renders as shipped");
  assert.deepEqual(order(render([])), []);
  assert.match(text(render([], "vol24")), /No matching launches/i);
  assert.doesNotMatch(text(render([], "vol24")), /loading/i);
  assert.match(text(render(rows, "vol24", { error: "offline", feed: { stale: true } })), /STALE/);
  const locked = render(rows, "vol24", { props: { onTrade: () => {}, tradingDisabled: true } });
  assert.ok(findTradeButtons(locked).every((n) => n.props.disabled));
});

test("Trade button selects the exact row in-app; token name/logo open details, not a Jupiter redirect", () => {
  const mints = ["So11111111111111111111111111111111111111112", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"];
  const rows = mints.map((mint) => coin(mint, 1)), selected = [];
  const h = harness(rows, "vol24", { props: { onTrade: (row) => selected.push(row) } });
  const trades = findTradeButtons(h.tree);
  assert.equal(trades.length, mints.length);
  trades.forEach(({ props }, i) => {
    assert.equal(props.disabled, false);
    props.onClick({ stopPropagation() {} });
    assert.equal(selected[i], rows[i]);
  });
  assert.equal(links(h.tree, "jup.ag").length, 0);
  const nameButtons = nodes(h.tree).filter((n) => n.type === "button" && n.props["aria-label"]?.startsWith("Open profile for"));
  assert.equal(nameButtons.length, mints.length);
  nameButtons[0].props.onClick({ stopPropagation() {} });
  h.render();
  assert.equal(h.dialog().props.open, true, "Name button opens details");
  assert.equal(selected.length, mints.length, "Opening details does not call onTrade");
  // The mint copy control only lives inside the opened token details dialog.
  const copy = nodes(h.details()).find((n) => typeof n.type === "function" && n.type.name === "CopyCa");
  assert.equal(copy.props.mint, mints[0]);
});

test("status tabs drive the server status filter; rows keep their own status labels", () => {
  const rows = [coin("grad", -5, { status: "GRADUATED" }), coin("bond", 6, { status: "BONDING" }),
    coin("near", 9, { status: "ABOUT_TO_GRADUATE", curveComplete: true }), coin("unknown", 99)];
  for (const status of ["GRADUATED", "BONDING", "ABOUT_TO_GRADUATE", "UNKNOWN"]) {
    // The full status tab list only renders once the Filters tray is expanded.
    const h = harness(rows, "change24h", { status, filtersOpen: true });
    assert.equal(h.params().status, status);
    assert.deepEqual(order(h.tree), ["grad", "bond", "near", "unknown"], "Filtering happens server-side");
    const tabs = nodes(h.tree).filter((n) => n.type === "button" && n.props.role === "tab"
      && n.props.children?.[0] === status);
    assert.equal(tabs.length, 1);
    assert.equal(tabs[0].props["aria-selected"], true);
  }
  const all = render(rows, "change24h");
  // Dense rows show a compact status chip (STATUS_SHORT) rather than the full name.
  assert.match(text(rowFor(all, "grad")), /GRAD/);
  assert.match(text(rowFor(all, "bond")), /BOND/);
  assert.match(text(rowFor(all, "near")), /NEAR/);
  assert.match(text(rowFor(all, "unknown")), /UNK/);
});

test("ABOUT_TO_GRADUATE ranks by curve progress; PROGRESS is a server sort", () => {
  const rows = [coin("slow", 1, { curveProgress: 91 }), coin("fast", 2, { curveProgress: 98.5 })];
  const h = harness(rows, "vol24");
  assert.equal(h.params().sort, "vol24");
  openFilters(h);
  const tab = findTab(h.tree, "ABOUT_TO_GRADUATE");
  tab.props.onClick(); h.render();
  assert.equal(h.params().status, "ABOUT_TO_GRADUATE");
  assert.equal(h.params().sort, "curveProgress", "Near-graduation view sorts by progress");
  const progressBtn = findByLabel(h.tree, "Progress");
  assert.ok(progressBtn, "Progress rank button exists");
  progressBtn.props.onClick(); h.render();
  assert.equal(h.params().sort, "curveProgress");
  assert.equal(h.params().page, 1, "Switching rank resets to page one");
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

test("search reaches the full tape server-side and honest states persist", () => {
  const rows = Array.from({ length: 30 }, (_, i) => coin(`mint${i}`, i));
  const searched = harness(rows, "vol24", { search: "Mint29 " });
  assert.equal(searched.params().search, "mint29", "Search is trimmed and lowercased server-side");
  assert.deepEqual(order(searched.tree), rows.map((r) => r.mint), "Search filtering happens server-side");
  assert.deepEqual(order(render([coin("a", 1), coin("b", 2)])), ["a", "b"]);
  assert.deepEqual(order(render([coin("a", 3), coin("b", 2)])), ["a", "b"]);
});

test("market cap and volume use fmtUsdCompact and price change is signed", () => {
  const text = nodes(render([coin("a", -1.25)])).flatMap((n) => React.Children.toArray(n.props?.children))
    .filter((n) => typeof n === "string").join(" ");
  assert.ok(text.includes(format.fmtUsdCompact(32000)));
  assert.ok(text.includes(format.fmtUsdCompact(1200)));
  assert.ok(text.includes("-1.3"));
});

test("malformed momentum stays unknown in row rendering", () => {
  const rows = [coin("nan", NaN), coin("infinity", Infinity), coin("string", "30"), coin("loss", -2)];
  const tree = render(rows);
  assert.doesNotMatch(text(tree), /NaN%|Infinity%|30\.0%/);
  assert.match(text(tree), /-2\.0%/);
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

const OTC = "MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump";
const SOL = "So11111111111111111111111111111111111111112";
const openDetails = (h, target = { isConnected: true, focus() {} }) => {
  let stopped = false;
  h.logo().props.onClick({ currentTarget: target, stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
  h.render();
  assert.equal(h.dialog().props.open, true);
};

test("actual live API metadata maps into lazy thumbnails, original assets, socials and Stonk payouts", async () => {
  const source = { mint: OTC, name: "OTC Basket", symbol: "OTCxSOL", image: "https://assets.example/original.png",
    socials: { twitter: "https://x.com/otc", telegram: "https://t.me/otc", website: "https://otc.example/" },
    rewardMint: OTC, rewardSymbol: "OTC", rewardCycle: 0, rewardBasket: [OTC, SOL, OTC],
    snapshot: { volume24h: 2345, marketCap: 56000, change24h: -3.25, at: 1_800_000_000_000 } };
  const handler = createLauncherLiveHandler({ clock: () => 1_800_000_000_000,
    deriveCurveAddress: () => "curve", rpc: async () => ({ value: [null] }),
    fetchImpl: async (url) => Response.json(url === "https://otcdesks.cash/api/coins" ? [source] : { pairs: [] }),
  });
  const { ranked } = await (await handler(new Request("https://example.test/getLauncherLive"))).json();
  const h = harness(ranked);
  assert.equal(h.dialog().props.open, false);
  const thumbnail = h.component(h.logo().props.children, "thumbnail");
  const small = nodes(thumbnail).find((n) => n.type === "img");
  assert.equal(small.props.src, source.image);
  assert.equal(small.props.loading, "lazy");
  assert.equal(small.props.width, 32);
  assert.match(small.props.alt, /OTC Basket logo/);
  openDetails(h);
  assert.equal(h.logo().props["aria-expanded"], true);
  const content = h.details();
  const largeNode = nodes(content).find((n) => n.type?.name === "TokenAsset");
  const large = nodes(h.component(largeNode, "large")).find((n) => n.type === "img");
  assert.equal(large.props.src, source.image, "Use original URL, not a thumbnail rewrite");
  assert.equal(large.props.loading, "eager");
  assert.equal(large.props.width, 224);
  assert.equal(large.props.referrerPolicy, "no-referrer");
  assert.match(large.props.className, /object-contain/);
  const socialLinks = nodes(content).filter((n) => n.type === "a" && n.props["aria-label"]);
  assert.deepEqual(socialLinks.map((n) => n.props.href), Object.values(source.socials));
  assert.deepEqual(socialLinks.map((n) => n.props["aria-label"]), ["X", "Telegram", "Website"]);
  assert.ok(socialLinks.every((n) => n.props.target === "_blank" && n.props.rel === "noopener noreferrer"));
  assert.ok(nodes(content).some((n) => n.type === "XIcon"));
  assert.ok(nodes(content).some((n) => n.type === "Send"));
  assert.ok(nodes(content).some((n) => n.type === "Globe"));
  // Payout content lives in a real nested component (RewardPayoutSection);
  // it must be actually invoked to see its rendered text, not just walked
  // as an opaque element.
  const payoutTree = h.payout(content);
  // The source rewardBasket [OTC, SOL, OTC] is de-duplicated to [OTC, SOL] upstream.
  assert.match(text(payoutTree), /Stonk payout.*\$OTC.*reported.*Basket · 2 tokens/);
  assert.match(text(content), /Assets and links are third-party metadata, not endorsements\. Verify payout mints and launch terms before trading\./);
  assert.deepEqual(links(payoutTree, "solscan.io").map((n) => n.props.href.split("/").at(-1)), [OTC, OTC, SOL]);
  assert.match(text(content), /Vol 24h.*\$2\.35K.*24h.*-3\.3%.*Mcap.*\$56\.00K/);
  const curve = nodes(content).find((n) => n.type?.name === "CurveProgress");
  assert.match(text(curve.type(curve.props)), /unavailable/);
});

test("logo expansion, closing and TRADE retain separate state and work while swap selection is locked", () => {
  const rows = [coin(OTC, 1), coin(SOL, 2)], selected = [];
  const h = harness(rows, "vol24", { props: { onTrade: (t) => selected.push(t), selectedMint: SOL } });
  let focused = 0, prevented = 0;
  openDetails(h, { isConnected: true, focus() { focused++; } });
  assert.equal(selected.length, 0, "Logo never calls onTrade");
  assert.ok(nodes(h.tree).some((n) => n.props?.["data-selected"] === true), "Swap selection retained");
  findTradeButtons(h.tree)[1].props.onClick({ stopPropagation() {} });
  h.render();
  assert.equal(selected[0], rows[1]);
  assert.match(text(h.details()), /\$.*MukLD/);
  assert.equal(h.dialog().props.open, true, "Trade does not change details selection");
  const dialogContent = nodes(h.tree).find((n) => n.type === "DialogContent");
  h.dialog().props.onOpenChange(false); h.render();
  dialogContent.props.onCloseAutoFocus({ preventDefault() { prevented++; } });
  assert.equal(h.dialog().props.open, false);
  assert.equal(focused, 1); assert.equal(prevented, 1);
  // Opening a profile is a separate action from swap selection; it must
  // never itself push to onTrade.
  nodes(h.tree).find((n) => n.props?.["aria-label"]?.startsWith("Open profile for")).props.onClick({ stopPropagation() {} });
  h.render();
  assert.equal(h.dialog().props.open, true, "Name button opens details, not swap");
  assert.equal(selected.length, 1, "Opening details does not call onTrade");
  const locked = harness(rows, "vol24", { props: { onTrade: () => assert.fail("Locked swap invoked"), tradingDisabled: true } });
  assert.ok(findTradeButtons(locked.tree).every((n) => n.props.disabled));
  assert.ok(!locked.logo().props.disabled);
  openDetails(locked);
  assert.match(text(locked.payout()), /Stonk payout/);
});

test("open details follow fresh rows by mint across ranking/filter changes, and surface stale/removal states", () => {
  const rows = [coin(OTC, 1, { curveProgress: 20 }), coin(SOL, 2)];
  const h = harness(rows, "vol24");
  const target = { isConnected: true, focus() { assert.fail("Detached logo focused"); } };
  openDetails(h, target);
  nodes(h.tree).find((n) => n.type === "input").props.onChange({ target: { value: SOL } });
  h.render();
  assert.equal(h.params().search, SOL.toLowerCase());
  h.render([rows[1], { ...rows[0], vol24: 9000, curveProgress: 91.25, status: "ABOUT_TO_GRADUATE" }]);
  assert.deepEqual(order(h.tree), [SOL, OTC], "Filtering is server-side; the shipped page renders verbatim");
  assert.match(text(h.details()), /ABOUT_TO_GRADUATE.*\$9\.00K/);
  const curve = nodes(h.details()).find((n) => n.type?.name === "CurveProgress");
  assert.equal(nodes(curve.type(curve.props)).find((n) => n.props?.role === "progressbar").props["aria-valuenow"], 91.25);
  h.render([]);
  assert.match(text(h.tree), /no longer in the latest launcher feed/);
  assert.equal(h.dialog().props.open, true);
  let focused = false;
  target.isConnected = false;
  nodes(h.tree).find((n) => n.props?.tabIndex === -1).ref.current = { focus() { focused = true; } };
  nodes(h.tree).find((n) => n.type === "DialogContent").props.onCloseAutoFocus({ preventDefault() {} });
  assert.equal(focused, true, "Removed trigger falls back to stable analytics panel");
  const stale = harness(rows, "vol24", { feed: { stale: true } }); openDetails(stale);
  assert.match(text(stale.tree), /Stale · showing the last available token snapshot/);
});

test("missing/unsafe metadata renders honest fallbacks; broken images recover after URL changes", () => {
  const row = coin(OTC, null, { image: "https://assets.example/legacy.png", logoUrl: "javascript:alert(1)",
    socials: { twitter: "javascript:alert(1)", telegram: "//example.test", website: "data:text/html,invalid" } });
  const h = harness([row]);
  let asset = h.component(h.logo().props.children, "thumbnail");
  assert.equal(nodes(asset).find((n) => n.type === "img").props.src, row.image, "Legacy image fallback");
  nodes(asset).find((n) => n.type === "img").props.onError();
  asset = h.component(h.logo().props.children, "thumbnail");
  assert.equal(nodes(asset).some((n) => n.type === "img"), false);
  assert.match(nodes(asset).find((n) => n.props?.role === "img").props["aria-label"], /image unavailable/);
  h.render([{ ...row, logoUrl: "https://assets.example/new.png" }]);
  asset = h.component(h.logo().props.children, "thumbnail");
  assert.equal(nodes(asset).find((n) => n.type === "img").props.src, "https://assets.example/new.png");
  openDetails(h);
  assert.match(text(h.details()), /Social links unavailable/);
  assert.match(text(h.payout()), /Payout metadata unavailable/);
  assert.match(text(h.details()), /24h—/);
  assert.equal(nodes(h.details()).filter((n) => n.type === "a" && n.props["aria-label"]).length, 0);
  for (const value of [null, "data:image/svg+xml,invalid", "ftp://example.test/x", "https://user:pass@example.test/x"]) {
    h.render([{ ...row, logoUrl: value, image: value }]);
    assert.equal(nodes(h.component(h.logo().props.children, "thumbnail")).some((n) => n.type === "img"), false);
  }
});

test("detail layout is width/height bounded on mobile and preserves incoming dashboard disclaimer", () => {
  const h = harness([coin(OTC, 1)]); openDetails(h);
  const content = nodes(h.tree).find((n) => n.type === "DialogContent");
  assert.match(content.props.className, /max-h-\[90dvh\].*w-\[calc\(100%-2rem\)\].*overflow-y-auto/);
  assert.equal(content.props.id, h.logo().props["aria-controls"]);
  assert.ok(nodes(h.details()).some((n) => n.props?.className?.includes("sm:grid-cols-")));
  assert.match(text(h.tree), /Not affiliated with the launches shown · DYOR/);
});

test("partial payout metadata does not invent a basket, mint, split or schedule", () => {
  for (const payoutInfo of [
    { rewardMint: OTC, rewardSymbol: "OTC", rewardBasket: [], rewardCycle: null },
    { rewardMint: null, rewardSymbol: null, rewardBasket: [OTC, SOL], rewardCycle: null },
    { rewardMint: null, rewardSymbol: "REPORTED", rewardBasket: [], rewardCycle: 0 },
  ]) {
    const h = harness([coin(OTC, 0, { payoutInfo })]); openDetails(h);
    const detail = h.details(), payoutTree = h.payout(detail);
    assert.equal(links(payoutTree, "solscan.io").length, payoutInfo.rewardBasket.length + Number(!!payoutInfo.rewardMint));
    assert.equal(text(payoutTree).includes("Basket ·"), payoutInfo.rewardBasket.length > 1);
    assert.match(text(detail), /Assets and links are third-party metadata, not endorsements\. Verify payout mints and launch terms before trading\./);
    assert.doesNotMatch(text(payoutTree), /equal split|every \d+|50%|No rewards/i);
  }
});