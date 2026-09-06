/* getLauncherAnalytics — aggregates the OTC launcher ecosystem into one cached
   payload for the OTC_ANALYTICS panel.
   Sources:
     - otcdesks.cash/api/coins     launch feed + per-coin snapshots (public)
     - api.dexscreener.com         graduation detection (bonding = pumpfun pair
                                   only; graduated = pumpswap/raydium/meteora),
                                   batched 30 mints/call on the top-200 by vol;
                                   plus a native pump.fun field SAMPLE via
                                   search (labeled: biased to active pairs)
   Fee split is the launcher protocol model (70/10/15/5). Per-coin fees are
   ESTIMATES: 24h volume × 1% bonding-curve fee. No entity reads — the 5-min
   per-isolate cache + stale-on-error fallback reduces upstream API requests;
   it is not a cross-instance rate limiter. */

const COINS_URL = "https://otcdesks.cash/api/coins";
const DEX = "https://api.dexscreener.com/latest/dex";
const FEE_MODEL = [
  { key: "holders", label: "HOLDERS", pct: 70 },
  { key: "desk_pot", label: "DESK POT", pct: 10 },
  { key: "protocol", label: "PROTOCOL", pct: 15 },
  { key: "buybacks", label: "OTC BUYBACKS", pct: 5 },
];
const CURVE_FEE = 0.01;          // pump.fun-style bonding curve fee
const GRAD_SAMPLE = 200;         // graduation check: top-N by 24h volume
const RANK_POOL = 60;            // coins shipped to the client (it re-sorts)

const FRESH_MS = 5 * 60_000, STALE_MS = 30 * 60_000;
let mem = { at: 0, body: null };
let inflight = null;

const j = (o, cache) => Response.json(o, { headers: { "X-Launcher-Cache": cache } });

async function fetchJson(url, timeoutMs = 9000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

const median = (xs) => {
  const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : null;
};

async function build() {
  const now = Date.now() / 1000;
  const raw = await fetchJson(COINS_URL, 15_000);
  const coins = (Array.isArray(raw) ? raw : raw.coins || raw.data || raw.tokens || [])
    .filter((c) => c?.mint && c?.symbol);

  const view = coins.map((c) => {
    const ageH = Math.max((now - (c.createdAt || now)) / 3600, 0.01);
    const vol24 = c.snapshot?.volume24h ?? 0;
    const mcap = c.snapshot?.marketCap ?? 0;
    return {
      mint: c.mint, symbol: c.symbol, name: c.name || "", image: c.image || "",
      createdAt: c.createdAt || null, ageH: +ageH.toFixed(2),
      vol24, mcap, liquidity: c.snapshot?.liquidity ?? null,
      holders: c.snapshot?.holders ?? null, change24h: c.snapshot?.change24h ?? null,
      rewardSymbol: c.rewardSymbol || null,
      feesEst24h: +(vol24 * CURVE_FEE).toFixed(2),
      velocity: +(mcap / ageH).toFixed(2),   // $ mcap per hour since launch
      graduated: null, pairUrl: null,        // filled for the checked sample
    };
  });

  // graduation detection on the top-N by 24h volume (batched 30 mints/call)
  const sample = [...view].sort((a, b) => b.vol24 - a.vol24).slice(0, GRAD_SAMPLE);
  let gradChecked = 0, gradCount = 0;
  for (let i = 0; i < sample.length; i += 30) {
    const chunk = sample.slice(i, i + 30);
    try {
      const dj = await fetchJson(`${DEX}/tokens/${chunk.map((c) => c.mint).join(",")}`, 12_000);
      const byMint = new Map();
      for (const p of dj.pairs || []) {
        const m = p.baseToken?.address;
        if (!byMint.has(m)) byMint.set(m, []);
        byMint.get(m).push(p);
      }
      for (const c of chunk) {
        const pairs = byMint.get(c.mint) || [];
        if (!pairs.length) continue;                 // untracked — unknown, skip
        const best = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
        c.graduated = pairs.some((p) => p.dexId !== "pumpfun");
        c.pairUrl = best?.url || null;
        gradChecked++; if (c.graduated) gradCount++;
      }
    } catch { /* chunk failed — those coins stay unknown */ }
  }

  // native pump.fun field sample (DexScreener search — biased to ACTIVE pairs)
  let native = null;
  try {
    const sj = await fetchJson(`${DEX}/search?q=pump`, 9000);
    const seen = new Set();
    const rows = (sj.pairs || [])
      .filter((p) => p.chainId === "solana" && (p.dexId === "pumpfun" || p.dexId === "pumpswap"))
      .filter((p) => !seen.has(p.baseToken?.address) && seen.add(p.baseToken?.address));
    if (rows.length >= 5) {
      native = {
        n: rows.length,
        graduatedShare: +(rows.filter((p) => p.dexId === "pumpswap").length / rows.length).toFixed(3),
        medianVol24: median(rows.map((p) => p.volume?.h24 ?? 0)),
        note: "native pump.fun sample via DexScreener search — biased to active pairs",
      };
    }
  } catch { /* comparison degrades gracefully */ }

  const ranked = [...view].sort((a, b) => b.vol24 - a.vol24).slice(0, RANK_POOL);
  return {
    at: Date.now(),
    feeModel: FEE_MODEL, curveFee: CURVE_FEE,
    cohort: {
      launches: view.length,
      vol24h: +view.reduce((a, c) => a + c.vol24, 0).toFixed(2),
      feesEst24h: +view.reduce((a, c) => a + c.feesEst24h, 0).toFixed(2),
      medianMcap: median(view.map((c) => c.mcap)),
      medianAgeH: median(view.map((c) => c.ageH)),
      gradSample: { n: gradChecked, graduated: gradCount, rate: gradChecked ? +(gradCount / gradChecked).toFixed(3) : null },
    },
    native,
    ranked,
  };
}

export default async function () {
  const now = Date.now();
  if (mem.body && now - mem.at < FRESH_MS) return j(mem.body, "hit");
  if (!inflight) {
    inflight = build().then((body) => { mem = { at: Date.now(), body }; return body; })
      .finally(() => { inflight = null; });
  }
  try {
    return j(await inflight, "miss");
  } catch (e) {
    if (mem.body && now - mem.at < STALE_MS) return j({ ...mem.body, stale: true }, "stale");
    return Response.json({ error: e.message }, { status: 502 });
  }
}
