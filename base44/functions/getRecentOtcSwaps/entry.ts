// Recent $OTC swaps feed for the swap panel. DexScreener has no public trades
// API, so the last ~10 swaps are decoded directly from on-chain transactions:
// signatures touching the OTC/SOL pair account are fetched via Helius, each tx
// is parsed (jsonParsed), and the trade side/size/price/wallet are derived
// from the OTC + SOL token-balance deltas of the fee payer (falling back to
// the pool account). A short module cache keeps repeat polls off Helius.

import { heliusRpc, ADDRESSES } from "../../shared/otcSources.ts";

const TTL_MS = 20000;
let cache = { ts: 0, swaps: [] };

export default async function (req) {
  try {
    if (cache.swaps.length && Date.now() - cache.ts < TTL_MS) {
      return Response.json({ ok: true, swaps: cache.swaps, cached: true });
    }

    const sigs = await heliusRpc("getSignaturesForAddress", [
      ADDRESSES.DEXSCREENER_PAIR,
      { limit: 14 },
    ]);
    const recent = (Array.isArray(sigs) ? sigs : []).filter((s) => !s.err).slice(0, 10);

    const swaps = [];
    for (const s of recent) {
      try {
        const sig = s.signature || s.sig;
        if (!sig) continue;
        const tx = await heliusRpc("getTransaction", [
          sig,
          { maxSupportedTransactionVersion: 0, encoding: "jsonParsed" },
        ]);
        if (!tx) continue;

        const meta = tx.meta || {};
        const keys = (tx.transaction?.message?.accountKeys || []).map((k) =>
          typeof k === "string" ? k : k.pubkey
        );
        const feePayer = keys[0] || null;

        // Token-balance deltas keyed by token account index (accounts created
        // in this tx have no pre-balance → implicit 0).
        const pre = new Map();
        const post = new Map();
        for (const b of meta.preTokenBalances || []) pre.set(b.accountIndex, b);
        for (const b of meta.postTokenBalances || []) post.set(b.accountIndex, b);

        // Sum uiAmount deltas per (owner, mint) across all token accounts.
        const deltaBy = new Map();
        for (const [idx, b] of post) {
          const owner = b.owner || pre.get(idx)?.owner || "";
          const before = pre.get(idx)?.uiTokenAmount?.uiAmount ?? 0;
          const after = b.uiTokenAmount?.uiAmount ?? 0;
          if (after === before) continue;
          const key = `${owner}|${b.mint}`;
          deltaBy.set(key, (deltaBy.get(key) || 0) + (after - before));
        }
        const deltaOf = (owner, mint) =>
          owner ? deltaBy.get(`${owner}|${mint}`) || 0 : 0;

        const otcMint = ADDRESSES.OTC_TOKEN_MINT;
        const solMint = ADDRESSES.WRAPPED_SOL;

        // Prefer the fee payer's own OTC flip; fall back to the pool account.
        let trader = feePayer;
        let otcDelta = feePayer ? deltaOf(feePayer, otcMint) : 0;
        if (!otcDelta) {
          trader = ADDRESSES.DEXSCREENER_PAIR;
          otcDelta = deltaOf(ADDRESSES.DEXSCREENER_PAIR, otcMint);
        }
        if (!otcDelta) continue; // not a recognizable swap on this pair

        const side = otcDelta > 0 ? "BUY" : "SELL";
        const otcAmount = Math.abs(otcDelta);
        let solAmount = trader ? Math.abs(deltaOf(trader, solMint)) : 0;
        if (!solAmount) {
          // Native-SOL leg (pool holds raw lamports, not WSOL).
          const idx = keys.indexOf(ADDRESSES.DEXSCREENER_PAIR);
          if (idx >= 0 && meta.preBalances && meta.postBalances) {
            solAmount = Math.abs((meta.postBalances[idx] - meta.preBalances[idx]) / 1e9);
          }
        }

        swaps.push({
          sig,
          side,
          otc_amount: otcAmount,
          sol_amount: solAmount || null,
          price_sol: solAmount ? solAmount / otcAmount : null,
          wallet: feePayer,
          time: s.blockTime || tx.blockTime || null,
        });
      } catch {
        /* skip unreadable tx */
      }
    }

    cache = { ts: Date.now(), swaps };
    return Response.json({ ok: true, swaps });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}