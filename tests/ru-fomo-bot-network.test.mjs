import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readConfig, httpsUrl } from '../services/ru-fomo-bot/config.mjs';
import { boundedFetch, createApi, createRpc, LOCAL_TRADE_URL, retryAfter } from '../services/ru-fomo-bot/network.mjs';
import { validatePoll } from '../services/ru-fomo-bot/signals.mjs';
import { logCode, safeCode, reportBody, SafeError, signatureBase58 } from '../services/ru-fomo-bot/safety.mjs';
import { SIGNAL_CODES } from '../base44/shared/ruFomoContract.js';
import { fixture } from './ru-fomo-bot-fixtures.mjs';

test('live requires explicit bounded configuration; dry-run never reads wallet key', () => {
  const f = fixture();
  const dry = { RU_FOMO_BASE_URL: f.env.RU_FOMO_BASE_URL, RU_FOMO_ALLOWED_ORIGIN: f.env.RU_FOMO_ALLOWED_ORIGIN,
    RU_FOMO_API_KEY: f.env.RU_FOMO_API_KEY };
  Object.defineProperty(dry, 'RU_FOMO_SECRET_KEY_JSON', { get() { throw new Error('must not load'); } });
  assert.equal(readConfig(dry).live, false);
  for (const field of ['RU_FOMO_ALLOWED_ORIGIN', 'RU_FOMO_API_KEY', 'RU_FOMO_ALLOWED_MINTS',
    'RU_FOMO_BUY_LAMPORTS', 'RU_FOMO_MAX_TRADE_LAMPORTS', 'RU_FOMO_DAILY_LAMPORTS',
    'RU_FOMO_MAX_FEE_LAMPORTS', 'RU_FOMO_RESERVE_LAMPORTS', 'RU_FOMO_SLIPPAGE_BPS', 'RU_FOMO_COOLDOWN_MS']) {
    const env = { ...f.env }; delete env[field]; assert.throws(() => readConfig(env), { code: 'CONFIG_INVALID' });
  }
  for (const bad of ['TRUE', '1', 'yes']) assert.throws(() => readConfig({ ...f.env, RU_FOMO_LIVE: bad }));
  for (const bad of ['NaN', '-1', 'Infinity', '1e8', '1000000000000000', '0.1']) {
    assert.throws(() => readConfig({ ...f.env, RU_FOMO_BUY_LAMPORTS: bad }));
  }
  assert.throws(() => readConfig({ ...f.env, RU_FOMO_SLIPPAGE_BPS: '501' }));
  assert.throws(() => readConfig({ ...f.env, RU_FOMO_MAX_TRADE_LAMPORTS: '1' }));
  assert.throws(() => readConfig({ ...f.env, RU_FOMO_ALLOWED_ORIGIN: 'https://other.example.com' }));
});

test('HTTPS origin validation refuses URL credentials, query auth, path confusion and local destinations', () => {
  const f = fixture();
  for (const url of ['http://operator.example.com/functions/', 'https://operator.example.com/functions/?key=placeholder',
    'https://user:placeholder@operator.example.com/functions/', 'https://operator.example.com/functions/#fragment',
    'https://127.0.0.1/functions/', 'https://localhost/functions/', 'https://operator.example.com:8443/functions/',
    'https://operator.example.com/other/', 'https://operator.example.com\\@other.example.com/functions/']) {
    assert.throws(() => readConfig({ ...f.env, RU_FOMO_BASE_URL: url }), SafeError);
  }
  assert.equal(httpsUrl('https://rpc.example.com/?api-key=placeholder', true).hostname, 'rpc.example.com');
});

test('bearer only reaches protected routes; public intent uses SOL units and pump pool; send has preflight and zero retry', async () => {
  const f = fixture(), calls = [];
  const fake = async (url, init) => {
    calls.push({ url, init });
    if (url === LOCAL_TRADE_URL) return new Response(f.transaction().serialize());
    if (url === f.config.rpc) {
      const body = JSON.parse(init.body);
      return Response.json({ jsonrpc: '2.0', id: body.id, result: 'mock-signature' });
    }
    return Response.json(url.endsWith('ruFomoSignals') ? f.poll : { ok: true });
  };
  const api = createApi(f.config, fake);
  await api.poll(); await api.report(reportBody(f.signal, 'dry_run', 'DRY_RUN')); await api.trade(f.signal.mint);
  const trade = JSON.parse(calls[2].init.body);
  assert.deepEqual(trade, { publicKey: f.config.wallet, action: 'buy', mint: f.signal.mint,
    denominatedInSol: 'true', amount: 0.001, slippage: 1, priorityFee: 0.00001, pool: 'pump' });
  assert.equal(calls[2].init.headers.Authorization, undefined);
  assert.ok(calls.slice(0, 2).every(c => c.init.headers.Authorization === `Bearer ${f.env.RU_FOMO_API_KEY}`));
  await createRpc(f.config, fake).send(Buffer.from('mock-not-a-real-transaction'));
  const send = JSON.parse(calls[3].init.body);
  assert.equal(send.method, 'sendTransaction');
  assert.deepEqual(send.params[1], { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0 });
  assert.equal(calls[3].init.headers.Authorization, undefined);
  assert.ok(calls.every(c => c.init.redirect === 'error'));
});

test('bounded response size, stream timeout, no retries and no provider error body reads', async () => {
  const url = 'https://operator.example.com';
  await assert.rejects(boundedFetch(url, {}, { maxBytes: 3, fetchImpl: async () => new Response('large') }), SafeError);
  await assert.rejects(boundedFetch(url, {}, { maxBytes: 3,
    fetchImpl: async () => new Response('a', { headers: { 'content-length': '999' } }) }), SafeError);
  await assert.rejects(boundedFetch(url, {}, { timeoutMs: 5,
    fetchImpl: async () => new Response(new ReadableStream({ start() {} })) }), SafeError);
  await assert.rejects(boundedFetch(url, {}, { timeoutMs: 5, fetchImpl: async () => new Promise(() => {}) }), SafeError);
  let calls = 0, reads = 0;
  const fake = async () => { calls++; return { status: 429, redirected: false, headers: new Headers({ 'retry-after': '42' }),
    get body() { reads++; throw new Error('never read'); } }; };
  await assert.rejects(boundedFetch(url, {}, { fetchImpl: fake }), { code: 'RATE_LIMITED', retryAfterMs: 42000 });
  assert.equal(calls, 1); assert.equal(reads, 0);
  for (const status of [301, 302, 401, 403, 500]) await assert.rejects(boundedFetch(url, {}, {
    fetchImpl: async () => ({ status, redirected: false, headers: new Headers(), get body() { throw new Error('never read'); } }),
  }), SafeError);
  assert.equal(retryAfter('2'), 2000);
  assert.equal(retryAfter(new Date(60000).toUTCString(), 0), 60000);
  assert.equal(retryAfter('invalid'), 15000);
  assert.ok(retryAfter('9999999999') > 300000);
  await assert.rejects(boundedFetch(url, {}, {
    fetchImpl: async () => new Response(null, { status: 429, headers: { 'retry-after': '600' } }),
  }), { code: 'RATE_LIMITED', halt: true });
});

test('untrusted poll envelope, expiry and identity are checked against exact wire constants', () => {
  const f = fixture(), now = f.poll.at;
  assert.deepEqual(validatePoll(f.poll, now), [{ id: f.signal.id, mint: f.signal.mint, expiresAt: f.signal.expiresAt }]);
  for (const patch of [{ stale: true }, { namespace: 'OTHER' }, { schemaVersion: 2 }, { enabled: false },
    { at: now + 1 }, { at: now - 300001 }, { signals: [f.signal, f.signal] }]) {
    assert.throws(() => validatePoll({ ...f.poll, ...patch }, now), SafeError);
  }
  for (const patch of [{ action: 'sell' }, { baseAsset: 'USDC' }, { id: 'wrong' }, { mint: 'wrong' },
    { expiresAt: now }, { expiresAt: now + 300001 }, { metrics: { ...f.signal.metrics, change24hPct: Infinity } }]) {
    assert.throws(() => validatePoll({ ...f.poll, signals: [{ ...f.signal, ...patch }] }, now), SafeError);
  }
});

test('an issued signal from an earlier snapshot in the same bucket remains valid', () => {
  const f = fixture();
  const at = Math.floor(f.poll.at / 300000) * 300000 + 10000;
  const issued = { ...f.signal, createdAt: at - 1000, expiresAt: at + 299000 };
  assert.equal(validatePoll({ ...f.poll, at, signals: [issued] }, at)[0].id, issued.id);
  assert.throws(() => validatePoll({ ...f.poll, at, signals: [{ ...issued, createdAt: at + 1 }] }, at));
});

test('only enum logs; reports strip freeform fields; signing module stays outside frontend/Base44', async t => {
  const output = [], f = fixture();
  logCode('arbitrary-provider-marker', text => output.push(text));
  logCode(safeCode(new Error('arbitrary-provider-marker')), text => output.push(text));
  assert.ok(output.every(line => SIGNAL_CODES.includes(JSON.parse(line).code)));
  assert.ok(!output.join('').includes('arbitrary-provider-marker'));
  assert.deepEqual(Object.keys(reportBody({ ...f.signal, privateKey: 'do-not-propagate' }, 'dry_run', 'DRY_RUN')),
    ['signalId', 'mint', 'status', 'code']);
  assert.throws(() => reportBody(f.signal, 'failed', 'raw provider text'));
  assert.equal(signatureBase58(new Uint8Array(64)), '1'.repeat(64));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const forbidden = [];
  function scan(dir) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (item.name.startsWith('.')) continue;
      const path = join(dir, item.name);
      if (item.isDirectory()) scan(path);
      else if (/\.(js|jsx|mjs|ts|tsx)$/.test(item.name) &&
        /ru-fomo-bot\/signer|RU_FOMO_SECRET_KEY_JSON|loadSigner\(/.test(readFileSync(path, 'utf8'))) forbidden.push(path);
    }
  }
  scan(join(root, 'src')); scan(join(root, 'base44'));
  assert.equal(forbidden.length, 0, 'Signing must remain operator-only');
  t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected network'); });
  await import('../services/ru-fomo-bot/main.mjs');
});