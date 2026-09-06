import { createHash } from "node:crypto";
import { createRateLimiter } from "../base44/shared/apiHttp.js";
import { createRuFomoStore } from "../base44/shared/ruFomoStore.js";
import { createRuFomoSignalsHandler } from "../base44/functions/ruFomoSignals/handler.js";
import { createRuFomoReportHandler } from "../base44/functions/ruFomoReport/handler.js";

export const AT = 1_800_000_000_000;
export const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
// Synthetic fixture only. Never a deployed credential.
export const TEST_KEY = "unit-test-only-not-a-live-credential";
export const HASH = createHash("sha256").update(TEST_KEY).digest("hex");
export const ROW = { mint: MINT, symbol: "TEST", name: "Example", vol24: 100000,
  mcap: 500000, change24h: 10, liquidity: 25000 };

export function request(path = "ruFomoSignals", { method = "GET", body, raw,
  auth = `Bearer ${TEST_KEY}`, headers = {} } = {}) {
  return new Request(`https://example.test/functions/${path}`, { method,
    headers: { ...(auth === null ? {} : { Authorization: auth }),
      ...(body === undefined && raw === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    ...(body === undefined && raw === undefined ? {} : { body: raw ?? JSON.stringify(body) }) });
}

export function setup(configOverrides = {}) {
  let now = AT, sequence = 0;
  const signals = [], reports = [], calls = [];
  const config = { RU_FOMO_API_KEY_SHA256: HASH, RU_FOMO_SIGNALS_ENABLED: "true", ...configOverrides };
  const state = { at: AT, ranked: [{ ...ROW }], stale: false, cache: "hit" };
  const entities = {
    RuFomoSignal: {
      async filter(query, sort, limit, skip) {
        calls.push(["find", query, sort, limit, skip]);
        return signals.filter((s) => s.signalId === query.signalId && s.mint === query.mint).slice(0, limit);
      },
      async create(row) { calls.push(["issue", row]); signals.push(structuredClone(row)); return row; },
    },
    RuFomoReport: {
      async create(row) { calls.push(["append", row]); reports.push(structuredClone(row)); return row; },
      async filter(query, sort, limit, skip) {
        calls.push(["logs", query, sort, limit, skip]);
        return reports.filter((r) => r.logKey < query.logKey.$lt)
          .sort((a, b) => a.logKey > b.logKey ? -1 : a.logKey < b.logKey ? 1 : 0).slice(skip, skip + limit);
      },
    },
  };
  const store = createRuFomoStore(entities);
  const deps = { getConfig: () => config, clock: () => now,
    limiter: createRateLimiter(60, () => now),
    getStore: () => { calls.push(["store"]); return store; },
    getAnalytics: async () => {
      calls.push(["analytics"]);
      return Response.json({ at: state.at, ranked: state.ranked, stale: state.stale },
        { headers: { "X-Launcher-Cache": state.cache } });
    },
    uuid: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
  };
  return { deps, config, state, store, entities, signals, reports, calls,
    poll: createRuFomoSignalsHandler(deps), report: createRuFomoReportHandler(deps),
    advance: (ms) => { now += ms; } };
}

export const reportBody = (overrides = {}) => ({ signalId: `RU_FOMO:${AT / 300000}:${MINT}`,
  mint: MINT, status: "dry_run", code: "DRY_RUN", ...overrides });