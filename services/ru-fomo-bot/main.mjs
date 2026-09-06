import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readConfig } from './config.mjs';
import { Journal } from './journal.mjs';
import { createApi, createRpc, sleep } from './network.mjs';
import { Bot } from './bot.mjs';
import { MAINNET_GENESIS } from './validate.mjs';
import { ensure, logCode, safeCode } from './safety.mjs';

export async function main({ env = process.env, signal, fetchImpl = globalThis.fetch } = {}) {
  let journal, signer;
  try {
    const config = readConfig(env);
    journal = new Journal(config);
    const api = createApi(config, fetchImpl);
    const rpc = config.live ? createRpc(config, fetchImpl) : undefined;
    if (config.live) {
      ensure(await rpc.genesis() === MAINNET_GENESIS, 'CONFIG_INVALID');
      // The operator key module is never loaded for dry-run and lives outside src/Base44.
      const { loadSigner } = await import('./signer.mjs');
      signer = loadSigner(config, env);
    }
    journal.recover(Date.now());
    const bot = new Bot({ config, journal, api, rpc, signer, stopSignal: signal });
    while (!signal?.aborted) {
      const delay = await bot.tick();
      if (bot.halted) return 1;
      // Short interruptible sleep slices; no forced exit during signature journaling/submission.
      for (let left = delay; left > 0 && !signal?.aborted; left -= 250) await sleep(Math.min(left, 250));
    }
  } catch (error) {
    logCode(safeCode(error));
    return 1;
  } finally { signer?.dispose(); journal?.close(); }
  return 0;
}

// Imports in offline tests never poll, read a key, fund, or submit a transaction.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  main({ signal: controller.signal }).then(code => { process.exitCode = code; }, () => {
    logCode('INTERNAL_ERROR'); process.exitCode = 1;
  });
}