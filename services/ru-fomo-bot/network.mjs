import { ensure, SafeError, safeCode } from './safety.mjs';
import { httpsUrl } from './config.mjs';

export const LOCAL_TRADE_URL = 'https://pumpportal.fun/api/trade-local';
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function retryAfter(value, now = Date.now()) {
  if (!value) return 15000;
  const delay = /^[0-9]+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(1000, delay) : delay === Infinity ? Infinity : 15000;
}

// One attempt only. Timeout covers headers AND streaming body; never read an error body.
export async function boundedFetch(url, init = {}, {
  fetchImpl = globalThis.fetch, maxBytes = 262144, timeoutMs = 10000, code = 'PROVIDER_ERROR',
} = {}) {
  const controller = new AbortController();
  let timer;
  let reader;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new SafeError(code)); }, timeoutMs);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const response = await fetchImpl(url, { ...init, redirect: 'error', signal: controller.signal });
      ensure(!controller.signal.aborted, code);
      ensure(!response.redirected, code);
      if (response.status === 429) throw new SafeError('RATE_LIMITED', retryAfter(response.headers.get('retry-after')));
      if (response.status === 401 || response.status === 403) throw new SafeError('AUTH_REQUIRED');
      ensure(response.status >= 200 && response.status < 300, code);
      const size = response.headers.get('content-length');
      ensure(!size || (/^[0-9]+$/.test(size) && Number(size) <= maxBytes), code);
      ensure(response.body, code);
      reader = response.body.getReader();
      const chunks = [];
      let length = 0;
      for (;;) {
        ensure(!controller.signal.aborted, code);
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        ensure(length <= maxBytes, code);
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks, length);
    })()]);
  } catch (error) {
    throw new SafeError(safeCode(error, code), error instanceof SafeError ? error.retryAfterMs : 0,
      error instanceof SafeError && error.halt);
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
  }
}

function json(bytes, code) {
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new SafeError(code); }
}

export function createApi(config, fetchImpl = globalThis.fetch) {
  const base = httpsUrl(config.base);
  ensure(base.pathname === '/functions/' && base.origin === config.allowedOrigin, 'CONFIG_INVALID');
  const headers = { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' };
  return {
    async poll() {
      return json(await boundedFetch(new URL('ruFomoSignals', base).href, { headers }, { fetchImpl }), 'INVALID_SIGNAL');
    },
    async report(body) {
      await boundedFetch(new URL('ruFomoReport', base).href,
        { method: 'POST', headers, body: JSON.stringify(body) }, { fetchImpl, maxBytes: 8192, code: 'REPORT_FAILED' });
    },
    async trade(mint) {
      // No credential, private key, or remotely supplied route enters this body.
      return boundedFetch(LOCAL_TRADE_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKey: config.wallet, action: 'buy', mint,
          denominatedInSol: 'true', amount: config.amount / 1e9,
          slippage: config.slippageBps / 100, priorityFee: config.priorityFee / 1e9, pool: 'pump' }),
      }, { fetchImpl, maxBytes: 1232 });
    },
  };
}

// Avoid Connection's hidden retries and provider exception strings. Signed bytes go ONLY to sendTransaction.
export function createRpc(config, fetchImpl = globalThis.fetch) {
  const url = httpsUrl(config.rpc, true).href;
  let sequence = 0;
  async function call(method, params) {
    const id = ++sequence;
    const body = json(await boundedFetch(url, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    }, { fetchImpl, maxBytes: 262144, code: 'RPC_ERROR' }), 'RPC_ERROR');
    ensure(body && body.jsonrpc === '2.0' && body.id === id && !body.error && 'result' in body, 'RPC_ERROR');
    return body.result;
  }
  return {
    genesis: () => call('getGenesisHash', []),
    rent: length => call('getMinimumBalanceForRentExemption', [length, { commitment: 'confirmed' }]),
    accounts: (keys, minContextSlot = 0) => call('getMultipleAccounts', [keys, {
      encoding: 'base64', commitment: 'confirmed', minContextSlot,
    }]),
    fee: (message, minContextSlot) => call('getFeeForMessage', [message, { commitment: 'confirmed', minContextSlot }]),
    simulate: (bytes, keys, minContextSlot) => call('simulateTransaction', [Buffer.from(bytes).toString('base64'), {
      encoding: 'base64', commitment: 'confirmed', sigVerify: false, replaceRecentBlockhash: false,
      minContextSlot, accounts: { encoding: 'base64', addresses: keys },
    }]),
    // Exactly one RPC send; the journal records the local signature first. Never replace a timed-out buy.
    send: bytes => call('sendTransaction', [Buffer.from(bytes).toString('base64'), {
      encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0,
    }]),
    status: signature => call('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]),
  };
}