// Desk-pot revenue attribution by SOURCE, measured directly from the pot's
// on-chain SOL inflow transactions via the Helius Enhanced Transactions REST
// API (api.helius.xyz/v0/addresses/{pot}/transactions).
//
// Why: otcdesks.cash's stats feed only reports channel totals (toPot) with no
// per-source split, and its global "distributed" figure mixes launchpad-holder
// payouts with desk distributions. The pot's actual inflow transactions ARE
// attributable on-chain:
//   - MINT: desk-mint channel — the 0.45 SOL pot share of the 0.5 SOL
//     surcharge PLUS the proceeds of selling the 100k-OTC deposit via
//     PumpAMM, all deposited by the OTC program inside the mint tx (verified
//     on-chain: mint txs bundle PumpAMM + PumpFun + OTC instructions and the
//     pot nets ~0.68 SOL per mint).
//   - ROYALTY: Magic Eden desk-sale creator royalties (5%) — deposited
//     directly into the pot inside each marketplace sale tx (verified
//     on-chain: pot inflows inside ME v1 escrow / v2 marketplace program txs).
//   - LAUNCHPAD: per-swap fee settlements arriving through pump.fun /
//     PumpAMM fee txs — the launcher creator-fee pot share and/or the $OTC
//     trading-tax pot share, which are indistinguishable on-chain (both
//     land as micro fee-recipient deposits in swap txs).
//   - OTHER: everything else — the $OTC trading-tax share (80% pot per the
//     newsletter) arrives without a per-swap-attributable pot deposit pattern
//     ($OTC pumpswap swaps never touch the pot directly), plus sweeps and
//     misc. Bucketed honestly as UNATTRIBUTED rather than guessed.
// Outflows (distribution rounds — pot SOL spent buying stock) are NOT revenue
// and are skipped; only positive pot balance changes are counted.
//
// The scan is INCREMENTAL and EXACTLY-ONCE by construction:
//   - A FORWARD WALK counts only txs strictly newer than the checkpoint
//     (signature cursor + timestamp watermark). It walks ALL the way to the
//     cursor — a fixed page cap that stops short of the cursor is exactly
//     what double-counted high-volume days before (the leftover window was
//     re-counted and the backfill anchor got corrupted).
//   - A BACKFILL WALK extends history backward from `bf_cursor`, the deepest
//     signature ever processed. The anchor only ever moves DEEPER (or to null
//     once the pot's full history is walked), so every backfilled tx is
//     unseen — nothing is ever re-counted.
// Inflows are bucketed per UTC day so the dashboard can stack the sources.

import { ADDRESSES } from "./otcSources.ts";
import { secrets } from "base44:runtime";

const POT = ADDRESSES.POT;
const OTC_PROGRAM = ADDRESSES.PROGRAM;
const PUMPFUN_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMPAMM_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const ME_V1_PROGRAM = "M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K"; // Magic Eden v1 escrow
const ME_V2_PROGRAM = "mmm3XBJg5gk8XJxEKBvdgptZz6SgK4tXvn36sodowMc"; // Magic Eden v2 marketplace
const ME_PROGRAMS = new Set([ME_V1_PROGRAM, ME_V2_PROGRAM]);
const LAMPORTS_PER_SOL = 1e9;
const PAGE_LIMIT = 100; // Helius REST page cap
const FIRST_RUN_PAGES = 40; // version reset: deep one-time scan (4000 txs)
const BACKFILL_PAGES = 30; // per-run budget extending history backward (~3000 txs/run)
// Safety ceiling for the forward walk (100 pages = 10k txs). Normal runs hit
// the cursor within a page or two; only a >10k-tx burst between two 5-minute
// ingests can reach this. If it is ever reached, the timestamp watermark still
// guarantees nothing already-counted is re-counted (the few txs beyond the
// cap would be missed once, never double-counted).
const WALK_SAFETY_PAGES = 100;
const KEEP_DAYS = 730;
// Bucket layout version. Bumping resets the day map + cursors so history is
// re-scanned from scratch with the fixed checkpoint logic. v4 fixes the
// double-count bug: v3 capped the forward walk at 10 pages without reaching
// the cursor on high-volume days and handed a NEWER anchor to the backfill,
// which re-counted thousands of already-processed txs into the day map
// (current-day metrics were inflated up to ~16x). v4 walks to the cursor
// (timestamp-watermark guarded) and never lets the backfill anchor move
// forward, so no tx can be counted twice.
const SOURCES_VERSION = 4;

async function fetchPotTxs(before) {
  const key = secrets.get("HELIUS_API_KEY");
  const url =
    `https://api.helius.xyz/v0/addresses/${POT}/transactions?api-key=${key}&limit=${PAGE_LIMIT}` +
    (before ? `&before=${before}` : "");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Helius tx API ${res.status}`);
  return res.json();
}

// Classify one pot-touching tx: returns { source, sol, day } for inflows, or
// null for failed txs and non-inflows (distribution rounds, transfers out).
function classify(t) {
  if (t.transactionError) return null;
  const potAcc = (t.accountData || []).find((a) => a.account === POT);
  const lam = potAcc?.nativeBalanceChange ?? 0; // lamports, signed
  if (!(lam > 0)) return null;
  const progs = new Set((t.instructions || []).map((i) => i.programId));
  let source = "other";
  if (progs.has(OTC_PROGRAM)) source = "mint";
  else if ([...progs].some((p) => ME_PROGRAMS.has(p))) source = "royalty";
  else if (progs.has(PUMPFUN_PROGRAM) || progs.has(PUMPAMM_PROGRAM)) source = "launchpad";
  return {
    source,
    sol: lam / LAMPORTS_PER_SOL,
    day: new Date(t.timestamp * 1000).toISOString().slice(0, 10),
  };
}

// prev = the previous snapshot's pot_sources ({ days, cursor, ... } | null).
// Returns the updated payload — days values in SOL per UTC day, pruned to the
// last KEEP_DAYS. Throws on API failure so the caller can keep the previous
// snapshot's data untouched.
export async function scanPotSources(prev) {
  // Only carry forward a day map of the same bucket layout; a version bump
  // re-scans from scratch so old (possibly corrupted) buckets never carry.
  const carry = prev && prev._v === SOURCES_VERSION ? prev : null;
  const prevCursor = carry?.cursor || null; // newest processed signature
  const cursorTs = carry?.cursor_ts ?? null; // timestamp (s) of that tx
  let bfCursor = carry?.bf_cursor ?? null; // deepest ever processed signature
  let newestSig = null;
  let newestTs = null;
  let before = null;
  const collected = [];

  // FORWARD WALK — newest → back, counting ONLY txs strictly newer than the
  // checkpoint. Two guards make re-counting impossible:
  //  1. stop at the checkpoint signature itself;
  //  2. stop at anything at/below the checkpoint's timestamp (the watermark:
  //     everything previously processed is at/below it, so anything newer is
  //     genuinely new).
  // The walk has NO shallow page cap: stopping short of the cursor is what
  // double-counted high-volume days before. It ends at the cursor, at history
  // exhaustion, or at the WALK_SAFETY_PAGES ceiling.
  const walkCap = prevCursor ? WALK_SAFETY_PAGES : FIRST_RUN_PAGES;
  let stopped = false;
  let exhausted = false;
  for (let page = 0; page < walkCap; page++) {
    const txs = await fetchPotTxs(before);
    if (!Array.isArray(txs) || !txs.length) {
      exhausted = true;
      break;
    }
    if (!newestSig) {
      newestSig = txs[0].signature;
      newestTs = txs[0].timestamp;
    }
    const ordered = [...txs].reverse(); // oldest→newest within the page
    let hitCheckpoint = false;
    for (const t of ordered) {
      if (prevCursor && t.signature === prevCursor) {
        hitCheckpoint = true;
        break;
      }
      if (cursorTs != null && t.timestamp <= cursorTs) {
        hitCheckpoint = true; // watermark reached — everything older is done
        break;
      }
      const c = classify(t);
      if (c) collected.push(c);
    }
    if (hitCheckpoint) {
      stopped = true;
      break;
    }
    const lastSig = txs[txs.length - 1].signature;
    if (txs.length < PAGE_LIMIT) {
      exhausted = true; // walked to the beginning of the pot's tx history
      break;
    }
    before = lastSig;
    // First run only (no checkpoint yet): the deepest signature we actually
    // counted becomes the backfill anchor. On checkpointed runs this NEVER
    // executes — moving the backfill anchor forward is exactly what
    // re-counted history before.
    if (!prevCursor) bfCursor = lastSig;
  }
  if (!newestSig) return null;
  if (!prevCursor && exhausted) bfCursor = null; // full history already walked

  // BACKFILL — extends the day map backward from the deepest ever processed
  // signature, ~BACKFILL_PAGES per run, until the pot's full history is
  // walked (bfCursor → null) — later sources (e.g. royalties) simply show
  // as zero-buckets on earlier days when they didn't exist yet. The anchor
  // only ever moves DEEPER, so every backfilled tx is unseen and nothing is
  // ever re-counted.
  if (carry && bfCursor) {
    let bfBefore = bfCursor;
    for (let page = 0; page < BACKFILL_PAGES; page++) {
      const txs = await fetchPotTxs(bfBefore);
      if (!Array.isArray(txs) || !txs.length) {
        bfCursor = null;
        break;
      }
      for (const t of txs) {
        const c = classify(t);
        if (c) collected.push(c);
      }
      const lastSig = txs[txs.length - 1].signature;
      if (txs.length < PAGE_LIMIT) {
        bfCursor = null;
        break;
      }
      bfCursor = lastSig;
      bfBefore = lastSig;
    }
  }

  // Merge the new inflows into the carried-forward day map.
  const merged = { ...(carry?.days || {}) };
  for (const c of collected) {
    const d = (merged[c.day] = merged[c.day] || { mint: 0, royalty: 0, launchpad: 0, other: 0 });
    d[c.source] = (d[c.source] || 0) + c.sol;
  }
  const dayKeys = Object.keys(merged).sort();
  const kept = dayKeys.slice(-KEEP_DAYS);
  const days = {};
  for (const k of kept) {
    const d = merged[k] || {};
    days[k] = {
      mint: +(d.mint || 0).toFixed(6),
      royalty: +(d.royalty || 0).toFixed(6),
      launchpad: +(d.launchpad || 0).toFixed(6),
      other: +(d.other || 0).toFixed(6),
    };
  }
  return {
    _v: SOURCES_VERSION,
    days,
    cursor: newestSig,
    cursor_ts: newestTs,
    bf_cursor: bfCursor,
    since: dayKeys[0] || carry?.since || null,
  };
}