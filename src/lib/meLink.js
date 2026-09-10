// Magic Eden listing links: an <a target="_blank"> click can fall back to
// SAME-TAB navigation when the browser/preview blocks popups (sandboxed
// iframes, in-app webviews) — that navigates the dashboard away and replays
// the boot screen. This helper always keeps the app in place and opens the
// listing explicitly in a detached new tab.
const ME_BASE = "https://magiceden.io/item-details";

export const magicEdenUrl = (assetId) =>
  `${ME_BASE}/${encodeURIComponent(assetId || "")}`;

export const openMagicEden = (e, assetId) => {
  e?.preventDefault?.();
  e?.stopPropagation?.();
  window.open(magicEdenUrl(assetId), "_blank", "noopener,noreferrer");
};