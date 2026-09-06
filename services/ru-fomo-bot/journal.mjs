import { DatabaseSync } from 'node:sqlite';
import { constants, closeSync, existsSync, lstatSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ensure, SafeError, reportBody } from './safety.mjs';

function checkParents(path) {
  for (let dir = path; ; dir = dirname(dir)) {
    const stat = lstatSync(dir);
    const trustedSticky = stat.uid === 0 && (stat.mode & 0o1000) !== 0;
    ensure(stat.isDirectory() && !stat.isSymbolicLink() && (stat.uid === 0 || stat.uid === process.getuid()) &&
      ((stat.mode & 0o022) === 0 || trustedSticky), 'CONFIG_INVALID');
    if (dirname(dir) === dir) break;
  }
}
function privateFile(path) {
  if (!existsSync(path)) {
    // A dangling symlink is refused by O_EXCL; never follow a link during creation.
    closeSync(openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600));
  }
  const stat = lstatSync(path);
  ensure(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 &&
    stat.uid === process.getuid() && (stat.mode & 0o077) === 0, 'CONFIG_INVALID');
}
function secureDirectory(path) {
  ensure(typeof process.getuid === 'function', 'CONFIG_INVALID');
  const dir = resolve(path);
  checkParents(dirname(dir));
  if (!existsSync(dir)) mkdirSync(dir, { mode: 0o700 });
  checkParents(dir);
  const stat = lstatSync(dir);
  ensure(stat.uid === process.getuid() && (stat.mode & 0o077) === 0, 'CONFIG_INVALID');
  return dir;
}
function secureDb(path) {
  privateFile(path);
  for (const suffix of ['-journal', '-wal', '-shm']) {
    // lstat also sees dangling symlinks that existsSync intentionally does not.
    try { lstatSync(path + suffix); privateFile(path + suffix); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return new DatabaseSync(path);
}

export class Journal {
  constructor(config) {
    try {
      // Kept restrictive for SQLite-created sidecars throughout this operator process.
      process.umask(0o077);
      const dir = secureDirectory(config.stateDir);
      this.lock = secureDb(join(dir, 'operator-lock.sqlite'));
      this.lock.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE');
      this.db = secureDb(join(dir, config.live ? 'live.sqlite' : 'dry-run.sqlite'));
      this.db.exec(`PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS identity (id INTEGER PRIMARY KEY CHECK(id=1), wallet TEXT NOT NULL, clock INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, mint TEXT NOT NULL, day INTEGER NOT NULL,
          at INTEGER NOT NULL, charge INTEGER NOT NULL, state TEXT NOT NULL, signature TEXT, settled_day INTEGER);
        CREATE INDEX IF NOT EXISTS mint_time ON attempts(mint, at);
        CREATE TABLE IF NOT EXISTS budgets (day INTEGER PRIMARY KEY, spent INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY, body TEXT NOT NULL UNIQUE, attempts INTEGER NOT NULL DEFAULT 0,
          next_at INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL DEFAULT 0);`);
      const identity = config.live ? config.wallet : 'dry-run';
      this.db.prepare('INSERT OR IGNORE INTO identity VALUES(1, ?, 0)').run(identity);
      ensure(this.db.prepare('SELECT wallet FROM identity WHERE id=1').get().wallet === identity, 'CONFIG_INVALID');
    } catch {
      this.close();
      throw new SafeError('CONFIG_INVALID');
    }
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  clock(now) {
    ensure(Number.isSafeInteger(now) && now >= this.db.prepare('SELECT clock FROM identity WHERE id=1').get().clock, 'CONFIG_INVALID');
    this.db.prepare('UPDATE identity SET clock=? WHERE id=1').run(now);
  }
  enqueue(signal, status, code, signature) {
    const body = JSON.stringify(reportBody(signal, status, code, signature));
    this.db.prepare('INSERT OR IGNORE INTO outbox(body) VALUES(?)').run(body);
  }
  reserve(signal, config, now) {
    return this.transaction(() => {
      this.clock(now);
      ensure(!this.db.prepare('SELECT 1 FROM attempts WHERE id=?').get(signal.id), 'DUPLICATE_SIGNAL');
      ensure(!this.db.prepare("SELECT 1 FROM attempts WHERE state IN ('reserved','unknown','submitted') LIMIT 1").get(), 'CONFIRMATION_UNKNOWN');
      const prior = this.db.prepare('SELECT MAX(at) AS at FROM attempts WHERE mint=?').get(signal.mint).at;
      ensure(prior === null || now - prior >= config.cooldownMs, 'BUDGET_EXCEEDED');
      const day = Math.floor(now / 86400000);
      const charge = config.live ? config.perTrade : 0;
      const spent = this.db.prepare('SELECT spent FROM budgets WHERE day=?').get(day)?.spent || 0;
      ensure(spent + charge <= config.daily, 'BUDGET_EXCEEDED');
      this.db.prepare('INSERT INTO budgets VALUES(?, ?) ON CONFLICT(day) DO UPDATE SET spent=spent+excluded.spent').run(day, charge);
      this.db.prepare('INSERT INTO attempts(id,mint,day,at,charge,state) VALUES(?,?,?,?,?,?)')
        .run(signal.id, signal.mint, day, now, charge, 'reserved');
    });
  }
  intended(signal, signature) {
    this.transaction(() => {
      const row = this.get(signal.id);
      ensure(row?.state === 'reserved' && !row.signature, 'INTERNAL_ERROR');
      // FULL synchronous commit happens BEFORE any sendTransaction call.
      this.db.prepare("UPDATE attempts SET state='unknown', signature=? WHERE id=?").run(signature, signal.id);
      this.enqueue(signal, 'unknown', 'CONFIRMATION_UNKNOWN', signature);
    });
  }
  finish(signal, status, code, now) {
    this.transaction(() => {
      this.clock(now);
      const row = this.get(signal.id);
      ensure(row, 'INTERNAL_ERROR');
      ensure(!row.signature || ['submitted', 'unknown', 'confirmed', 'failed'].includes(status), 'INTERNAL_ERROR');
      this.db.prepare('UPDATE attempts SET state=? WHERE id=?').run(status, signal.id);
      // Carry an old unresolved reservation into its settlement day as well (never refund).
      if (row.signature && ['confirmed', 'failed'].includes(status) && row.settled_day === null) {
        const day = Math.floor(now / 86400000);
        if (day !== row.day) this.db.prepare('INSERT INTO budgets VALUES(?,?) ON CONFLICT(day) DO UPDATE SET spent=spent+excluded.spent').run(day, row.charge);
        this.db.prepare('UPDATE attempts SET settled_day=? WHERE id=?').run(day, signal.id);
      }
      this.enqueue(signal, status, code, row.signature || undefined);
    });
  }
  get(id) { return this.db.prepare('SELECT * FROM attempts WHERE id=?').get(id); }
  pending() { return this.db.prepare("SELECT * FROM attempts WHERE state IN ('unknown','submitted')").all(); }
  recover(now) {
    // With the exclusive operator lock acquired, no previous process can still sign a reservation.
    for (const row of this.db.prepare("SELECT * FROM attempts WHERE state='reserved'").all()) {
      this.finish(row, 'failed', 'INTERNAL_ERROR', now);
    }
  }
  reports(now) { return this.db.prepare('SELECT * FROM outbox WHERE sent=0 AND attempts<3 AND next_at<=? ORDER BY id LIMIT 10').all(now); }
  reportAttempt(id, now) { this.db.prepare('UPDATE outbox SET attempts=attempts+1, next_at=? WHERE id=?').run(now + 300000, id); }
  reportSent(id) { this.db.prepare('UPDATE outbox SET sent=1 WHERE id=?').run(id); }
  close() {
    try { this.db?.close(); } catch { /* Never echo SQLite errors or paths. */ }
    try { this.lock?.close(); } catch { /* OS releases the exclusive lock on crash as well. */ }
    this.db = undefined;
    this.lock = undefined;
  }
}