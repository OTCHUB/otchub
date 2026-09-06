import { SIGNAL_CODES, SIGNAL_STATUSES } from "./ruFomoContract.js";

const nullableNumber = { type: ["number", "null"] };
const mint = { type: "string", pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$" };
const metricsRow = {
  type: "object", required: ["mint", "symbol", "name", "vol24", "mcap", "change24h"],
  additionalProperties: false,
  properties: { mint, symbol: { type: "string" }, name: { type: "string" },
    vol24: nullableNumber, mcap: nullableNumber, change24h: nullableNumber },
};
const signal = {
  type: "object", additionalProperties: false,
  required: ["id", "mint", "action", "baseAsset", "createdAt", "expiresAt", "reason", "metrics"],
  properties: {
    id: { type: "string", pattern: "^RU_FOMO:[0-9]+:[1-9A-HJ-NP-Za-km-z]{32,44}$" },
    mint, action: { const: "buy" }, baseAsset: { const: "SOL" },
    createdAt: { type: "integer" }, expiresAt: { type: "integer" },
    reason: { const: "volume_and_momentum" },
    metrics: { type: "object", additionalProperties: false,
      required: ["volume24hUsd", "marketCapUsd", "change24hPct", "liquidityUsd"],
      properties: { volume24hUsd: { type: "number" }, marketCapUsd: nullableNumber,
        change24hPct: { type: "number" }, liquidityUsd: { type: "number" } } },
  },
};
const report = {
  type: "object", additionalProperties: false,
  required: ["signalId", "mint", "status", "code"],
  properties: { signalId: signal.properties.id, mint, status: { enum: SIGNAL_STATUSES },
    code: { enum: SIGNAL_CODES }, signature: { type: ["string", "null"], pattern: "^[1-9A-HJ-NP-Za-km-z]{64,88}$" } },
};
const metrics = {
  type: "object", additionalProperties: false,
  required: ["schemaVersion", "at", "stale", "cache", "scope", "sort", "limit", "total", "data"],
  properties: {
    schemaVersion: { const: 1 }, at: { type: "integer", description: "Snapshot time, epoch milliseconds" },
    stale: { type: "boolean" }, cache: { enum: ["hit", "miss", "stale"] },
    scope: { const: "top_60_by_volume" }, sort: { enum: ["change24h", "vol24", "mcap"] },
    limit: { type: "integer", minimum: 1, maximum: 60 }, total: { type: "integer", minimum: 0 },
    data: { type: "array", maxItems: 60, items: metricsRow },
  },
};
const exampleMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const exampleAt = 1800000000000;
const exampleSignal = {
  id: `RU_FOMO:${Math.floor(exampleAt / 300000)}:${exampleMint}`, mint: exampleMint,
  action: "buy", baseAsset: "SOL", createdAt: exampleAt, expiresAt: exampleAt + 300000,
  reason: "volume_and_momentum", metrics: { volume24hUsd: 150000, marketCapUsd: 500000, change24hPct: 12, liquidityUsd: 50000 },
};

// Public, static reference metadata: not an assertion that any endpoint is live.
export const PUBLIC_API_META = {
  schemaVersion: 1,
  endpoints: [
    { name: "getPublicMetrics", namespace: "PUBLIC", methods: ["GET", "POST"], access: "public",
      rateLimit: { limit: 120, windowSeconds: 60, scope: "per-isolate aggregate" }, cacheTtlSeconds: 300 },
    { name: "ruFomoSignals", namespace: "RU_FOMO", methods: ["GET", "POST"], access: "bearer_api_key",
      rateLimit: { limit: 60, windowSeconds: 60, scope: "per-credential per-isolate" }, cacheTtlSeconds: 0 },
    { name: "ruFomoReport", namespace: "RU_FOMO", methods: ["POST"], access: "bearer_api_key",
      rateLimit: { limit: 60, windowSeconds: 60, scope: "per-credential per-isolate" }, cacheTtlSeconds: 0 },
  ],
  schemas: { metrics, signal, report },
  examples: {
    metrics: { schemaVersion: 1, at: exampleAt, stale: false, cache: "hit", scope: "top_60_by_volume",
      sort: "change24h", limit: 15, total: 1, data: [{ mint: exampleMint, symbol: "EXAMPLE", name: "Illustrative only", vol24: 150000, mcap: 500000, change24h: 12 }] },
    signal: { schemaVersion: 1, namespace: "RU_FOMO", at: exampleAt, stale: false, enabled: true, signals: [exampleSignal] },
    report: { signalId: exampleSignal.id, mint: exampleMint, status: "dry_run", code: "DRY_RUN" },
  },
  notes: [
    "Examples are synthetic; these are not trading recommendations or current market data.",
    "Top gainers are ranked within the top-60-volume cohort. Unknown metrics are last; ties retain source order.",
    "Five-minute per-isolate cache, single-flight, and thirty-minute stale-on-error fallback. No global quota guarantee.",
    "Use an edge rate limiter for production quotas. RU_FOMO never emits signals from stale snapshots.",
    "Authorization: Bearer <operator API key>. Do not put API keys in URLs or frontend bundles.",
    "Private report logs are caller-reported outcomes, not independently verified chain confirmations.",
  ],
};