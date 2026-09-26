// Launcher feed builders shared by the live endpoints and the Supabase mirror
// (functions/mirrorLauncherFeed). The live tape build is exported from
// functions/getLauncherLive/handler.js (createLauncherLiveBuilder); the
// analytics cohort build moved here from getLauncherAnalytics/entry.ts so the
// mirror pushes byte-identical payloads to what the live endpoints serve.
// Browsers fall back to those mirrored rows when the live functions are
// unreachable (see src/lib/launcherFeed.js).

import { PublicKey } from "npm:@solana/web3.js@1.98.4";
import { heliusRpc } from "./otcSources.ts";
import { createCurveAddressDeriver } from "./launcherCurve.js";
import { createLauncherGraduationStore } from "./launcherGraduates.ts";
import { createLauncherCoinsArchiveLoader } from "./launcherArchive.ts";
import { createLauncherLiveBuilder } from "./launcherLiveBuilder.js";

const DEX = "https://api.dexscreener.com/latest/dex";
// Launcher creator-fee split, per otcdesks.cash/docs "The numbers" table:
// 67.5% holders · 10% desk pot · 10% OTC buyback/burn · 5% protocol ·
// 5% OTC holders · 2.5% account rent. Same split on every launch venue
// (pump.fun, Meteora); only the upstream trading-fee rate differs (below).
export const FEE_MODEL = [
  { key: "holders", label: "HOLDERS", pct: 67.5 },
  { key: "desk_pot", label: "DESK POT", pct: 10 },
  { key: "buybacks", label: "OTC BUYBACKS", pct: 10 },
  { key: "protocol", label: "PROTOCOL", pct: 5 },
  { key: "otc_holders", label: "OTC HOLDERS", pct: 5 },
  { key: "account_rent", label: "ACCOUNT RENT", pct: 2.5 },
];
const CURVE_FEE = 0.01; // pump.fun-style bonding curve fee
const CURVE_FEE_METEORA = 0.02; // Meteora launches: fixed 2% trading fee (otcdesks.cash/docs)
const GRAD_SAMPLE = 200; // graduation check: top-N by 24h volume
const RANK_POOL = 60; // coins shipped to the client (it re-sorts)

// Full live tape: coins roster + on-chain curve probes + persisted graduation
// ledger + risk enrichment. One build per mirror cycle (5 min).
export async function buildLauncherLiveBody(getClient) {
  const { build } = createLauncherLiveBuilder({
    rpc: heliusRpc,
    deriveCurveAddress: createCurveAddressDeriver(PublicKey),
    graduationStore: createLauncherGraduationStore(),
    coinsArchive: createLauncherCoinsArchiveLoader(),
  });
  return await build(getClient);
}

async function fetchJson(url, timeoutMs = 9000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

const median = (xs) => {
  const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : null;
};

// OTC_ANALYTICS cohort build — identical to what getLauncherAnalytics serves.
export async function buildLauncherAnalyticsBody() {
  const COINS_URL = "https://otcdesks.cash/api/coins";
  const now = Date.now() / 1000;
  const raw = await fetchJson(COINS_URL, 15_000);
  let coins =
    (Array.isArray(raw) ? raw : raw.coins || raw.data || raw.tokens || [])
      .filter((c) => c?.mint && c?.symbol);
  // Full launch history: the bare feed ships only the active set; archived
  // launches (swept from the upstream paginated DB, refreshed each mirror
  // cycle) restore the complete cohort this panel reported before the reset.
  try {
    const archived = await createLauncherCoinsArchiveLoader()();
    const seen = new Set(coins.map((c) => c.mint));
    for (const coin of archived || []) {
      if (coin?.mint && coin?.symbol && !seen.has(coin.mint)) {
        seen.add(coin.mint);
        coins.push(coin);
      }
    }
  } catch { /* archive unavailable — cohort stays on the active set */ }

  const view = coins.map((c) => {
    const ageH = Math.max((now - (c.createdAt || now)) / 3600, 0.01);
    const vol24 = c.snapshot?.volume24h ?? 0;
    const mcap = c.snapshot?.marketCap ?? 0;
    const venue = c.venue || "pump.fun";
    const curveFee = venue === "meteora" ? CURVE_FEE_METEORA : CURVE_FEE;
    return {
      mint: c.mint,
      symbol: c.symbol,
      name: c.name || "",
      image: c.image || "",
      createdAt: c.createdAt || null,
      ageH: +ageH.toFixed(2),
      vol24,
      mcap,
      liquidity: c.snapshot?.liquidity ?? null,
      holders: c.snapshot?.holders ?? null,
      change24h: c.snapshot?.change24h ?? null,
      venue,
      pairMint: c.pairMint || null,
      pairSymbol: c.pairSymbol || null,
      rewardSymbol: c.rewardSymbol || null,
      feesEst24h: +(vol24 * curveFee).toFixed(2),
      velocity: +(mcap / ageH).toFixed(2), // $ mcap per hour since launch
      graduated: null,
      pairUrl: null, // filled for the checked sample
    };
  });

  // graduation detection on the top-N by 24h volume (batched 30 mints/call)
  const sample = [...view].sort((a, b) => b.vol24 - a.vol24).slice(
    0,
    GRAD_SAMPLE,
  );
  let gradChecked = 0, gradCount = 0;
  for (let i = 0; i < sample.length; i += 30) {
    const chunk = sample.slice(i, i + 30);
    try {
      const dj = await fetchJson(
        `${DEX}/tokens/${chunk.map((c) => c.mint).join(",")}`,
        12_000,
      );
      const byMint = new Map();
      for (const p of dj.pairs || []) {
        const m = p.baseToken?.address;
        if (!byMint.has(m)) byMint.set(m, []);
        byMint.get(m).push(p);
      }
      for (const c of chunk) {
        const pairs = byMint.get(c.mint) || [];
        if (!pairs.length) continue; // untracked — unknown, skip
        const best = pairs.sort((a, b) =>
          (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
        )[0];
        c.graduated = pairs.some((p) =>
          p.dexId !== "pumpfun"
        );
        c.pairUrl = best?.url || null;
        gradChecked++;
        if (c.graduated) gradCount++;
      }
    } catch { /* chunk failed — those coins stay unknown */ }
  }

  // native pump.fun field sample (server fallback value; the browser fetches
  // the large GeckoTerminal pool sample client-side — Gecko permanently 429s
  // the shared runtime egress IP).
  const seen = new Set();
  const rows = [];
  for (
    const q of [
      "pumpfun",
      "pumpswap",
      "pump.fun",
      "frog",
      "maga",
      "dog",
      "moon",
    ]
  ) {
    let sj;
    try {
      sj = await fetchJson(`${DEX}/search?q=${encodeURIComponent(q)}`, 9000);
    } catch {
      continue;
    }
    for (const p of sj.pairs || []) {
      if (
        p.chainId !== "solana" ||
        (p.dexId !== "pumpfun" && p.dexId !== "pumpswap")
      ) continue;
      const mint = p.baseToken?.address;
      if (!mint || seen.has(mint)) continue;
      seen.add(mint);
      rows.push(p);
    }
  }
  const native = rows.length >= 5
    ? {
      n: rows.length,
      graduatedShare:
        +(rows.filter((p) => p.dexId === "pumpswap").length / rows.length)
          .toFixed(3),
      medianVol24: median(rows.map((p) => p.volume?.h24 ?? 0)),
      note:
        "pump.fun sample via DexScreener search — small sample, biased to active pairs",
    }
    : null;

  const ranked = [...view].sort((a, b) => b.vol24 - a.vol24).slice(
    0,
    RANK_POOL,
  );
  return {
    at: Date.now(),
    feeModel: FEE_MODEL,
    curveFee: CURVE_FEE,
    cohort: {
      launches: view.length,
      vol24h: +view.reduce((a, c) => a + c.vol24, 0).toFixed(2),
      feesEst24h: +view.reduce((a, c) => a + c.feesEst24h, 0).toFixed(2),
      medianMcap: median(view.map((c) => c.mcap)),
      medianAgeH: median(view.map((c) => c.ageH)),
      gradSample: {
        n: gradChecked,
        graduated: gradCount,
        rate: gradChecked ? +(gradCount / gradChecked).toFixed(3) : null,
      },
    },
    native,
    ranked,
  };
}
