import { validatePoll } from './signals.mjs';
import { validateAndSimulate, simulationCode } from './validate.mjs';
import { ensure, logCode, SafeError, safeCode } from './safety.mjs';

export class Bot {
  constructor({ config, journal, api, rpc, signer, stopSignal, validate = validateAndSimulate, now = Date.now, log = logCode }) {
    Object.assign(this, { config, journal, api, rpc, signer, stopSignal, validate, now, log });
    this.running = false;
    this.halted = false;
    this.rateLimited = false;
    this.delayMs = config.pollMs;
  }
  notice(error, fallback = 'INTERNAL_ERROR') {
    this.log(safeCode(error, fallback));
    if (error instanceof SafeError) {
      this.delayMs = Math.max(this.delayMs, error.retryAfterMs);
      this.halted ||= error.halt;
      this.rateLimited ||= error.code === 'RATE_LIMITED';
    }
  }
  async reconcile() {
    for (const row of this.journal.pending()) {
      try {
        ensure(this.config.live && this.rpc && row.signature, 'CONFIRMATION_UNKNOWN');
        const result = await this.rpc.status(row.signature);
        ensure(result && Array.isArray(result.value) && result.value.length === 1, 'RPC_ERROR');
        const status = result.value[0];
        // Null, processed, confirmed-only and lookup errors are NOT proof of non-execution.
        if (!status || status.confirmationStatus !== 'finalized') {
          this.journal.finish(row, 'unknown', 'CONFIRMATION_UNKNOWN', this.now());
          this.log('CONFIRMATION_UNKNOWN');
          continue;
        }
        ensure(Object.hasOwn(status, 'err'), 'RPC_ERROR');
        const failed = status.err !== null;
        const code = failed ? simulationCode(status.err) : 'CONFIRMED';
        this.journal.finish(row, failed ? 'failed' : 'confirmed', code, this.now());
        this.log(code);
      } catch (error) { this.notice(error, 'RPC_ERROR'); }
    }
  }
  async reports() {
    for (const row of this.journal.reports(this.now())) {
      // Count before request; ambiguous HTTP success can cause duplicate append-only reports, never a duplicate trade.
      this.journal.reportAttempt(row.id, this.now());
      try { await this.api.report(JSON.parse(row.body)); this.journal.reportSent(row.id); }
      catch (error) { this.notice(error, 'REPORT_FAILED'); this.log('REPORT_FAILED'); break; }
    }
  }
  async execute(signal) {
    let reserved = false;
    let intended = false;
    try {
      if (this.stopSignal?.aborted) return;
      ensure(signal.expiresAt > this.now(), 'EXPIRED_SIGNAL');
      ensure(!this.config.mints.size || this.config.mints.has(signal.mint), 'TOKEN_NOT_ALLOWED');
      if (this.stopSignal?.aborted) return;
      this.journal.reserve(signal, this.config, this.now());
      reserved = true;
      if (!this.config.live) {
        this.journal.finish(signal, 'dry_run', 'DRY_RUN', this.now());
        this.log('DRY_RUN');
        return;
      }
      ensure(this.signer && this.rpc && this.config.mints.has(signal.mint), 'CONFIG_INVALID');
      const bytes = await this.api.trade(signal.mint);
      ensure(!this.stopSignal?.aborted, 'DISABLED');
      const ticket = await this.validate(bytes, signal, this.config, this.rpc, this.now);
      ensure(signal.expiresAt > this.now(), 'EXPIRED_SIGNAL');
      // A fatal clock failure leaves the reservation intact for recovery, not a new finish attempt.
      try { this.journal.clock(this.now()); }
      catch (error) { this.halted = true; throw error; }
      ensure(!this.stopSignal?.aborted, 'DISABLED');
      const signed = this.signer.sign(ticket);
      this.journal.intended(signal, signed.signature);
      intended = true;
      // Once intent is durable, shutdown must not interrupt or reject this submission.
      try {
        const returned = await this.rpc.send(signed.bytes);
        ensure(returned === signed.signature, 'CONFIRMATION_UNKNOWN');
        this.journal.finish(signal, 'submitted', 'SUBMITTED', this.now());
        this.log('SUBMITTED');
      } finally { signed.bytes.fill(0); }
    } catch (error) {
      if (this.halted) throw error;
      const code = intended ? 'CONFIRMATION_UNKNOWN' : safeCode(error);
      if (reserved) this.journal.finish(signal, intended ? 'unknown' : 'rejected', code, this.now());
      else this.journal.enqueue(signal, code === 'CONFIRMATION_UNKNOWN' ? 'unknown' : 'rejected', code);
      this.notice(error);
      if (intended) this.log('CONFIRMATION_UNKNOWN');
    }
  }
  async tick() {
    ensure(!this.running && !this.halted, 'CONFIG_INVALID');
    this.running = true;
    this.delayMs = this.config.pollMs;
    this.rateLimited = false;
    try {
      this.journal.clock(this.now());
      if (this.config.live) await this.reconcile();
      // Unknown signatures halt ALL new buys, including future buckets/mints/days.
      if (!this.stopSignal?.aborted && !this.journal.pending().length && !this.rateLimited) {
        try {
          const body = await this.api.poll();
          ensure(!this.stopSignal?.aborted, 'DISABLED');
          const signals = validatePoll(body, this.now());
          // Serial execution and the journal reservation prevent intra-process races.
          for (const signal of signals) {
            if (this.stopSignal?.aborted) break;
            await this.execute(signal);
            if (this.journal.pending().length || this.rateLimited || this.halted) break;
          }
        } catch (error) {
          if (this.halted) throw error;
          this.notice(error, 'PROVIDER_ERROR');
        }
      }
      if (!this.rateLimited && !this.halted) await this.reports();
    } finally { this.running = false; }
    return this.delayMs;
  }
}