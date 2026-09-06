import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Keypair, ComputeBudgetProgram, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { readConfig } from '../services/ru-fomo-bot/config.mjs';
import { BUY_EXACT_SOL, PUMP, FEE_PROGRAM, deriveContext, discriminator, pda } from '../services/ru-fomo-bot/validate.mjs';

export function stateDirectory(t) {
  const root = process.env.TMPDIR || process.env.TMP || process.env.TEMP;
  if (!root) throw new Error('Tests require the per-session temporary directory');
  const path = mkdtempSync(join(realpathSync(root), 'ru-fomo-bot-'));
  t.after(() => rmSync(path, { recursive: true }));
  return path;
}
export function fixture() {
  // Ephemeral test-only identities. Never print or persist the generated secret.
  const keypair = Keypair.generate(), mint = Keypair.generate().publicKey, creator = Keypair.generate().publicKey;
  const env = { RU_FOMO_BASE_URL: 'https://operator.example.com/functions/',
    RU_FOMO_ALLOWED_ORIGIN: 'https://operator.example.com', RU_FOMO_API_KEY: 'offline-test-bearer-placeholder-0000',
    RU_FOMO_LIVE: 'true', RU_FOMO_WALLET_PUBLIC_KEY: keypair.publicKey.toBase58(),
    RU_FOMO_RPC_URL: 'https://rpc.example.com/', RU_FOMO_ALLOWED_MINTS: mint.toBase58(),
    RU_FOMO_BUY_LAMPORTS: '1000000', RU_FOMO_MAX_TRADE_LAMPORTS: '3000000', RU_FOMO_DAILY_LAMPORTS: '9000000',
    RU_FOMO_RESERVE_LAMPORTS: '10000000', RU_FOMO_MAX_FEE_LAMPORTS: '100000',
    RU_FOMO_PRIORITY_FEE_LAMPORTS: '10000', RU_FOMO_SLIPPAGE_BPS: '100', RU_FOMO_COOLDOWN_MS: '3600000' };
  const config = readConfig(env);
  const account = (owner, data = Buffer.alloc(0), lamports = 2000000, executable = false) => ({ owner, data, lamports, executable });
  const raw = a => a === null ? null : ({ ...a, owner: a.owner.toBase58(), data: [a.data.toString('base64'), 'base64'] });
  const named = (name, length, owner = PUMP) => {
    const data = Buffer.alloc(length); discriminator(name).copy(data); return account(owner, data);
  };
  const global = named('Global', 1045), curve = named('BondingCurve', 115);
  Keypair.generate().publicKey.toBuffer().copy(global.data, 41);
  creator.toBuffer().copy(curve.data, 49);
  curve.data.writeBigUInt64LE(100000000n, 8);
  curve.data.writeBigUInt64LE(100000000n, 16);
  const context = deriveContext(mint, keypair.publicKey, global, curve);
  const token = (owner, amount) => {
    const data = Buffer.alloc(165);
    mint.toBuffer().copy(data, 0); owner.toBuffer().copy(data, 32); data.writeBigUInt64LE(amount, 64); data[108] = 1;
    return account(TOKEN_PROGRAM_ID, data);
  };
  const mintData = Buffer.alloc(82); mintData.writeBigUInt64LE(1000000000n, 36); mintData[44] = 6; mintData[45] = 1;
  const accumulator = named('UserVolumeAccumulator', 137); keypair.publicKey.toBuffer().copy(accumulator.data, 8);
  const executable = () => account(SystemProgram.programId, Buffer.alloc(0), 1, true);
  const before = [global, account(SystemProgram.programId), account(TOKEN_PROGRAM_ID, mintData), curve,
    token(context.bondingCurve, 100000000n), token(keypair.publicKey, 100n), account(SystemProgram.programId, Buffer.alloc(0), 1000000000),
    executable(), executable(), account(SystemProgram.programId), null, executable(),
    named('GlobalVolumeAccumulator', 8), accumulator, named('FeeConfig', 8, FEE_PROGRAM), executable()];
  const after = before.map(a => a && { ...a, data: Buffer.from(a.data) });
  after[5].data.writeBigUInt64LE(1100n, 64);
  after[4].data.writeBigUInt64LE(99999000n, 64);
  after[6].lamports -= config.amount + 5200;
  const buyData = Buffer.alloc(25); BUY_EXACT_SOL.copy(buyData);
  buyData.writeBigUInt64LE(BigInt(config.amount), 8); buyData.writeBigUInt64LE(990n, 16);
  const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
    new TransactionInstruction({ programId: PUMP, data: buyData, keys: context.keys.map(pubkey => ({
      pubkey, isSigner: pubkey.equals(keypair.publicKey), isWritable: context.writable.has(pubkey.toBase58()),
    })) })];
  const transaction = (ixs = instructions, payer = keypair.publicKey) => new VersionedTransaction(new TransactionMessage({
    payerKey: payer, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: ixs,
  }).compileToV0Message());
  const at = Date.now();
  const signal = { id: `RU_FOMO:${Math.floor(at / 300000)}:${mint.toBase58()}`, mint: mint.toBase58(),
    action: 'buy', baseAsset: 'SOL', createdAt: at, expiresAt: at + 300000, reason: 'volume_and_momentum',
    metrics: { volume24hUsd: 1000000, marketCapUsd: null, change24hPct: 20, liquidityUsd: 50000 } };
  const poll = { schemaVersion: 1, namespace: 'RU_FOMO', at, stale: false, enabled: true, signals: [signal] };
  const rpc = {
    async rent() { return 890880; },
    async accounts(keys) { return { context: { slot: 100 }, value: keys.map(key => raw(before[context.keys.findIndex(k => k.toBase58() === key)])) }; },
    async fee() { return { context: { slot: 100 }, value: 5200 }; },
    async simulate() { return { context: { slot: 100 }, value: { err: null, unitsConsumed: 100000, accounts: after.map(raw) } }; },
  };
  return { keypair, mint, env, config, context, before, after, raw, signal, poll, rpc, transaction, instructions, pda };
}