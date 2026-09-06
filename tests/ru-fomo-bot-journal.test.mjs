import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, linkSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Journal } from '../services/ru-fomo-bot/journal.mjs';
import { Bot } from '../services/ru-fomo-bot/bot.mjs';
import { loadSigner } from '../services/ru-fomo-bot/signer.mjs';
import { SafeError } from '../services/ru-fomo-bot/safety.mjs';
import { fixture, stateDirectory } from './ru-fomo-bot-fixtures.mjs';

function setup(t, live = true, options = {}) {
  const f = fixture(), config = { ...f.config, live, stateDir: stateDirectory(t) };
  const journal = new Journal(config);
  t.after(() => journal.close());
  const logs = [], reports = [];
  const api = { poll: async () => f.poll, report: async body => reports.push(body), trade: async () => f.transaction().serialize() };
  const signer = live ? loadSigner(config, { RU_FOMO_SECRET_KEY_JSON: JSON.stringify([...f.keypair.secretKey]) }) : undefined;
  t.after(() => signer?.dispose());
  const bot = new Bot({ config, journal, api, rpc: f.rpc, signer, log: code => logs.push(code), ...options });
  return { ...f, config, journal, bot, api, logs, reports };
}

test('dry run has no signer, trade API, or RPC use; replay survives restart', async t => {
  const s = setup(t, false);
  s.api.trade = async () => assert.fail('dry run must never fetch a transaction');
  s.bot.rpc = new Proxy({}, { get() { assert.fail('dry run must never query RPC'); } });
  await s.bot.tick(); await s.bot.tick();
  assert.equal(s.journal.get(s.signal.id).state, 'dry_run');
  assert.ok(s.logs.includes('DRY_RUN') && s.logs.includes('DUPLICATE_SIGNAL'));
  assert.deepEqual(s.reports[0], { signalId: s.signal.id, mint: s.signal.mint, status: 'dry_run', code: 'DRY_RUN' });
  s.journal.close();
  const restarted = new Journal(s.config);
  try { assert.throws(() => restarted.reserve(s.signal, s.config, Date.now()), { code: 'DUPLICATE_SIGNAL' }); }
  finally { restarted.close(); }
});

test('main runs a protected dry-run cycle without loading a wallet key', async t => {
  const { main } = await import('../services/ru-fomo-bot/main.mjs');
  const f = fixture(), controller = new AbortController(), requests = [];
  const env = { RU_FOMO_BASE_URL: f.env.RU_FOMO_BASE_URL, RU_FOMO_ALLOWED_ORIGIN: f.env.RU_FOMO_ALLOWED_ORIGIN,
    RU_FOMO_API_KEY: f.env.RU_FOMO_API_KEY, RU_FOMO_STATE_DIR: stateDirectory(t) };
  Object.defineProperty(env, 'RU_FOMO_SECRET_KEY_JSON', { get() { assert.fail('must not load a key'); } });
  t.mock.method(console, 'log', () => {});
  const code = await main({ env, signal: controller.signal, fetchImpl: async url => {
    requests.push(url);
    if (url.endsWith('ruFomoSignals')) return Response.json(f.poll);
    assert.ok(url.endsWith('ruFomoReport'));
    controller.abort();
    return Response.json({ ok: true });
  } });
  assert.equal(code, 0);
  assert.equal(requests.length, 2);
});

test('main propagates shutdown during polling before any reservation or report', async t => {
  const { main } = await import('../services/ru-fomo-bot/main.mjs');
  const f = fixture(), controller = new AbortController(), requests = [];
  const env = { RU_FOMO_BASE_URL: f.env.RU_FOMO_BASE_URL, RU_FOMO_ALLOWED_ORIGIN: f.env.RU_FOMO_ALLOWED_ORIGIN,
    RU_FOMO_API_KEY: f.env.RU_FOMO_API_KEY, RU_FOMO_STATE_DIR: stateDirectory(t) };
  t.mock.method(console, 'log', () => {});
  const code = await main({ env, signal: controller.signal, fetchImpl: async url => {
    requests.push(url);
    controller.abort();
    return Response.json(f.poll);
  } });
  assert.equal(code, 0);
  assert.equal(requests.length, 1);
  assert.ok(requests[0].endsWith('ruFomoSignals'));
  const journal = new Journal({ ...f.config, live: false, stateDir: env.RU_FOMO_STATE_DIR });
  try {
    assert.equal(journal.get(f.signal.id), undefined);
    assert.equal(journal.db.prepare('SELECT COUNT(*) AS count FROM budgets').get().count, 0);
    assert.equal(journal.db.prepare('SELECT COUNT(*) AS count FROM outbox').get().count, 0);
  } finally { journal.close(); }
});

for (const stage of ['before tick', 'before reservation', 'poll', 'trade', 'validation']) {
  test(`shutdown ${stage} prevents signing and sending`, { timeout: 5000 }, async t => {
    const controller = new AbortController(), s = setup(t, true, { stopSignal: controller.signal });
    s.bot.now = () => s.signal.createdAt;
    const sign = t.mock.fn(), send = t.mock.fn(), reserve = t.mock.method(s.journal, 'reserve');
    s.bot.signer = { sign }; s.rpc.send = send;
    const entered = Promise.withResolvers(), response = Promise.withResolvers();
    const wait = () => { entered.resolve(); return response.promise; };
    const gated = ['poll', 'trade', 'validation'].includes(stage);
    if (stage === 'poll') s.api.poll = wait;
    else if (stage === 'trade') s.api.trade = wait;
    else if (stage === 'validation') s.bot.validate = wait;
    else controller.abort();
    const running = stage === 'before reservation' ? s.bot.execute(s.signal) : s.bot.tick();
    const reserved = stage === 'trade' || stage === 'validation';
    if (gated) {
      await entered.promise;
      assert.equal(s.journal.get(s.signal.id)?.state, reserved ? 'reserved' : undefined);
      controller.abort();
      response.resolve(stage === 'poll' ? s.poll : {});
    }
    await running;
    await s.bot.tick();
    assert.equal(sign.mock.callCount(), 0);
    assert.equal(send.mock.callCount(), 0);
    assert.equal(reserve.mock.callCount(), reserved ? 1 : 0);
    assert.equal(s.bot.halted, false);
    if (reserved) {
      assert.equal(s.journal.get(s.signal.id).state, 'rejected');
      assert.equal(s.journal.get(s.signal.id).signature, null);
      assert.deepEqual(s.reports, [{ signalId: s.signal.id, mint: s.signal.mint, status: 'rejected', code: 'DISABLED' }]);
      assert.equal(s.journal.db.prepare('SELECT spent FROM budgets').get().spent, s.config.perTrade);
    } else {
      assert.equal(s.journal.get(s.signal.id), undefined);
      assert.deepEqual(s.reports, []);
    }
    s.journal.close();
    const restarted = new Journal(s.config);
    try { assert.equal(restarted.get(s.signal.id)?.state, reserved ? 'rejected' : undefined); }
    finally { restarted.close(); }
  });
}

test('shutdown between signals stops the rest of the polled batch', async t => {
  const controller = new AbortController(), s = setup(t, false, { stopSignal: controller.signal });
  const mint = fixture().signal.mint;
  const next = { ...s.signal, mint, id: `RU_FOMO:${Math.floor(s.poll.at / 300000)}:${mint}` };
  s.poll.signals.push(next);
  s.bot.config = { ...s.config, mints: new Set([s.signal.mint, next.mint]) };
  const execute = s.bot.execute.bind(s.bot);
  const executions = t.mock.method(s.bot, 'execute', async signal => { await execute(signal); controller.abort(); });
  await s.bot.tick();
  assert.equal(executions.mock.callCount(), 1);
  assert.equal(s.journal.get(s.signal.id).state, 'dry_run');
  assert.equal(s.journal.get(next.id), undefined);
  assert.equal(s.reports.length, 1);
});

for (const ambiguous of [false, true]) {
  test(`shutdown after durable intent preserves ${ambiguous ? 'ambiguous' : 'successful'} submission`, async t => {
    const controller = new AbortController(), s = setup(t, true, { stopSignal: controller.signal });
    const poll = t.mock.method(s.api, 'poll'), sign = t.mock.fn(s.bot.signer.sign);
    s.bot.signer = { sign };
    const intended = s.journal.intended.bind(s.journal);
    t.mock.method(s.journal, 'intended', (signal, signature) => { intended(signal, signature); controller.abort(); });
    let atSend;
    const send = t.mock.fn(async () => {
      const row = s.journal.get(s.signal.id);
      atSend = { state: row.state, signature: row.signature, aborted: controller.signal.aborted };
      if (ambiguous) throw new SafeError('RPC_ERROR');
      return row.signature;
    });
    s.rpc.send = send;
    await s.bot.tick();
    const signature = s.journal.get(s.signal.id).signature;
    assert.ok(signature);
    assert.deepEqual(atSend, { state: 'unknown', signature, aborted: true });
    assert.equal(s.journal.get(s.signal.id).state, ambiguous ? 'unknown' : 'submitted');
    const lookups = [];
    s.rpc.status = async sig => { lookups.push(sig); return { value: [{ confirmationStatus: 'finalized', err: null }] }; };
    await s.bot.tick(); await s.bot.tick();
    assert.deepEqual(lookups, [signature]);
    assert.equal(s.journal.get(s.signal.id).signature, signature);
    assert.equal(s.journal.get(s.signal.id).state, 'confirmed');
    assert.equal(sign.mock.callCount(), 1);
    assert.equal(send.mock.callCount(), 1);
    assert.equal(poll.mock.callCount(), 1);
    assert.ok(s.reports.some(row => row.code === 'CONFIRMED'));
    assert.ok(s.reports.every(row => !['rejected', 'failed'].includes(row.status) && row.code !== 'DISABLED'));
  });
}

test('clock rollback during validation is fatal without masking or changing the reservation', { timeout: 5000 }, async t => {
  const s = setup(t), entered = Promise.withResolvers(), response = Promise.withResolvers();
  let now = s.signal.createdAt, clockError;
  s.bot.now = () => now;
  s.bot.validate = () => { entered.resolve(); return response.promise; };
  const sign = t.mock.fn(), send = t.mock.fn(), finish = t.mock.method(s.journal, 'finish');
  s.bot.signer = { sign }; s.rpc.send = send;
  const clock = s.journal.clock.bind(s.journal);
  t.mock.method(s.journal, 'clock', at => {
    try { return clock(at); }
    catch (error) {
      // Even if time recovers before catch handling, the fatal check must not become a normal rejection.
      clockError = error; now = s.signal.createdAt + 1; throw error;
    }
  });
  const snapshot = journal => ['identity', 'attempts', 'budgets', 'outbox']
    .map(table => journal.db.prepare(`SELECT * FROM ${table}`).all());
  const running = s.bot.tick();
  await entered.promise;
  assert.equal(s.journal.get(s.signal.id).state, 'reserved');
  const before = snapshot(s.journal);
  now--;
  response.resolve({});
  await assert.rejects(running, error => {
    assert.equal(error, clockError);
    assert.ok(error instanceof SafeError);
    assert.equal(error.code, 'CONFIG_INVALID');
    return true;
  });
  assert.equal(sign.mock.callCount(), 0);
  assert.equal(send.mock.callCount(), 0);
  assert.equal(finish.mock.callCount(), 0);
  assert.equal(s.bot.halted, true);
  assert.equal(s.bot.running, false);
  assert.deepEqual(s.reports, []);
  assert.deepEqual(snapshot(s.journal), before);
  await assert.rejects(s.bot.tick(), { code: 'CONFIG_INVALID' });
  s.journal.close();
  const restarted = new Journal(s.config);
  try { assert.deepEqual(snapshot(restarted), before); }
  finally { restarted.close(); }
});

test('exclusive SQLite operator lock and restrictive file modes', t => {
  const s = setup(t);
  assert.throws(() => new Journal(s.config), { code: 'CONFIG_INVALID' });
  assert.equal(statSync(s.config.stateDir).mode & 0o777, 0o700);
  assert.equal(statSync(join(s.config.stateDir, 'live.sqlite')).mode & 0o777, 0o600);
  s.journal.close();
  const reopened = new Journal(s.config); reopened.close();
});

test('OS releases SQLite lock after abrupt process exit; intended signature survives', t => {
  const f = fixture(), config = { ...f.config, stateDir: stateDirectory(t) };
  // Send public test configuration through stdin, never credentials/keys or environment dumps.
  const publicConfig = { live: true, stateDir: config.stateDir, wallet: config.wallet,
    perTrade: config.perTrade, daily: config.daily, cooldownMs: config.cooldownMs };
  const moduleUrl = new URL('../services/ru-fomo-bot/journal.mjs', import.meta.url).href;
  const source = `import { readFileSync } from 'node:fs';
    import { Journal } from ${JSON.stringify(moduleUrl)};
    const { config, signal, now } = JSON.parse(readFileSync(0, 'utf8'));
    const journal = new Journal(config);
    journal.reserve(signal, config, now);
    journal.intended(signal, '1'.repeat(64));
    process.exit(23);`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    input: JSON.stringify({ config: publicConfig, signal: f.signal, now: f.signal.createdAt }),
    encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'ignore', 'ignore'],
  });
  assert.equal(result.status, 23);
  const journal = new Journal(config);
  try {
    journal.recover(f.signal.createdAt);
    assert.equal(journal.get(f.signal.id).signature, '1'.repeat(64));
    assert.equal(journal.get(f.signal.id).state, 'unknown');
  } finally { journal.close(); }
});

test('journal refuses symlink files, dangling sidecars, hardlinks and permissive directories', t => {
  const f = fixture();
  for (const attack of ['link', 'sidecar', 'hardlink', 'mode']) {
    const dir = stateDirectory(t), target = join(dir, 'operator-lock.sqlite');
    const other = join(dir, 'other'); writeFileSync(other, '', { mode: 0o600 });
    if (attack === 'link') symlinkSync(other, target);
    if (attack === 'sidecar') symlinkSync(join(dir, 'missing'), target + '-journal');
    if (attack === 'hardlink') linkSync(other, target);
    if (attack === 'mode') chmodSync(dir, 0o755);
    assert.throws(() => new Journal({ ...f.config, stateDir: dir }), { code: 'CONFIG_INVALID' });
  }
});

test('daily reservations, per-mint cooldown, clock rollback, and no refunds after failure', t => {
  const s = setup(t), now = s.signal.createdAt;
  s.journal.reserve(s.signal, s.config, now);
  s.journal.finish(s.signal, 'rejected', 'SIMULATION_FAILED', now);
  assert.throws(() => s.journal.reserve({ ...s.signal, id: 'next-bucket' }, s.config, now + 1), { code: 'BUDGET_EXCEEDED' });
  assert.throws(() => s.journal.reserve({ ...s.signal, id: 'clock-back' }, s.config, now - 1), { code: 'CONFIG_INVALID' });
  for (const n of [2, 3]) {
    const signal = { id: `signal-${n}`, mint: `mint-${n}` };
    s.journal.reserve(signal, s.config, now);
    s.journal.finish(signal, 'rejected', 'SIMULATION_FAILED', now);
  }
  assert.throws(() => s.journal.reserve({ id: 'fourth', mint: 'fourth' }, s.config, now), { code: 'BUDGET_EXCEEDED' });
  s.journal.close();
  const restarted = new Journal(s.config);
  try { assert.throws(() => restarted.reserve({ id: 'after-restart', mint: 'new' }, s.config, now), { code: 'BUDGET_EXCEEDED' }); }
  finally { restarted.close(); }
});

test('a second reservation is refused while the first is still awaiting validation', t => {
  const s = setup(t), now = s.signal.createdAt;
  s.journal.reserve(s.signal, s.config, now);
  assert.throws(() => s.journal.reserve({ id: 'concurrent', mint: 'another' }, s.config, now), { code: 'CONFIRMATION_UNKNOWN' });
});

test('intended signature is committed before single send, then finalized via signature lookup', async t => {
  const s = setup(t);
  let sends = 0;
  s.rpc.send = async bytes => {
    sends++;
    const row = s.journal.get(s.signal.id);
    assert.equal(row.state, 'unknown'); assert.ok(row.signature); assert.ok(bytes.length > 64);
    return row.signature;
  };
  await s.bot.tick();
  assert.equal(sends, 1); assert.equal(s.journal.get(s.signal.id).state, 'submitted');
  s.rpc.status = async signature => {
    assert.equal(signature, s.journal.get(s.signal.id).signature);
    return { value: [{ confirmationStatus: 'finalized', err: null }] };
  };
  await s.bot.tick();
  assert.equal(sends, 1); assert.equal(s.journal.get(s.signal.id).state, 'confirmed');
  assert.ok(s.reports.some(r => r.code === 'CONFIRMED'));
  assert.ok(s.reports.every(r => Object.keys(r).every(k => ['signalId', 'mint', 'status', 'code', 'signature'].includes(k))));
});

test('ambiguous send survives restart and blocks ALL replacement buys across days', async t => {
  const s = setup(t); let sends = 0, trades = 0;
  const trade = s.api.trade;
  s.api.trade = async mint => { trades++; return trade(mint); };
  s.rpc.send = async () => { sends++; throw new Error('provider response must never be logged'); };
  await s.bot.tick();
  const intended = s.journal.get(s.signal.id).signature;
  assert.ok(intended); assert.equal(s.journal.get(s.signal.id).state, 'unknown');
  s.journal.close();
  const restarted = new Journal(s.config);
  try {
    const tomorrow = s.signal.createdAt + 86400000;
    restarted.recover(tomorrow);
    s.rpc.status = async sig => { assert.equal(sig, intended); return { value: [null] }; };
    const bot = new Bot({ config: s.config, journal: restarted, rpc: s.rpc, api: s.api, signer: s.bot.signer,
      now: () => tomorrow, log: code => s.logs.push(code) });
    await bot.tick(); await bot.tick();
    assert.equal(sends, 1); assert.equal(trades, 1);
    assert.equal(restarted.get(s.signal.id).signature, intended);
    assert.throws(() => restarted.reserve({ id: 'other', mint: 'other' }, s.config, tomorrow), { code: 'CONFIRMATION_UNKNOWN' });
    s.rpc.status = async () => ({ value: [{ confirmationStatus: 'finalized', err: null }] });
    await bot.reconcile();
    assert.equal(restarted.get(s.signal.id).state, 'confirmed');
    assert.equal(restarted.db.prepare('SELECT spent FROM budgets WHERE day=?').get(Math.floor(tomorrow / 86400000)).spent, s.config.perTrade);
    assert.ok(s.logs.every(code => !code.includes('provider response')));
  } finally { restarted.close(); }
});

test('pre-sign crash burns reservation; post-sign/pre-send crash only reconciles', async t => {
  const s = setup(t), now = s.signal.createdAt;
  s.journal.reserve(s.signal, s.config, now);
  s.journal.recover(now);
  assert.equal(s.journal.get(s.signal.id).state, 'failed');
  const second = { ...s.signal, id: 'next', mint: 'other' };
  s.journal.reserve(second, s.config, now);
  s.journal.intended(second, '1'.repeat(64));
  s.journal.recover(now);
  assert.equal(s.journal.pending().length, 1);
  s.rpc.status = async () => ({ value: [{ confirmationStatus: 'confirmed', err: null }] });
  await s.bot.reconcile();
  assert.equal(s.journal.get(second.id).state, 'unknown');
  s.rpc.status = async () => ({ value: [{ confirmationStatus: 'finalized', err: { InstructionError: [2, { Custom: 6002 }] } }] });
  await s.bot.reconcile();
  assert.equal(s.journal.get(second.id).state, 'failed');
  assert.ok(s.logs.includes('SLIPPAGE_EXCEEDED'));
});

test('failed simulation cannot reach signer/send; reports have bounded persisted retries', async t => {
  const s = setup(t);
  s.rpc.simulate = async () => ({ value: { err: { InstructionError: [2, { Custom: 6002 }] } } });
  s.bot.signer = { sign() { assert.fail('must not sign'); } };
  s.rpc.send = async () => assert.fail('must not send');
  await s.bot.tick();
  assert.equal(s.journal.get(s.signal.id).state, 'rejected');
  assert.ok(s.reports.some(r => r.code === 'SLIPPAGE_EXCEEDED'));
  const body = { ...s.signal, id: 'report-only' };
  s.journal.enqueue(body, 'failed', 'RPC_ERROR');
  let attempts = 0, now = Date.now();
  s.api.report = async () => { attempts++; throw new Error('not logged'); };
  s.bot.now = () => now;
  for (let i = 0; i < 5; i++) { await s.bot.reports(); now += 300001; }
  assert.equal(attempts, 3);
  assert.ok(!readFileSync(join(s.config.stateDir, 'live.sqlite')).includes(Buffer.from('not logged')));
});

test('RPC returned signature mismatch is ambiguous, never a replacement send', async t => {
  const s = setup(t);
  let sends = 0;
  s.rpc.send = async () => { sends++; return 'wrong-public-signature'; };
  await s.bot.tick();
  assert.equal(s.journal.get(s.signal.id).state, 'unknown');
  s.rpc.status = async () => { throw new SafeError('RPC_ERROR'); };
  await s.bot.tick();
  assert.equal(sends, 1);
  assert.ok(s.logs.includes('CONFIRMATION_UNKNOWN'));
});

test('poll errors/429 back off safely and concurrent ticks are rejected', async t => {
  const s = setup(t, false);
  s.api.poll = async () => { throw new SafeError('RATE_LIMITED', 60000); };
  assert.equal(await s.bot.tick(), 60000);
  s.api.poll = async () => { throw new Error('untrusted-provider-message'); };
  await s.bot.tick(); assert.ok(s.logs.includes('PROVIDER_ERROR'));
  let release;
  s.api.poll = () => new Promise(resolve => { release = resolve; });
  const running = s.bot.tick();
  await assert.rejects(s.bot.tick(), { code: 'CONFIG_INVALID' });
  release(s.poll); await running;
});

test('429 pauses reports too, and an excessive Retry-After halts rather than retrying early', async t => {
  const s = setup(t, false);
  s.journal.enqueue(s.signal, 'dry_run', 'DRY_RUN');
  s.api.report = async () => assert.fail('credential-wide rate limit must pause reports');
  s.api.poll = async () => { throw new SafeError('RATE_LIMITED', 60000); };
  assert.equal(await s.bot.tick(), 60000);
  s.api.poll = async () => { throw new SafeError('RATE_LIMITED', 600000); };
  await s.bot.tick();
  assert.equal(s.bot.halted, true);
  await assert.rejects(s.bot.tick(), { code: 'CONFIG_INVALID' });
});