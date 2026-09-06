import { SIGNAL_CODES, SIGNAL_STATUSES } from '../../base44/shared/ruFomoContract.js';

const codes = new Set(SIGNAL_CODES);
export class SafeError extends Error {
  constructor(code, retryAfterMs = 0, halt = false) {
    super(codes.has(code) ? code : 'INTERNAL_ERROR');
    this.code = this.message;
    this.retryAfterMs = Math.max(0, Math.min(300_000, retryAfterMs || 0));
    this.halt = halt || retryAfterMs > 300000;
  }
}
export function ensure(condition, code = 'TRANSACTION_REJECTED') {
  if (!condition) throw new SafeError(code);
}
export function safeCode(error, fallback = 'INTERNAL_ERROR') {
  return error instanceof SafeError && codes.has(error.code) ? error.code : fallback;
}
export function logCode(code, write = console.log) {
  write(JSON.stringify({ code: codes.has(code) ? code : 'INTERNAL_ERROR' }));
}
export function reportBody(signal, status, code, signature) {
  ensure(SIGNAL_STATUSES.includes(status) && codes.has(code), 'INTERNAL_ERROR');
  const body = { signalId: signal.id, mint: signal.mint, status, code };
  if (signature !== undefined) {
    ensure(typeof signature === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature));
    body.signature = signature;
  }
  return body;
}

// A tiny encoder for public signatures only; no new bs58 dependency or key decoding.
export function signatureBase58(bytes) {
  ensure(bytes.length === 64);
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = BigInt(`0x${Buffer.from(bytes).toString('hex')}`);
  let result = '';
  while (value) { result = alphabet[Number(value % 58n)] + result; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; result = '1' + result; }
  return result;
}