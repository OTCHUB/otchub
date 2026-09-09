// RETRO terminal chrome wraps short labels in square brackets ("[ TRADE ]",
// "[RESCAN_LIVE]", "[OTC_APP ↗]") — hard-coded as literal JSX strings across
// dozens of components. The MODERN skin drops the brackets for a cleaner
// glass look: instead of rewriting every string (and every future one),
// this pass rewrites bracket-only text nodes while the modern skin is
// active, and keeps watching because polls and feed refreshes re-render
// rows with fresh bracketed labels.
//
// Safety: only text nodes whose ENTIRE content is a single bracketed label
// (or a lone "[" / "]" fragment JSX emits around expressions) are touched —
// data, mints, prose and partial labels are never modified. Originals are
// kept in a WeakMap and restored when the user switches back to RETRO, so
// the retro skin keeps its exact terminal chrome.
import { THEME_CHANGE_EVENT } from "@/lib/theme";

const BRACKETED = /^\s*\[[^\[\]\n]{1,60}\]\s*$/;
const FRAGMENT = /^\s*[\[\]]\s*$/;
const originals = new WeakMap();

function strip(node) {
  const raw = node.nodeValue;
  if (!BRACKETED.test(raw) && !FRAGMENT.test(raw)) return;
  const stripped = FRAGMENT.test(raw)
    ? raw.replace(/[\[\]]/g, "")
    : raw.replace(/^\s*\[\s*/, "").replace(/\s*\]\s*$/, "");
  if (stripped === raw) return;
  if (!originals.has(node)) originals.set(node, raw);
  node.nodeValue = stripped;
}

function process(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    strip(node);
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) strip(walker.currentNode);
  }
}

export function initModernSkinChrome() {
  const isModern = () => document.documentElement.classList.contains("skin-modern");
  const restoreAll = () => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const original = originals.get(walker.currentNode);
      if (original != null) walker.currentNode.nodeValue = original;
    }
  };
  const apply = () => {
    if (isModern()) process(document.body);
    else restoreAll();
  };

  window.addEventListener(THEME_CHANGE_EVENT, apply);
  if (isModern()) apply();

  // Our own writes re-enter the observer; the bracket tests then fail, so it
  // settles without a loop. React re-rendering a node back to a bracketed
  // value simply re-triggers the strip.
  new MutationObserver((records) => {
    if (!isModern()) return;
    for (const record of records) {
      if (record.type === "characterData") strip(record.target);
      else for (const node of record.addedNodes) process(node);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
}