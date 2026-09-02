// Authoritative per-wallet lifetime-claimed totals, derived DIRECTLY from the
// wallet's real on-chain OTC claim transactions — not from client-side
// estimates. For each successful tx touching the OTC program, we find the claim
// instruction(s): an OTC-program instruction whose nft_stock (desk vault) token
// account sent tokens to the signer's user_stock. The matching token transfer
// gives the exact mint + raw amount that actually moved, so only claims that
// truly landed on-chain are counted (a failed sim / rejected sign contributes
// nothing). The desk NFT (asset_id) is read from the instruction's accounts.
//
// Results are cached incrementally in ClaimCache: we remember the newest
// signature we've already processed and only parse txs newer than it, so the
// second+ call is cheap. USD/SOL display values are recomputed from the cached
// on-chain amounts against current spot prices (DexScreener) on every call, so
// the totals stay current without re-scanning the chain.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { secrets } from "base44:runtime";
import { PROGRAM_ID, STOCKS } from "../../shared/otcIdl.ts";

const STOCKS_BY_MINT = Object.fromEntries(STOCKS.map((s) => [s.mint, s]));
const SOL_MINT = "So11111111111111111111111111111111111111112";

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

// Wallet signatures, newest first, up to `limit` (max 1000). `before` paginates
// older; omit on the first page.
async function getSignatures(address, limit = 1000, before = null) {
  const params = [address, { limit }];
  if (before) params[1].before = before;
  return await rpc("getSignaturesForAddress", params);
}

// From one parsed tx, extract every claim that paid the wallet:
//   claim accounts (non-ext, 10): user, config, asset, vault, stock_mint,
//     nft_stock, user_stock, token_program, ata, system
//   claim accounts (ext, 12):      user, config, config_ext, asset, vault,
//     vault_ext, stock_mint, nft_stock, user_stock, token_program, ata, system
// We identify a claim by an OTC-program instruction whose nft_stock sent tokens
// to its user_stock — distribute/open_ticker never move tokens out of the
// vault to the user, so they're excluded automatically.
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
    const accts = ix.accounts || [];
    if (accts.length !== 10 && accts.length !== 12) continue;
    // accounts[0] is the claim signer (the claiming user). Only count claims
    // made BY this wallet, so querying any address can't pull in other users'
    // claims that merely referenced it.
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
    // Helius tokenTransfers[].tokenAmount is ALREADY decimal-adjusted (the UI
    // amount) for that mint — dividing by 10^decimals again scaled every claim
    // down to dust, so lifetime totals always rendered as zero.
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

// Spot USD prices for a set of token mints (batched DexScreener) + SOL.
async function fetchPricesUsd(mints) {
  const set = new Set(mints);
  set.add(SOL_MINT);
  const list = [...set].filter(Boolean);
  const priceMap = {};
  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${list.join(",")}`;
    const res = await fetch(url);
    if (res.ok) {
      const json = await res.json();
      const byMint = {};
      for (const p of json.pairs || []) {
        const m = p.baseToken?.address;
        if (!m) continue;
        if (p.chainId === "solana" && p.priceUsd != null) {
          if (byMint[m] == null) byMint[m] = parseFloat(p.priceUsd);
        }
      }
      for (const m of list) priceMap[m] = byMint[m] ?? null;
    }
  } catch {
    /* ignore */
  }
  if (priceMap[SOL_MINT] == null) {
    try {
      const r = await rpc("getTokenSupply", [SOL_MINT]); // not SOL price; fallback below
      void r;
    } catch {
      /* ignore */
    }
    // DexScreener SOL pair usually present; if not, leave null.
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

    // Cache under a distinct key: this cache used to share the SAME entity row
    // as the claim-scan cache (both keyed by the plain wallet), so the two
    // shapes kept overwriting each other — forcing a full 1000-tx re-parse here
    // and a full vault re-scan there on every load. A suffixed key gives each
    // cache its own row.
    const cacheKey = `${wallet}__lifetime`;
    // Load incremental cache (amounts + last processed signature).
    let cache = null;
    try {
      const existing = await base44.asServiceRole.entities.ClaimCache.filter({ wallet: cacheKey });
      cache = (existing && existing[0]) || null;
    } catch {
      /* ignore */
    }
    const cached = cache?.desks || null; // { last_signature, scanned_at, by_desk }
    // force = full recompute from the 1000-sig window; otherwise incrementally
    // add new claims to the cached aggregate.
    let amountsByDesk = (!force && cached?.by_desk) ? structuredClone(cached.by_desk) : {};
    let lastSignature = (!force && cached?.last_signature) || null;

    // Incremental on-chain scan unless fresh cache (and not forced).
    const SCAN_TTL_MS = 5 * 60 * 1000;
    const fresh = cached?.scanned_at && Date.now() - cached.scanned_at < SCAN_TTL_MS;
    if (!fresh || force) {
      const sigInfos = await getSignatures(wallet, 1000);
      // newest first; collect new successful sigs until we reach lastSignature.
      const newSigs = [];
      for (const s of sigInfos) {
        if (s.err) continue;
        if (lastSignature && s.signature === lastSignature) break;
        newSigs.push(s.signature);
      }
      // If lastSignature wasn't found in this page and we have a full page of
      // new sigs, the cache is stale relative to wallet activity beyond 1000
      // txs — parse the whole page (best effort) rather than miss claims.
      const toParse =
        newSigs.length === sigInfos.filter((s) => !s.err).length && newSigs.length >= 1000
          ? sigInfos.filter((s) => !s.err).map((s) => s.signature)
          : newSigs;
      // Parse in batches of 100.
      for (let i = 0; i < toParse.length; i += 100) {
        const batch = toParse.slice(i, i + 100);
        const parsed = await parseTransactions(batch);
        for (const tx of parsed || []) {
          if (tx.transactionError) continue;
          const claims = extractClaimsFromTx(tx, wallet);
          for (const c of claims) {
            const d = (amountsByDesk[c.asset_id] ||= {});
            d[c.symbol] = (d[c.symbol] || 0) + c.amount;
          }
        }
      }
      lastSignature = sigInfos.find((s) => !s.err)?.signature || lastSignature;
      const updated = {
        last_signature: lastSignature,
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
      });
      totalUsd += deskUsd;
      totalSol += deskSol;
    }
    byDesk.sort((a, b) => b.value_usd - a.value_usd);

    return Response.json({
      ok: true,
      wallet,
      by_desk: byDesk,
      total_usd: totalUsd,
      total_sol: totalSol,
      count: claimCount,
      source: "on-chain",
      last_signature: lastSignature,
      scanned_at: cached?.scanned_at || null,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}