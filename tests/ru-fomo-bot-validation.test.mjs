import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublicKey, verify } from 'node:crypto';
import { Keypair, SystemProgram, ComputeBudgetProgram } from '@solana/web3.js';
import { createApproveInstruction, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { inspectTransaction, validateAndSimulate, deriveContext, consumeApproval, simulationCode } from '../services/ru-fomo-bot/validate.mjs';
import { loadSigner } from '../services/ru-fomo-bot/signer.mjs';
import { SafeError } from '../services/ru-fomo-bot/safety.mjs';
import { fixture } from './ru-fomo-bot-fixtures.mjs';

test('strict supported buy validates, simulates unsigned, and signs once locally', async () => {
  const f = fixture(), tx = f.transaction();
  assert.equal(inspectTransaction(tx.serialize(), f.context, f.config).amount, 1000000n);
  const simulate = f.rpc.simulate;
  f.rpc.simulate = async bytes => {
    assert.ok(Buffer.from(bytes).equals(Buffer.from(tx.serialize())));
    assert.ok(tx.signatures[0].every(byte => byte === 0));
    return simulate();
  };
  const ticket = await validateAndSimulate(tx.serialize(), f.signal, f.config, f.rpc);
  const signer = loadSigner(f.config, { RU_FOMO_SECRET_KEY_JSON: JSON.stringify([...f.keypair.secretKey]) });
  const result = signer.sign(ticket);
  assert.match(result.signature, /^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'),
    f.keypair.publicKey.toBuffer()]), format: 'der', type: 'spki' });
  assert.equal(verify(null, tx.message.serialize(), publicKey, result.bytes.slice(1, 65)), true);
  assert.throws(() => signer.sign(ticket), SafeError);
  assert.throws(() => signer.sign({ bytes: tx.serialize() }), SafeError);
  signer.dispose();
  assert.throws(() => signer.sign(ticket), SafeError);
});

const attacks = {
  'extra SOL transfer': f => f.instructions.push(SystemProgram.transfer({ fromPubkey: f.keypair.publicKey,
    toPubkey: Keypair.generate().publicKey, lamports: 1 })),
  'token approval': f => f.instructions.push(createApproveInstruction(f.context.userAta,
    Keypair.generate().publicKey, f.keypair.publicKey, 1)),
  'substituted mint': f => { f.instructions[2].keys[2].pubkey = Keypair.generate().publicKey; },
  'substituted recipient ATA': f => { f.instructions[2].keys[5].pubkey = Keypair.generate().publicKey; },
  'substituted creator vault': f => { f.instructions[2].keys[9].pubkey = Keypair.generate().publicKey; },
  'substituted fee recipient': f => { f.instructions[2].keys[1].pubkey = Keypair.generate().publicKey; },
  'extra signer': f => { f.instructions[2].keys[2].isSigner = true; },
  'writable mint': f => { f.instructions[2].keys[2].isWritable = true; },
  'extra remaining account': f => f.instructions[2].keys.push(f.instructions[2].keys[5]),
  'overspend': f => f.instructions[2].data.writeBigUInt64LE(1000001n, 8),
  'zero min output': f => f.instructions[2].data.writeBigUInt64LE(0n, 16),
  'sell or unknown instruction': f => { f.instructions[2].data[0] ^= 1; },
  'unknown argument tail': f => { f.instructions[2].data = Buffer.concat([f.instructions[2].data, Buffer.from([0])]); },
  'volume tracking variant': f => { f.instructions[2].data[24] = 1; },
  'too many compute units': f => { f.instructions[0] = ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }); },
  'excessive compute price': f => { f.instructions[1] = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000000000n }); },
  'heap frame instruction': f => { f.instructions[0] = ComputeBudgetProgram.requestHeapFrame({ bytes: 32768 }); },
};
for (const [name, attack] of Object.entries(attacks)) test(`rejects malicious tx: ${name}`, () => {
  const f = fixture(); attack(f);
  assert.throws(() => inspectTransaction(f.transaction().serialize(), f.context, f.config), SafeError);
});

test('rejects alternate payer, signed input, lookup tables, trailing bytes, and oversized payload', () => {
  const f = fixture();
  assert.throws(() => inspectTransaction(f.transaction(f.instructions, Keypair.generate().publicKey).serialize(), f.context, f.config));
  const tx = f.transaction(); tx.sign([f.keypair]);
  assert.throws(() => inspectTransaction(tx.serialize(), f.context, f.config));
  const lookup = f.transaction();
  lookup.message.addressTableLookups = [{ accountKey: Keypair.generate().publicKey, writableIndexes: [], readonlyIndexes: [] }];
  assert.throws(() => inspectTransaction(lookup.serialize(), f.context, f.config));
  assert.throws(() => inspectTransaction(Buffer.concat([f.transaction().serialize(), Buffer.from([0])]), f.context, f.config));
  assert.throws(() => inspectTransaction(Buffer.alloc(1233), f.context, f.config));
});

for (const [name, mutate] of Object.entries({
  graduated: f => { f.before[3].data[48] = 1; },
  mayhem: f => { f.before[3].data[81] = 1; },
  cashback: f => { f.before[3].data[82] = 1; },
  'non-SOL quote': f => { f.before[3].data[83] = 1; },
  'buyback variant': f => f.before[0].data.writeBigUInt64LE(1n, 997),
  'Token-2022 mint': f => { f.before[2].owner = TOKEN_2022_PROGRAM_ID; },
  'mint authority': f => { f.before[2].data[0] = 1; },
  'frozen token': f => { f.before[5].data[108] = 2; },
  'delegate present': f => { f.before[5].data[72] = 1; },
  'wrong token owner': f => Keypair.generate().publicKey.toBuffer().copy(f.before[5].data, 32),
  'wrong token mint': f => Keypair.generate().publicKey.toBuffer().copy(f.before[5].data, 0),
  'post-simulation delegate': f => { f.after[5].data[72] = 1; },
  'post-simulation close authority': f => { f.after[5].data[129] = 1; },
  'zero token credit': f => f.after[5].data.writeBigUInt64LE(100n, 64),
  'excessive debit': f => { f.after[6].lamports -= f.config.perTrade; },
  'rent change': f => { f.after[13].lamports += 1; },
  'low SOL reserve': f => { f.before[6].lamports = f.config.reserve; },
  'low minimum relative to quote': f => f.instructions[2].data.writeBigUInt64LE(1n, 16),
})) test(`simulation/state rejects: ${name}`, async () => {
  const f = fixture(); mutate(f);
  await assert.rejects(validateAndSimulate(f.transaction().serialize(), f.signal, f.config, f.rpc), SafeError);
});

test('simulation error and slippage are fixed enum codes; inconsistent slots fail closed', async () => {
  const f = fixture();
  f.rpc.simulate = async () => ({ value: { err: { InstructionError: [2, { Custom: 6002 }] }, logs: ['untrusted text'] } });
  await assert.rejects(validateAndSimulate(f.transaction().serialize(), f.signal, f.config, f.rpc), { code: 'SLIPPAGE_EXCEEDED' });
  assert.equal(simulationCode({ arbitrary: 'sensitive' }), 'SIMULATION_FAILED');
  f.rpc.simulate = async () => ({ context: { slot: 101 }, value: { err: null, unitsConsumed: 100,
    accounts: f.after.map(f.raw) } });
  await assert.rejects(validateAndSimulate(f.transaction().serialize(), f.signal, f.config, f.rpc), { code: 'RPC_ERROR' });
});

test('immutable one-use evidence, expiration, and invalid keys are rejected', async () => {
  const f = fixture();
  const bytes = f.transaction().serialize(), original = Buffer.from(bytes);
  const fee = f.rpc.fee;
  f.rpc.fee = async () => { bytes.fill(0); return fee(); };
  const ticket = await validateAndSimulate(bytes, f.signal, f.config, f.rpc);
  assert.ok(consumeApproval(ticket).bytes.equals(original));
  assert.throws(() => consumeApproval(ticket));
  await assert.rejects(validateAndSimulate(original, { ...f.signal, expiresAt: 1 }, f.config, f.rpc), { code: 'EXPIRED_SIGNAL' });
  assert.throws(() => loadSigner({ ...f.config, live: false }, {}), { code: 'CONFIG_INVALID' });
  for (const value of ['malformed', '[]', JSON.stringify(new Array(64).fill(256)), JSON.stringify(new Array(64).fill(0))]) {
    assert.throws(() => loadSigner(f.config, { RU_FOMO_SECRET_KEY_JSON: value }), { code: 'CONFIG_INVALID' });
  }
  assert.throws(() => deriveContext(f.mint, f.keypair.publicKey, f.before[0], { ...f.before[3], data: Buffer.alloc(115) }));
});