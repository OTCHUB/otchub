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
const LAMPORTS_PER_SOL = 1e9;
const PAGE_LIMIT = 100; // Helius REST page cap
const MAX_PAGES = 10; // first run backfills up to 1000 txs; later runs are 1 page
const KEEP_DAYS = 30;

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
  const prevCursor = prev?.cursor || null;
  let newestSig = null;
  let before = null;
  const collected = [];

  for (let page = 0; page < MAX_PAGES; page++) {
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
    if (hitCursor || txs.length < PAGE_LIMIT) break;
    before = txs[txs.length - 1].signature;
  }
  if (!newestSig) return null;

  // Merge the new inflows into the carried-forward day map.
  const merged = { ...(prev?.days || {}) };
  for (const c of collected) {
    const d = (merged[c.day] = merged[c.day] || { mint: 0, launchpad: 0, other: 0 });
    d[c.source] = (d[c.source] || 0) + c.sol;
  }
  const dayKeys = Object.keys(merged).sort();
  const kept = dayKeys.slice(-KEEP_DAYS);
  const days = {};
  for (const k of kept) {
    const d = merged[k] || {};
    days[k] = {
      mint: +(d.mint || 0).toFixed(6),
      launchpad: +(d.launchpad || 0).toFixed(6),
      other: +(d.other || 0).toFixed(6),
    };
  }
  return {
    days,
    cursor: newestSig,
    since: prev?.since || dayKeys[0] || null,
  };
}