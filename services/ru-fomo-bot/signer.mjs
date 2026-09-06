// Operator-only module. Never import from frontend, Base44 functions, or shared wire constants.
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import { consumeApproval } from './validate.mjs';
import { ensure, SafeError, signatureBase58 } from './safety.mjs';

export function loadSigner(config, env = process.env) {
  ensure(config.live === true, 'CONFIG_INVALID');
  let secret;
  let values;
  let keypair;
  try {
    const encoded = env.RU_FOMO_SECRET_KEY_JSON;
    ensure(typeof encoded === 'string' && encoded.length <= 1024, 'CONFIG_INVALID');
    values = JSON.parse(encoded);
    ensure(Array.isArray(values) && values.length === 64 && values.every(v =>
      Number.isInteger(v) && v >= 0 && v <= 255), 'CONFIG_INVALID');
    secret = Uint8Array.from(values);
    keypair = Keypair.fromSecretKey(secret);
    ensure(keypair.publicKey.toBase58() === config.wallet, 'CONFIG_INVALID');
    let active = true;
    return Object.freeze({
      sign(ticket) {
        try {
          ensure(active && config.live === true, 'CONFIG_INVALID');
          const approved = consumeApproval(ticket);
          ensure(approved.wallet === keypair.publicKey.toBase58());
          const tx = VersionedTransaction.deserialize(approved.bytes);
          tx.sign([keypair]);
          return { signature: signatureBase58(tx.signatures[0]), bytes: tx.serialize() };
        } catch (error) { throw error instanceof SafeError ? error : new SafeError('TRANSACTION_REJECTED'); }
      },
      dispose() { active = false; secret.fill(0); keypair = undefined; },
    });
  } catch { secret?.fill(0); throw new SafeError('CONFIG_INVALID'); }
  finally { if (Array.isArray(values)) values.fill(0); }
}