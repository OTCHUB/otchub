import { createHash } from 'node:crypto';
import { ComputeBudgetProgram, PublicKey, SystemProgram, VersionedTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, unpackAccount, unpackMint } from '@solana/spl-token';
import { ensure, SafeError } from './safety.mjs';
import { RENT_HEADROOM } from './config.mjs';

export const PUMP = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
export const FEE_PROGRAM = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');
export const BUY_EXACT_SOL = Buffer.from([56, 252, 116, 8, 158, 223, 205, 95]);
export const MAX_UNITS = 300000;
export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
export const pda = (name, seeds = [], program = PUMP) =>
  PublicKey.findProgramAddressSync([Buffer.from(name), ...seeds.map(s => s.toBuffer())], program)[0];
export const discriminator = name => createHash('sha256').update(`account:${name}`).digest().subarray(0, 8);
const same = (a, b) => a.equals(b);

export function decodeAccount(raw) {
  ensure(raw && typeof raw.owner === 'string' && typeof raw.executable === 'boolean' &&
    Number.isSafeInteger(raw.lamports) && raw.lamports >= 0 && Array.isArray(raw.data) &&
    raw.data.length === 2 && raw.data[1] === 'base64' && typeof raw.data[0] === 'string' &&
    raw.data[0].length <= 16384, 'RPC_ERROR');
  const data = Buffer.from(raw.data[0], 'base64');
  ensure(data.toString('base64') === raw.data[0], 'RPC_ERROR');
  return { ...raw, owner: new PublicKey(raw.owner), data };
}
function programAccount(account, owner, name, minimum) {
  ensure(account && !account.executable && same(account.owner, owner) &&
    account.data.length >= minimum && account.data.subarray(0, 8).equals(discriminator(name)));
}
function plainWallet(account) {
  ensure(account && same(account.owner, SystemProgram.programId) && !account.executable && account.data.length === 0);
}
function tokenAccount(key, info, mint, owner) {
  ensure(info.data.length === 165 && !info.executable);
  const account = unpackAccount(key, info, TOKEN_PROGRAM_ID);
  ensure(same(account.mint, mint) && same(account.owner, owner) && account.isInitialized && !account.isFrozen &&
    !account.isNative && !account.delegate && !account.closeAuthority && account.delegatedAmount === 0n);
  // Require canonical initialized/absent-option encoding, not any nonzero state accepted by SDK unpacking.
  ensure(info.data[108] === 1 && info.data.readUInt32LE(72) === 0 && info.data.readUInt32LE(109) === 0 &&
    info.data.readUInt32LE(129) === 0);
  return account;
}

// Reviewed read-only against pump-public-docs/main/idl/pump.json, 2026-09-06.
// Only 16-account buy_exact_sol_in + OptionBool(false), legacy SPL, native-SOL curve.
export function deriveContext(mint, wallet, global, curve) {
  programAccount(global, PUMP, 'Global', 1045);
  programAccount(curve, PUMP, 'BondingCurve', 115);
  ensure(curve.data.length === 115 && curve.data[48] === 0 && curve.data[81] === 0 && curve.data[82] === 0 &&
    curve.data.subarray(83, 115).every(v => v === 0), 'UNSUPPORTED_POOL');
  // This variant does not model extra buyback recipients, rent top-ups, or mayhem/cashback.
  ensure(global.data.readBigUInt64LE(997) === 0n, 'UNSUPPORTED_POOL');
  const creator = new PublicKey(curve.data.subarray(49, 81));
  ensure(!same(creator, PublicKey.default), 'UNSUPPORTED_POOL');
  const bondingCurve = pda('bonding-curve', [mint]);
  const userAta = getAssociatedTokenAddressSync(mint, wallet);
  const curveAta = getAssociatedTokenAddressSync(mint, bondingCurve, true);
  const feeRecipient = new PublicKey(global.data.subarray(41, 73));
  const keys = [pda('global'), feeRecipient, mint, bondingCurve, curveAta, userAta, wallet,
    SystemProgram.programId, TOKEN_PROGRAM_ID, pda('creator-vault', [creator]), pda('__event_authority'), PUMP,
    pda('global_volume_accumulator'), pda('user_volume_accumulator', [wallet]),
    pda('fee_config', [PUMP], FEE_PROGRAM), FEE_PROGRAM];
  ensure(new Set(keys.map(k => k.toBase58())).size === keys.length);
  return { keys, wallet, mint, userAta, curveAta, bondingCurve,
    writable: new Set([1, 3, 4, 5, 6, 9, 13].map(i => keys[i].toBase58())) };
}

export function inspectTransaction(bytes, context, config) {
  try {
    ensure(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= 1232);
    const tx = VersionedTransaction.deserialize(bytes);
    ensure(tx.version === 0 && tx.message.addressTableLookups.length === 0, 'UNSUPPORTED_POOL');
    ensure(Buffer.from(tx.serialize()).equals(Buffer.from(bytes)));
    const m = tx.message;
    ensure(m.header.numRequiredSignatures === 1 && m.header.numReadonlySignedAccounts === 0 &&
      same(m.staticAccountKeys[0], context.wallet) && tx.signatures.length === 1 && tx.signatures[0].every(b => b === 0));
    const expected = new Set([...context.keys.map(k => k.toBase58()), ComputeBudgetProgram.programId.toBase58()]);
    ensure(m.staticAccountKeys.length === expected.size && m.staticAccountKeys.length <= 20 &&
      new Set(m.staticAccountKeys.map(k => k.toBase58())).size === expected.size && m.compiledInstructions.length === 3);
    m.staticAccountKeys.forEach((key, i) => {
      ensure(expected.has(key.toBase58()), 'PROGRAM_NOT_ALLOWED');
      ensure(m.isAccountWritable(i) === context.writable.has(key.toBase58()) && m.isAccountSigner(i) === (i === 0));
    });
    const [limit, price, buy] = m.compiledInstructions;
    for (const ix of [limit, price]) ensure(same(m.staticAccountKeys[ix.programIdIndex], ComputeBudgetProgram.programId) && ix.accountKeyIndexes.length === 0);
    const limitData = Buffer.from(limit.data), priceData = Buffer.from(price.data);
    ensure(limitData.length === 5 && limitData[0] === 2 && priceData.length === 9 && priceData[0] === 3);
    const units = limitData.readUInt32LE(1), microLamports = priceData.readBigUInt64LE(1);
    ensure(units > 0 && units <= MAX_UNITS);
    const priority = (BigInt(units) * microLamports + 999999n) / 1000000n;
    ensure(priority <= BigInt(config.priorityFee) && priority + 5000n <= BigInt(config.maxFee), 'BUDGET_EXCEEDED');
    ensure(same(m.staticAccountKeys[buy.programIdIndex], PUMP), 'PROGRAM_NOT_ALLOWED');
    ensure(buy.accountKeyIndexes.length === context.keys.length, 'UNSUPPORTED_POOL');
    buy.accountKeyIndexes.forEach((index, i) => ensure(same(m.staticAccountKeys[index], context.keys[i])));
    const data = Buffer.from(buy.data);
    ensure(data.length === 25 && data.subarray(0, 8).equals(BUY_EXACT_SOL) && data[24] === 0, 'UNSUPPORTED_POOL');
    const amount = data.readBigUInt64LE(8), minOut = data.readBigUInt64LE(16);
    ensure(amount === BigInt(config.amount) && minOut > 0n);
    return { tx, amount, minOut, units, priority, context };
  } catch (error) {
    throw error instanceof SafeError ? error : new SafeError('TRANSACTION_REJECTED');
  }
}

function snapshot(response, keys, minimum = 0) {
  ensure(response && Number.isSafeInteger(response.context?.slot) && response.context.slot >= minimum &&
    Array.isArray(response.value) && response.value.length === keys.length, 'RPC_ERROR');
  return { slot: response.context.slot, accounts: response.value.map(raw => raw === null ? null : decodeAccount(raw)) };
}
function validateState(context, state) {
  const a = state.accounts;
  const fresh = deriveContext(context.mint, context.wallet, a[0], a[3]);
  ensure(fresh.keys.every((k, i) => same(k, context.keys[i])));
  ensure(a[2].data.length === 82 && !a[2].executable);
  const mint = unpackMint(context.mint, a[2], TOKEN_PROGRAM_ID);
  ensure(mint.isInitialized && !mint.freezeAuthority && !mint.mintAuthority && mint.supply > 0n, 'TOKEN_NOT_ALLOWED');
  tokenAccount(context.curveAta, a[4], context.mint, context.bondingCurve);
  const user = tokenAccount(context.userAta, a[5], context.mint, context.wallet);
  plainWallet(a[6]); plainWallet(a[1]); plainWallet(a[9]);
  ensure(a[9].lamports > 0, 'UNSUPPORTED_POOL');
  programAccount(a[12], PUMP, 'GlobalVolumeAccumulator', 8);
  programAccount(a[13], PUMP, 'UserVolumeAccumulator', 106);
  ensure(a[13].data.subarray(8, 40).equals(context.wallet.toBuffer()));
  programAccount(a[14], FEE_PROGRAM, 'FeeConfig', 8);
  for (const i of [7, 8, 11, 15]) ensure(a[i].executable);
  return user;
}

export function simulationCode(error) {
  const custom = error?.InstructionError?.[1]?.Custom;
  // Official Pump IDL TooMuchSolRequired / TooLittleSolReceived.
  return custom === 6002 || custom === 6003 ? 'SLIPPAGE_EXCEEDED' : 'SIMULATION_FAILED';
}

// Evidence is minted only by this validator, bound to immutable bytes, and consumed once by signer.
const approvals = new WeakMap();
export function consumeApproval(ticket) {
  const approved = approvals.get(ticket);
  approvals.delete(ticket);
  ensure(approved && Date.now() <= approved.expiresAt, 'EXPIRED_SIGNAL');
  return approved;
}
export async function validateAndSimulate(bytes, signal, config, rpc, now = Date.now) {
  try {
    ensure(bytes instanceof Uint8Array && bytes.length <= 1232);
    bytes = Buffer.from(bytes);
    const mint = new PublicKey(signal.mint), wallet = new PublicKey(config.wallet);
    ensure(config.live && config.mints.has(signal.mint), 'TOKEN_NOT_ALLOWED');
    ensure(signal.expiresAt > now(), 'EXPIRED_SIGNAL');
    const firstKeys = [pda('global'), pda('bonding-curve', [mint])];
    const initial = snapshot(await rpc.accounts(firstKeys.map(k => k.toBase58())), firstKeys);
    const context = deriveContext(mint, wallet, ...initial.accounts);
    const inspected = inspectTransaction(bytes, context, config);
    const keys = context.keys.map(k => k.toBase58());
    const before = snapshot(await rpc.accounts(keys, initial.slot), keys, initial.slot);
    const userBefore = validateState(context, before);
    const rent = await rpc.rent(0);
    ensure(Number.isSafeInteger(rent) && rent > 0 && rent <= RENT_HEADROOM &&
      before.accounts[9].lamports >= rent && config.amount + config.maxFee + rent <= config.perTrade, 'BUDGET_EXCEEDED');
    const fee = await rpc.fee(Buffer.from(inspected.tx.message.serialize()).toString('base64'), before.slot);
    ensure(Number.isSafeInteger(fee?.value) && fee.value >= 5000 && fee.value <= config.maxFee &&
      Number.isSafeInteger(fee.context?.slot) && fee.context.slot >= before.slot, 'BUDGET_EXCEEDED');
    ensure(before.accounts[6].lamports >= config.reserve + config.perTrade, 'INSUFFICIENT_SOL');
    const simulated = await rpc.simulate(bytes, keys, fee.context.slot);
    ensure(simulated?.value && simulated.value.err === null, simulationCode(simulated?.value?.err));
    ensure(Number.isSafeInteger(simulated.value.unitsConsumed) && simulated.value.unitsConsumed > 0 &&
      simulated.value.unitsConsumed <= inspected.units, 'SIMULATION_FAILED');
    const after = snapshot({ context: simulated.context, value: simulated.value.accounts }, keys, fee.context.slot);
    // State snapshots and simulation must use the SAME slot; never compare balances across banks.
    ensure(before.slot === after.slot && fee.context.slot === before.slot, 'RPC_ERROR');
    for (let i = 0; i < keys.length; i++) {
      if (i === 10 && before.accounts[i] === null && after.accounts[i] === null) continue;
      ensure(before.accounts[i] && after.accounts[i] && same(before.accounts[i].owner, after.accounts[i].owner) &&
        before.accounts[i].executable === after.accounts[i].executable);
    }
    const userAfter = tokenAccount(context.userAta, after.accounts[5], mint, wallet);
    const curveAfter = tokenAccount(context.curveAta, after.accounts[4], mint, context.bondingCurve);
    const curveBefore = tokenAccount(context.curveAta, before.accounts[4], mint, context.bondingCurve);
    plainWallet(after.accounts[6]);
    const credit = userAfter.amount - userBefore.amount;
    ensure(credit > 0n && credit >= inspected.minOut && curveBefore.amount - curveAfter.amount === credit, 'SLIPPAGE_EXCEEDED');
    const minimum = (credit * BigInt(10000 - config.slippageBps) + 9999n) / 10000n;
    ensure(inspected.minOut >= minimum, 'SLIPPAGE_EXCEEDED');
    const debit = before.accounts[6].lamports - after.accounts[6].lamports;
    ensure(debit === config.amount + fee.value && debit <= config.perTrade &&
      after.accounts[6].lamports >= config.reserve, 'INSUFFICIENT_SOL');
    // No ATA rent or volume-accumulator rent is permitted in this pre-initialized variant.
    for (const i of [5, 13]) ensure(after.accounts[i].lamports === before.accounts[i].lamports);
    // Read-only accounts must not change. Also deny token delegate/authority mutations above.
    for (let i = 0; i < keys.length; i++) if (!context.writable.has(keys[i])) {
      if (i === 10 && before.accounts[i] === null && after.accounts[i] === null) continue;
      ensure(after.accounts[i].data.equals(before.accounts[i].data) &&
        after.accounts[i].lamports === before.accounts[i].lamports && same(after.accounts[i].owner, before.accounts[i].owner));
    }
    ensure(signal.expiresAt > now(), 'EXPIRED_SIGNAL');
    const ticket = Object.freeze({});
    approvals.set(ticket, { bytes: Buffer.from(bytes), wallet: wallet.toBase58(),
      expiresAt: Math.min(signal.expiresAt, now() + 2000) });
    return ticket;
  } catch (error) { throw error instanceof SafeError ? error : new SafeError('TRANSACTION_REJECTED'); }
}