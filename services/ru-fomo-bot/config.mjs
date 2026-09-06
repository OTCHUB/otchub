import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublicKey } from '@solana/web3.js';
import { SOL_MINT } from '../../base44/shared/ruFomoContract.js';
import { ensure, SafeError } from './safety.mjs';

// Extra envelope for a creator-vault rent top-up racing simulation (not additional trade input).
export const RENT_HEADROOM = 1000000;
export function publicKey(value) {
  try {
    ensure(typeof value === 'string' && value.length >= 32 && value.length <= 44, 'CONFIG_INVALID');
    const key = new PublicKey(value);
    ensure(key.toBase58() === value, 'CONFIG_INVALID');
    return key;
  } catch { throw new SafeError('CONFIG_INVALID'); }
}

export function httpsUrl(value, allowQuery = false) {
  try {
    ensure(typeof value === 'string' && value.length <= 2048 && !/[\s\\]/.test(value), 'CONFIG_INVALID');
    const url = new URL(value);
    ensure(url.protocol === 'https:' && !url.username && !url.password && !url.hash &&
      (allowQuery || !url.search) && (!url.port || url.port === '443'), 'CONFIG_INVALID');
    ensure(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname) &&
      !/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname), 'CONFIG_INVALID');
    return url;
  } catch { throw new SafeError('CONFIG_INVALID'); }
}

function integer(value, min, max) {
  ensure(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value), 'CONFIG_INVALID');
  const n = Number(value);
  ensure(Number.isSafeInteger(n) && n >= min && n <= max, 'CONFIG_INVALID');
  return n;
}

export function readConfig(env = process.env) {
  const live = env.RU_FOMO_LIVE === 'true';
  ensure(env.RU_FOMO_LIVE === undefined || ['true', 'false'].includes(env.RU_FOMO_LIVE), 'CONFIG_INVALID');
  const base = httpsUrl(env.RU_FOMO_BASE_URL);
  const origin = httpsUrl(env.RU_FOMO_ALLOWED_ORIGIN);
  ensure(origin.pathname === '/' && base.origin === origin.origin && base.pathname === '/functions/', 'CONFIG_INVALID');
  const token = env.RU_FOMO_API_KEY;
  ensure(typeof token === 'string' && /^[A-Za-z0-9._~-]{32,512}$/.test(token), 'CONFIG_INVALID');
  const mints = new Set((env.RU_FOMO_ALLOWED_MINTS || '').split(',').filter(Boolean).map(v => publicKey(v).toBase58()));
  ensure(!mints.has(SOL_MINT) && !mints.has(PublicKey.default.toBase58()) && mints.size <= 60, 'CONFIG_INVALID');
  const required = (name, fallback) => {
    ensure(!live || env[name] !== undefined, 'CONFIG_INVALID');
    return env[name] ?? fallback;
  };
  const config = {
    live, base: base.href, allowedOrigin: origin.origin, token, mints,
    stateDir: env.RU_FOMO_STATE_DIR || fileURLToPath(new URL('./state', import.meta.url)),
    pollMs: integer(env.RU_FOMO_POLL_MS ?? '15000', 5000, 300000),
    amount: integer(required('RU_FOMO_BUY_LAMPORTS', '1000000'), 1, 100000000),
    perTrade: integer(required('RU_FOMO_MAX_TRADE_LAMPORTS', '3000000'), 1, 200000000),
    daily: integer(required('RU_FOMO_DAILY_LAMPORTS', '10000000'), 1, 1000000000),
    reserve: integer(required('RU_FOMO_RESERVE_LAMPORTS', '10000000'), 1000000, 10000000000),
    maxFee: integer(required('RU_FOMO_MAX_FEE_LAMPORTS', '100000'), 5000, 1000000),
    priorityFee: integer(env.RU_FOMO_PRIORITY_FEE_LAMPORTS ?? '10000', 0, 995000),
    slippageBps: integer(required('RU_FOMO_SLIPPAGE_BPS', '100'), 1, 500),
    cooldownMs: integer(required('RU_FOMO_COOLDOWN_MS', '3600000'), 300000, 604800000),
  };
  ensure(isAbsolute(config.stateDir) && config.amount + config.maxFee + RENT_HEADROOM <= config.perTrade &&
    config.perTrade <= config.daily && config.priorityFee + 5000 <= config.maxFee, 'CONFIG_INVALID');
  if (live) {
    ensure(mints.size > 0, 'CONFIG_INVALID');
    config.wallet = publicKey(env.RU_FOMO_WALLET_PUBLIC_KEY).toBase58();
    ensure(PublicKey.isOnCurve(publicKey(config.wallet).toBytes()), 'CONFIG_INVALID');
    config.rpc = httpsUrl(env.RU_FOMO_RPC_URL, true).href;
  }
  return Object.freeze(config);
}