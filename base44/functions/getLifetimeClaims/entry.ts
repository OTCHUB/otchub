// Authoritative per-wallet lifetime-claimed totals, derived from the wallet's
// REAL on-chain OTC claim transactions.
//
// How claims are found: instead of paging through the wallet's entire tx
// history (which for active wallets holds thousands of unrelated txs, so a
// 1000-signature window silently misses older claims), we scan the wallet's
// 13 per-ticker user_stock token accounts. The only instructions that ever
// write those accounts are the OTC claim instruction (vault -> user_stock) and
// the account's own creation, so their signature lists are precisely the
// wallet's claim txs — the COMPLETE claim history, no matter how much other
// wallet activity there is. A dedup by signature keeps multi-ticker claim
// txs from being counted twice.
//
// Results are cached incrementally per token account (the newest signature
// already processed per account), so follow-up calls only parse new txs.
// USD/SOL display values are recomputed from the cached on-chain amounts
// against current spot prices (DexScreener) on every call.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { secrets } from "base44:runtime";
import { Buffer } from "node:buffer";
import { PROGRAM_ID, STOCKS, INSTRUCTIONS } from "../../shared/otcIdl.ts";

// web3.js expects a global Buffer; set it before the module is imported.
if (!globalThis.Buffer) globalThis.Buffer = Buffer;
const { PublicKey } = await import("npm:@solana/web3.js@1.98.4");

const ATA_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

const STOCKS_BY_MINT = Object.fromEntries(STOCKS.map((s) => [s.mint, s]));
const SOL_MINT = "So11111111111111111111111111111111111111112";

// Bump to invalidate caches written by an older parser. v3 moves the
// authoritative totals into the ClaimLog DB — markers reset so every wallet
// gets one full rescan that repopulates ClaimLog, after which reads are
// instant and scans are incremental again.
const CACHE_VERSION = 3;

function heliusRpcUrl() {
  return `https://mainnet.helius-rpc.com/?api-key=${secrets.get("HELIUS_API_KEY")}`;
}
function heliusApiKey() {
  return secrets.get("HELIUS_API_KEY");
}

async function rpc(method, params) {
  const res = await fetch(heliusRpcUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "otc", method, params }),
  });
  if (!res.ok) throw new Error(`Helius ${method} HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`Helius ${method}: ${json.error.message}`);
  return json.result;
}

// Parse up to 100 raw signatures into Helius enhanced transactions (with
// tokenTransfers + instructions). Returns parsed tx objects.
async function parseTransactions(signatures) {
  if (!signatures.length) return [];
  const res = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${heliusApiKey()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactions: signatures }),
  });
  if (!res.ok) throw new Error(`parseTransactions HTTP ${res.status}`);
  return await res.json();
}

// The OTC program derives stock token accounts with a CUSTOM seed order —
// [owner, tokenProgram, mint] under the ATA program — NOT the standard
// [mint, owner, tokenProgram] ATA order (verified on-chain).
function userStockAta(userPk, mint, tokenProgramPk) {
  return PublicKey.findProgramAddressSync(
    [userPk.toBuffer(), tokenProgramPk.toBuffer(), new PublicKey(mint).toBuffer()],
    ATA_PROGRAM_ID
  )[0];
}

// Resolve which token program owns each stock mint (Token-2022 vs standard).
async function resolveTokenPrograms() {
  const mints = STOCKS.map((s) => s.mint);
  let value = [];
  try {
    const result = await rpc("getMultipleAccounts", [mints, { encoding: "base64" }]);
    value = result?.value || [];
  } catch {
    value = mints.map(() => null);
  }
  const map = {};
  const t22 = TOKEN_2022_PROGRAM_ID.toBase58();
  for (let i = 0; i < mints.length; i++) {
    map[mints[i]] = value[i]?.owner === t22
      ? TOKEN_2022_PROGRAM_ID.toBase58()
      : TOKEN_PROGRAM_ID.toBase58();
  }
  return map;
}

// From one parsed tx, extract every claim that paid the wallet:
//   claim accounts (always 12 in this app's txs; the official frontend may
//   use 10 for non-extended tickers — both supported below):
//   We identify a claim by an OTC-program instruction whose nft_stock (desk
//   vault) token account sent tokens to the signer's user_stock.
//   NOTE: Helius tokenTransfers[].tokenAmount is ALREADY decimal-adjusted
//   (the UI amount) for that mint — do NOT divide by 10^decimals again.
// True only for the protocol's claim(index) instruction: the first 8 bytes
// of the instruction data must equal the claim discriminator from the IDL.
// This hard-guarantees that only genuine on-chain claims are counted —
// stock tokens the user bought themselves (Jupiter swaps, plain transfers
// in) never route through the OTC program and can never be tallied here.
function isClaimInstruction(ix) {
  if (!ix.data) return false;
  try {
    const bytes = Buffer.from(ix.data, "base64");
    if (bytes.length < 8) return false;
    return INSTRUCTIONS.claim.every((b, i) => bytes[i] === b);
  } catch {
    return false;
  }
}

function extractClaimsFromTx(tx, wallet) {
  const claims = [];
  const transfers = tx.tokenTransfers || [];
  const otcIxs = [];
  for (const ix of tx.instructions || []) {
    if (ix.programId === PROGRAM_ID) otcIxs.push(ix);
    for (const inner of ix.innerInstructions || []) {
      if (inner.programId === PROGRAM_ID) otcIxs.push(inner);
    }
  }
  for (const ix of otcIxs) {
    if (!isClaimInstruction(ix)) continue;
    const accts = ix.accounts || [];
    if (accts.length !== 10 && accts.length !== 12) continue;
    // accounts[0] is the claim signer (the claiming user). Only count claims
    // made BY this wallet.
    if (accts[0] !== wallet) continue;
    const ext = accts.length === 12;
    const asset = ext ? accts[3] : accts[2];
    const nftStock = ext ? accts[7] : accts[5];
    const userStock = ext ? accts[8] : accts[6];
    const t = transfers.find(
      (x) => x.fromTokenAccount === nftStock && x.toTokenAccount === userStock
    );
    if (!t) continue;
    const stock = STOCKS_BY_MINT[t.mint];
    if (!stock) continue;
    const amount = Number(t.tokenAmount);
    if (!(amount > 0)) continue;
    claims.push({
      asset_id: asset,
      symbol: stock.symbol,
      mint: t.mint,
      amount,
      tx_sig: tx.signature,
      ts: tx.timestamp || null,
    });
  }
  return claims;
}

// Spot USD prices for a set of token mints (DexScreener) + SOL.
// DexScreener caps each response at 30 pairs, and wrapped SOL alone has 30+
// pairs — so SOL MUST be requested on its own and stocks in small chunks,
// otherwise later mints' pairs are silently truncated out of the batch
// (this is why every SOL value showed 0.000).
async function fetchPricesUsd(mints) {
  const stockMints = [...new Set(mints)].filter((m) => m && m !== SOL_MINT);
  const chunks = [[SOL_MINT]];
  for (let i = 0; i < stockMints.length; i += 5) {
    chunks.push(stockMints.slice(i, i + 5));
  }
  const priceMap = {};
  for (const chunk of chunks) {
    try {
      const res = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`
      );
      if (!res.ok) continue;
      const json = await res.json();
      for (const p of json.pairs || []) {
        const m = p.baseToken?.address;
        if (!m || p.chainId !== "solana" || p.priceUsd == null) continue;
        const px = parseFloat(p.priceUsd);
        if (Number.isFinite(px) && priceMap[m] == null) priceMap[m] = px;
      }
    } catch {
      /* ignore chunk */
    }
  }
  return priceMap;
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const wallet = (body.wallet || "").trim();
    const force = body.force === true;
    if (!wallet) return Response.json({ error: "wallet required" }, { status: 400 });
    const userPk = new PublicKey(wallet);

    // Cache under a distinct key: this cache must not share the entity row of
    // the claim-scan cache (plain wallet key) — the two shapes would keep
    // overwriting each other.
    const cacheKey = `${wallet}__lifetime`;
    let cache = null;
    try {
      const existing = await base44.asServiceRole.entities.ClaimCache.filter({ wallet: cacheKey });
      cache = (existing && existing[0]) || null;
    } catch {
      /* ignore */
    }
    const cached = cache?.desks || null;
    const usable = cached?._v === CACHE_VERSION;

    // Persisted per-claim records (ClaimLog) are the primary store: totals
    // seed instantly from the DB the moment a wallet connects, and the
    // on-chain scan below only needs to pick up claims newer than the last
    // scan markers. New parsed claims are written back so the DB stays the
    // durable, always-current source.
    const seenKeys = new Set();
    const amountsByDesk = {};
    // Latest claim per desk — used by the claim panel to label vault balances
    // that appeared AFTER the user's last claim as fresh accruals (claims drain
    // the vault to zero on-chain, so any later balance is new distribution).
    const lastClaimByDesk = {};
    const noteClaimTime = (assetId, iso) => {
      const cur = lastClaimByDesk[assetId];
      if (!iso || (!cur && cur !== "")) {
        if (iso) lastClaimByDesk[assetId] = iso;
        return;
      }
      if (!cur || iso > cur) lastClaimByDesk[assetId] = iso;
    };
    try {
      const logs = await base44.asServiceRole.entities.ClaimLog.filter(
        { wallet },
        "-created_date",
        1000
      );
      for (const r of logs || []) {
        if (!r.asset_id || !r.symbol) continue;
        // Client-side claim logs (legacy logClaims) without a tx signature
        // can't be deduped against the on-chain scan — which finds the SAME
        // real claims WITH real signatures — so counting them would double
        // every such claim. The on-chain scan is authoritative; skip them.
        if (!r.tx_sig) continue;
        const key = `${r.tx_sig}|${r.symbol}|${r.asset_id}`;
        if (seenKeys.has(key)) continue; // double-persisted duplicate row
        seenKeys.add(key);
        const d = (amountsByDesk[r.asset_id] ||= {});
        d[r.symbol] = (d[r.symbol] || 0) + (Number(r.amount) || 0);
        noteClaimTime(r.asset_id, r.created_date);
      }
    } catch {
      /* DB read failure -> the on-chain scan below still recovers */
    }
    let markers = (!force && usable && cached.markers) ? { ...cached.markers } : {};

    // Incremental on-chain scan unless the cache is fresh (and not forced).
    const SCAN_TTL_MS = 5 * 60 * 1000;
    const fresh = usable && cached.scanned_at && Date.now() - cached.scanned_at < SCAN_TTL_MS;
    let parsedCount = 0;
    const newClaims = [];
    if (!fresh || force) {
      const tpMap = await resolveTokenPrograms();
      // Collect un-parsed signatures across all 13 user_stock accounts.
      const toParse = new Set();
      for (const s of STOCKS) {
        const ata = userStockAta(userPk, s.mint, new PublicKey(tpMap[s.mint])).toBase58();
        let sigs;
        try {
          sigs = await rpc("getSignaturesForAddress", [ata, { limit: 1000 }]);
        } catch {
          sigs = [];
        }
        const okSigs = sigs.filter((x) => !x.err).map((x) => x.signature);
        const marker = markers[ata];
        let stopIdx = okSigs.length;
        if (marker) {
          const mi = okSigs.indexOf(marker);
          if (mi >= 0) stopIdx = mi; // only parse sigs newer than the marker
          // marker not in this page: fall through and parse the whole page
        }
        for (let i = 0; i < stopIdx; i++) toParse.add(okSigs[i]);
        if (okSigs.length) markers[ata] = okSigs[0];
      }
      // Parse in batches of 100 (dedup by signature — multi-ticker claim txs
      // appear in several accounts' lists but are parsed once).
      const sigList = [...toParse];
      parsedCount = sigList.length;
      for (let i = 0; i < sigList.length; i += 100) {
        const parsed = await parseTransactions(sigList.slice(i, i + 100));
        for (const tx of parsed || []) {
          if (tx.transactionError) continue;
          const claims = extractClaimsFromTx(tx, wallet);
          for (const c of claims) {
            const key = `${c.tx_sig}|${c.symbol}|${c.asset_id}`;
            if (seenKeys.has(key)) continue; // already persisted in ClaimLog
            seenKeys.add(key);
            const d = (amountsByDesk[c.asset_id] ||= {});
            d[c.symbol] = (d[c.symbol] || 0) + c.amount;
            if (c.ts) noteClaimTime(c.asset_id, new Date(c.ts * 1000).toISOString());
            newClaims.push({
              wallet,
              asset_id: c.asset_id,
              symbol: c.symbol,
              mint: c.mint,
              amount: c.amount,
              value_usd: 0, // display values are recomputed live from spot
              value_sol: 0,
              tx_sig: c.tx_sig,
            });
          }
        }
      }
      // Persist the newly decoded claims so the next connect reads instantly.
      if (newClaims.length) {
        try {
          await base44.asServiceRole.entities.ClaimLog.bulkCreate(newClaims);
        } catch {
          /* best-effort persistence */
        }
      }
      const updated = {
        _v: CACHE_VERSION,
        markers,
        scanned_at: Date.now(),
        by_desk: amountsByDesk,
      };
      try {
        if (cache) {
          await base44.asServiceRole.entities.ClaimCache.update(cache.id, { desks: updated });
        } else {
          await base44.asServiceRole.entities.ClaimCache.create({ wallet: cacheKey, desks: updated });
        }
      } catch {
        /* cache write is best-effort */
      }
    }

    // Compute USD/SOL display values from on-chain amounts × current spot.
    const mintsUsed = new Set([SOL_MINT]);
    for (const amt of Object.values(amountsByDesk)) {
      for (const sym of Object.keys(amt)) {
        const s = STOCKS.find((x) => x.symbol === sym);
        if (s) mintsUsed.add(s.mint);
      }
    }
    const prices = await fetchPricesUsd([...mintsUsed]);
    const solUsd = prices[SOL_MINT] ?? null;

    const byDesk = [];
    let totalUsd = 0;
    let totalSol = 0;
    let claimCount = 0;
    for (const [asset_id, amt] of Object.entries(amountsByDesk)) {
      let deskUsd = 0;
      const tickers = {};
      for (const [sym, amount] of Object.entries(amt)) {
        const s = STOCKS.find((x) => x.symbol === sym);
        const px = s ? prices[s.mint] ?? 0 : 0;
        const usd = amount * px;
        deskUsd += usd;
        tickers[sym] = amount;
        claimCount += 1;
      }
      const deskSol = solUsd ? deskUsd / solUsd : 0;
      byDesk.push({
        asset_id,
        amounts: tickers,
        value_usd: deskUsd,
        value_sol: deskSol,
        count: Object.keys(tickers).length,
        last_claim_at: lastClaimByDesk[asset_id] || null,
      });
      totalUsd += deskUsd;
      totalSol += deskSol;
    }
    byDesk.sort((a, b) => b.value_usd - a.value_usd);

    // Per-stock (ticker) totals: lifetime amount + live SOL/USD value.
    const perStock = {};
    for (const amt of Object.values(amountsByDesk)) {
      for (const [sym, amount] of Object.entries(amt)) {
        const s = (perStock[sym] ||= { amount: 0, usd: 0 });
        s.amount += amount;
        const stock = STOCKS.find((x) => x.symbol === sym);
        s.usd += amount * (stock ? prices[stock.mint] ?? 0 : 0);
      }
    }
    const byStock = Object.entries(perStock)
      .map(([symbol, v]) => ({
        symbol,
        amount: v.amount,
        value_usd: v.usd,
        value_sol: solUsd ? v.usd / solUsd : 0,
      }))
      .sort((a, b) => b.value_usd - a.value_usd);

    return Response.json({
      ok: true,
      wallet,
      by_desk: byDesk,
      by_stock: byStock,
      total_usd: totalUsd,
      total_sol: totalSol,
      count: claimCount,
      source: "on-chain",
      parsed_txs: parsedCount,
      scanned_at: cached?.scanned_at || null,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}