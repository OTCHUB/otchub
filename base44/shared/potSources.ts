// Desk-pot revenue attribution by SOURCE, measured directly from the pot's
// on-chain SOL inflow transactions via the Helius Enhanced Transactions REST
// API (api.helius.xyz/v0/addresses/{pot}/transactions).
//
// Why: otcdesks.cash's stats feed only reports channel totals (toPot) with no
// per-source split, and its global "distributed" figure mixes launchpad-holder
// payouts with desk distributions. The pot's actual inflow transactions ARE
// attributable on-chain:
//   - MINT: desk mint surcharge — 90% of the 0.5 SOL per-mint surcharge,
//     deposited by the OTC program inside the mint tx itself.
//   - ROYALTY: Magic Eden desk-sale creator royalties (5%) — deposited
//     directly into the pot inside each marketplace sale tx (verified
//     on-chain: pot inflows inside ME v1 escrow / v2 marketplace program txs).
//   - LAUNCHPAD: launcher creator fees — the pot's share is settled per-trade
//     through pump.fun bonding-curve / PumpAMM fee txs (verified on-chain: the
//     pot receives ~9.98% of each settled fee, matching the newsletter's
//     "10% Pot" launcher split).
//   - OTHER: everything else — the $OTC trading-tax share (80% pot per the
//     newsletter) arrives without a per-swap-attributable pot deposit pattern
//     ($OTC pumpswap swaps never touch the pot directly), plus sweeps and
//     misc. Bucketed honestly as UNATTRIBUTED rather than guessed.
// Outflows (distribution rounds — pot SOL spent buying stock) are NOT revenue
// and are skipped; only positive pot balance changes are counted.
//
// The scan is INCREMENTAL: a cursor (newest processed signature) carries
// forward inside each OtcSnapshot's pot_sources, and every full ingest walks
// the pot's tx list back from the newest signature until it meets the cursor.
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
const MAX_PAGES = 10; // incremental walk depth when the cursor is far behind
const FIRST_RUN_PAGES = 40; // version reset: deep one-time backfill (4000 txs)
const BACKFILL_PAGES = 5; // per-run budget extending history backward
const TARGET_DAYS = 14; // stop backfilling once the day map is this deep
const KEEP_DAYS = 30;
// Bucket layout version. Bumping resets the day map + cursor so history is
// re-backfilled with the new source split (e.g. v2 carved royalties out of
// the old "other" bucket — without a reset those days would double-count).
const SOURCES_VERSION = 3;

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

// prev = the previous snapshot's pot_sources ({ days, cursor, since } | null).
// Returns the updated { days, cursor, since } — days values in SOL per UTC
// day, pruned to the last KEEP_DAYS. Throws on API failure so the caller can
// keep the previous snapshot's data untouched.
export async function scanPotSources(prev) {
  // Only carry forward a day map of the same bucket layout; a version bump
  // re-backfills from scratch so old buckets never mix with new ones.
  const carry = prev && prev._v === SOURCES_VERSION ? prev : null;
  const prevCursor = carry?.cursor || null;
  let newestSig = null;
  let oldest = carry?.oldest || null;
  let before = null;
  const collected = [];

  const walkCap = prevCursor ? MAX_PAGES : FIRST_RUN_PAGES;
  for (let page = 0; page < walkCap; page++) {
    const txs = await fetchPotTxs(before);
    if (!Array.isArray(txs) || !txs.length) break;
    if (!newestSig) newestSig = txs[0].signature;
    // Oldest→newest; stop once the previous cursor is reached.
    const ordered = [...txs].reverse();
    let hitCursor = false;
    for (const t of ordered) {
      if (prevCursor && t.signature === prevCursor) {
        hitCursor = true;
        break;
      }
      const c = classify(t);
      if (c) collected.push(c);
    }
    const lastSig = txs[txs.length - 1].signature;
    if (hitCursor) break; // older history is anchored at carry.oldest
    if (txs.length < PAGE_LIMIT) {
      oldest = null; // walked to the beginning of the pot's tx history
      break;
    }
    oldest = lastSig;
    before = lastSig;
  }
  if (!newestSig) return null;

  // Backward backfill (bounded): each run continues from the oldest signature
  // ever seen, extending day history for the 14-day chart. Only runs while
  // the day map is still shallower than TARGET_DAYS, so total cost is capped.
  if (carry && oldest && Object.keys(carry.days || {}).length < TARGET_DAYS) {
    let bfBefore = oldest;
    for (let page = 0; page < BACKFILL_PAGES; page++) {
      const txs = await fetchPotTxs(bfBefore);
      if (!Array.isArray(txs) || !txs.length) {
        oldest = null;
        break;
      }
      for (const t of txs) {
        const c = classify(t);
        if (c) collected.push(c);
      }
      if (txs.length < PAGE_LIMIT) {
        oldest = null;
        break;
      }
      bfBefore = txs[txs.length - 1].signature;
      oldest = bfBefore;
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
    oldest: oldest || null,
    since: dayKeys[0] || carry?.since || null,
  };
}