import { PublicKey } from '@solana/web3.js';
import { SIGNAL_NAMESPACE, SIGNAL_SCHEMA_VERSION, SOL_MINT } from '../../base44/shared/ruFomoContract.js';
import { ensure, SafeError } from './safety.mjs';

const time = value => Number.isSafeInteger(value) && value > 0;
export function validatePoll(body, now) {
  ensure(body && body.schemaVersion === SIGNAL_SCHEMA_VERSION && body.namespace === SIGNAL_NAMESPACE &&
    typeof body.enabled === 'boolean' && typeof body.stale === 'boolean' &&
    Array.isArray(body.signals) && body.signals.length <= 60, 'INVALID_SIGNAL');
  ensure(body.stale === false && time(body.at) && body.at <= now && now - body.at < 300000, 'STALE_DATA');
  ensure(body.enabled === true, 'DISABLED');
  const ids = new Set();
  return body.signals.map(signal => {
    validateSignal(signal, body.at, now);
    ensure(!ids.has(signal.id), 'INVALID_SIGNAL');
    ids.add(signal.id);
    // Strip any untrusted extra fields before passing to business logic.
    return { id: signal.id, mint: signal.mint, expiresAt: signal.expiresAt };
  });
}

export function validateSignal(s, at, now) {
  ensure(s && typeof s.mint === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.mint), 'INVALID_SIGNAL');
  try { ensure(new PublicKey(s.mint).toBase58() === s.mint, 'INVALID_SIGNAL'); }
  catch { throw new SafeError('INVALID_SIGNAL'); }
  ensure(s.mint !== SOL_MINT && s.mint !== PublicKey.default.toBase58() && s.action === 'buy' &&
    s.baseAsset === 'SOL' && s.reason === 'volume_and_momentum' &&
    s.id === `${SIGNAL_NAMESPACE}:${Math.floor(at / 300000)}:${s.mint}` &&
    time(s.createdAt) && s.createdAt <= at && Math.floor(s.createdAt / 300000) === Math.floor(at / 300000) &&
    time(s.expiresAt) && s.expiresAt <= s.createdAt + 300000 && s.expiresAt > s.createdAt, 'INVALID_SIGNAL');
  ensure(s.expiresAt > now, 'EXPIRED_SIGNAL');
  const m = s.metrics;
  ensure(m && ['volume24hUsd', 'change24hPct', 'liquidityUsd'].every(k =>
    typeof m[k] === 'number' && Number.isFinite(m[k])) && m.volume24hUsd >= 0 && m.liquidityUsd >= 0 &&
    (m.marketCapUsd === null || (Number.isFinite(m.marketCapUsd) && m.marketCapUsd >= 0)), 'INVALID_SIGNAL');
}