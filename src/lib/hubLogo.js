// $HUB token logo, resolved live from the Dexscreener token profile so the app's coin icon
// always matches what traders see on the chart page. The Dexscreener CDN URL changes on every
// profile image upload (cms/images/<id>), so a hardcoded URL rots — hence runtime resolution.
// Module-level cache (10 min TTL) means one API call per session regardless of how many icons
// render. Every consumer keeps its bundled/proxy fallbacks: a Dexscreener outage never blanks
// the icon, it just stops tracking profile changes until the next load.
import { useEffect, useState } from "react";

const HUB_MINT = "5yrUrzyDBs5NrZdiGtW1BEYUjHyHBLx1L5vTAKUxvo1V";
const API_URL = `https://api.dexscreener.com/latest/dex/tokens/${HUB_MINT}`;
const TTL_MS = 10 * 60 * 1000;

let cached = { at: 0, url: null };
let inflight = null;

export async function fetchHubLogoUrl() {
  if (cached.url && Date.now() - cached.at < TTL_MS) return cached.url;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(API_URL, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return cached.url;
      const json = await res.json();
      const pairs = Array.isArray(json?.pairs) ? json.pairs : [];
      const pair =
        pairs.find((p) => p?.baseToken?.address === HUB_MINT && p?.info?.imageUrl) ??
        pairs.find((p) => p?.info?.imageUrl);
      const url = pair?.info?.imageUrl ?? null;
      if (url) cached = { at: Date.now(), url };
      return cached.url;
    } catch {
      return cached.url; // stale-while-error
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** React hook: the live Dexscreener $HUB logo URL, or null until first resolution. */
export function useHubLogo() {
  const fresh = cached.url && Date.now() - cached.at < TTL_MS;
  const [url, setUrl] = useState(fresh ? cached.url : null);
  useEffect(() => {
    let live = true;
    void fetchHubLogoUrl().then((u) => {
      if (live && u) setUrl(u);
    });
    return () => {
      live = false;
    };
  }, []);
  return url;
}
