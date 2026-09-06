import { SIGNAL_NAMESPACE, SOL_MINT } from "./ruFomoContract.js";
import { ApiError } from "./apiHttp.js";

export const SIGNAL_TTL_MS = 300_000;
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MAX = Number.MAX_SAFE_INTEGER;

// Validate encoded length AND decoded 32-byte address, not just a permissive regex.
export function isTokenMint(mint) {
  if (typeof mint !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) || mint === SOL_MINT) return false;
  let value = 0n;
  for (const char of mint) value = value * 58n + BigInt(BASE58.indexOf(char));
  if (value === 0n) return false; // System program is not a token mint.
  let bytes = 0;
  for (let n = value; n > 0n; n >>= 8n) bytes++;
  return bytes + (mint.match(/^1*/)?.[0].length || 0) === 32;
}

export function strategyConfig(config) {
  const invalid = () => new ApiError(503, "CONFIG_INVALID", "Signal configuration is invalid.");
  const enabled = config.RU_FOMO_SIGNALS_ENABLED;
  if (enabled !== undefined && enabled !== null && enabled !== "true" && enabled !== "false") throw invalid();
  const numeric = (key, fallback) => {
    const value = config[key];
    if (value === undefined || value === null) return fallback;
    if (typeof value !== "string" || !/^[0-9]+(?:\.[0-9]+)?$/.test(value)) throw invalid();
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX) throw invalid();
    return parsed;
  };
  const result = { enabled: enabled === "true",
    minVolume: numeric("RU_FOMO_MIN_VOLUME_USD", 100_000),
    minChange: numeric("RU_FOMO_MIN_CHANGE_PCT", 10),
    maxChange: numeric("RU_FOMO_MAX_CHANGE_PCT", 100),
    minLiquidity: numeric("RU_FOMO_MIN_LIQUIDITY_USD", 25_000) };
  if (result.maxChange < result.minChange) throw invalid();
  return result;
}

export const signalIdentity = (at, mint) => `${SIGNAL_NAMESPACE}:${Math.floor(at / SIGNAL_TTL_MS)}:${mint}`;
const positive = (value) => Number.isFinite(value) && value > 0 && value <= MAX;

export function eligibleMetrics(metrics, config) {
  return metrics && positive(metrics.volume24hUsd) && positive(metrics.liquidityUsd)
    && Number.isFinite(metrics.change24hPct) && metrics.change24hPct >= -100 && metrics.change24hPct <= MAX
    && (metrics.marketCapUsd === null || positive(metrics.marketCapUsd))
    && metrics.volume24hUsd >= config.minVolume && metrics.liquidityUsd >= config.minLiquidity
    && metrics.change24hPct >= config.minChange && metrics.change24hPct <= config.maxChange;
}

export function signalCandidates(snapshot, config, now) {
  if (!config.enabled || snapshot.stale || !Number.isSafeInteger(snapshot.at)
    || snapshot.at > now || snapshot.at <= now - SIGNAL_TTL_MS) return [];
  const seen = new Set();
  const signals = [];
  for (const row of snapshot.ranked.slice(0, 60)) {
    if (!isTokenMint(row?.mint) || seen.has(row.mint)) continue;
    // Unknown volume/change/liquidity is never coerced to a threshold-passing value.
    const metrics = { volume24hUsd: row.vol24, marketCapUsd: row.mcap ?? null,
      change24hPct: row.change24h, liquidityUsd: row.liquidity };
    if (!eligibleMetrics(metrics, config)) continue;
    seen.add(row.mint);
    signals.push({ id: signalIdentity(snapshot.at, row.mint), mint: row.mint,
      action: "buy", baseAsset: "SOL", createdAt: snapshot.at,
      expiresAt: snapshot.at + SIGNAL_TTL_MS, reason: "volume_and_momentum", metrics });
  }
  return signals;
}

export function isIssuedSignal(signal) {
  return signal && isTokenMint(signal.mint) && Number.isSafeInteger(signal.createdAt)
    && signal.createdAt >= 0 && Number.isSafeInteger(signal.expiresAt)
    && signal.expiresAt > signal.createdAt && signal.expiresAt <= signal.createdAt + SIGNAL_TTL_MS
    && signal.id === signalIdentity(signal.createdAt, signal.mint)
    && signal.action === "buy" && signal.baseAsset === "SOL" && signal.reason === "volume_and_momentum"
    && eligibleMetrics(signal.metrics, { minVolume: 0, minLiquidity: 0, minChange: 0, maxChange: MAX });
}