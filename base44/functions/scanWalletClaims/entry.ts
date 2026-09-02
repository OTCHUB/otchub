// Reliable, cached on-chain claim scan for a wallet's OTC desks.
//
// Why a backend function: the client scan was hanging on the rate-limited
// public Solana RPC ("Resolving token programs..." stuck). This runs the
// same PDA/account reads through Helius (server-side API key) which is far
// more reliable, AND caches the full per-wallet result in the ClaimCache
// entity so the next access is instant instead of re-hitting RPC.
//
// Flow:
//  - cacheOnly=true: return cached results if fresh, else empty (no scan).
//    Used by the claim panel on mount for instant claimable badges.
//  - force=true: always re-scan on-chain and refresh the cache.
//  - default: return fresh cache if within TTL, else scan + cache.
//
// Balances only move on protocol distributions / claims; a 5-min TTL matches
// the snapshot cadence, and the claim flow always simulates before signing,
// so a slightly stale cached balance is caught safely at sign time.

import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { Buffer } from "node:buffer";
import { heliusRpc } from "../../shared/otcSources.ts";

// web3.js expects a global Buffer; set it before the module is imported.
if (!globalThis.Buffer) globalThis.Buffer = Buffer;
const { PublicKey } = await import("npm:@solana/web3.js@1.98.4");

const PROGRAM_ID = new PublicKey("AjMx5My4YUDHMiCtLpTAtgkiUJgrpJnQqd5AcQnddHQW");
const ATA_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

// Same stock registry as the client (src/lib/otcClaim.js). Kept in sync so the
// backend can derive vault stock ATAs without the client.
const STOCKS = [
  { index: 0, symbol: "ANDURIL", mint: "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB", decimals: 9, extended: false },
  { index: 1, symbol: "OPENAI", mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", decimals: 9, extended: false },
  { index: 2, symbol: "AAPLx", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", decimals: 8, extended: false },
  { index: 3, symbol: "MSFTx", mint: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX", decimals: 8, extended: false },
  { index: 4, symbol: "NVDAx", mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", decimals: 8, extended: false },
  { index: 5, symbol: "AMZNx", mint: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg", decimals: 8, extended: false },
  { index: 6, symbol: "CRCLx", mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1", decimals: 8, extended: false },
  { index: 7, symbol: "SPCXx", mint: "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8", decimals: 8, extended: false },
  { index: 8, symbol: "ANTHROPIC", mint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw", decimals: 9, extended: false },
  { index: 9, symbol: "POLYMARKET", mint: "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP", decimals: 9, extended: false },
  { index: 10, symbol: "KALSHI", mint: "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua", decimals: 9, extended: true },
  { index: 11, symbol: "NEURALINK", mint: "PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S", decimals: 9, extended: true },
  { index: 12, symbol: "OTC", mint: "MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump", decimals: 6, extended: true },
];

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_VERSION = 2; // bump to invalidate stale caches (e.g. fixed PDA derivation)
const BATCH = 100;

function vaultPda(assetStr) {
  const assetPk = new PublicKey(assetStr);
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), assetPk.toBuffer()],
    PROGRAM_ID
  );
  return vault;
}

// Associated token account PDA seeds are [mint, owner, tokenProgram] under the
// ATA program — the token program is a REQUIRED seed. The previous derivation
// omitted it, producing wrong addresses (every account read as non-existent,
// so all balances showed 0). This now matches the client's
// getAssociatedTokenAddressSync(mint, vault, true, tp, ATA_PROGRAM).
function nftStockAta(vault, mintStr, tokenProgramPk) {
  const tp = tokenProgramPk || TOKEN_PROGRAM_ID;
  // Custom seed order [vault, tokenProgram, mint] (verified on-chain) — NOT the
  // standard [mint, owner, tokenProgram] ATA order.
  const [addr] = PublicKey.findProgramAddressSync(
    [vault.toBuffer(), tp.toBuffer(), new PublicKey(mintStr).toBuffer()],
    ATA_PROGRAM_ID
  );
  return addr;
}

// Resolve whether each stock mint lives under the standard Token program or
// Token-2022 (the "extended" tickers use Token-2022). Needed to derive the
// correct vault ATA. Defaults to the standard Token program on any failure.
async function resolveTokenPrograms() {
  const mints = STOCKS.map((s) => s.mint);
  let value;
  try {
    const result = await heliusRpc("getMultipleAccounts", [
      mints,
      { encoding: "base64" },
    ]);
    value = result?.value || [];
  } catch {
    value = mints.map(() => null);
  }
  const map = {};
  const t22 = TOKEN_2022_PROGRAM_ID.toBase58();
  for (let i = 0; i < mints.length; i++) {
    map[mints[i]] =
      value[i]?.owner === t22 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  }
  return map;
}

async function saveCache(base44, existing, wallet, desks) {
  const payload = { items: desks, _v: CACHE_VERSION };
  if (existing?.id) {
    await base44.asServiceRole.entities.ClaimCache.update(existing.id, { desks: payload });
  } else {
    await base44.asServiceRole.entities.ClaimCache.create({ wallet, desks: payload });
  }
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const wallet = (body.wallet || body.address || "").trim();
    const force = body.force === true;
    const cacheOnly = body.cacheOnly === true;
    if (!wallet) return Response.json({ error: "wallet required" }, { status: 400 });

    // The caller already knows which desks the wallet owns (from the portfolio
    // fetch). Accept that list directly so the scan covers exactly the NFTs
    // shown in the panel — falling back to NftHolding-by-owner only when the
    // caller didn't pass assets.
    // Bounded, validated input: cap the caller-supplied desk list (defensive
    // against oversized payloads burning RPC quota) and require plausible
    // base58 asset ids so a malformed id can't reach the PDA derivation.
    const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    const assetsIn = Array.isArray(body.assets) ? body.assets.slice(0, 100) : null;
    let desks;
    if (assetsIn && assetsIn.length) {
      desks = assetsIn
        .filter((a) => a && a.asset_id && BASE58_RE.test(a.asset_id))
        .map((a) => ({ asset_id: a.asset_id, name: a.name, image_url: a.image_url }));
    } else {
      const holdings = await base44.asServiceRole.entities.NftHolding.filter({ owner: wallet });
      desks = (holdings || []).map((h) => ({
        asset_id: h.asset_id,
        name: h.name,
        image_url: h.image_url,
      }));
    }

    // Cache lookup
    const cachedRows = await base44.asServiceRole.entities.ClaimCache.filter({ wallet });
    const cache = cachedRows?.[0] || null;
    const fresh =
      cache?.updated_date &&
      Date.now() - new Date(cache.updated_date).getTime() < CACHE_TTL_MS &&
      cache?.desks?._v === CACHE_VERSION;

    if (!force && cache && fresh) {
      return Response.json({
        ok: true,
        cached: true,
        desks: cache.desks?.items || [],
        wallet,
        desks_count: desks.length,
      });
    }
    if (cacheOnly) {
      return Response.json({
        ok: true,
        cached: false,
        empty: true,
        desks: [],
        wallet,
        desks_count: desks.length,
      });
    }

    if (!desks.length) {
      await saveCache(base44, cache, wallet, []);
      return Response.json({ ok: true, fresh: true, desks: [], wallet, desks_count: 0 });
    }

    // Resolve each stock mint's token program (Token vs Token-2022) so the
    // vault ATA is derived with the correct [mint, vault, tokenProgram] seeds.
    const tpMap = await resolveTokenPrograms();

    // Build the flat list of vault stock ATA addresses to read.
    const vaults = desks.map((d) => vaultPda(d.asset_id));
    const flat = []; // {d, t, addr}
    for (let d = 0; d < desks.length; d++) {
      for (let t = 0; t < STOCKS.length; t++) {
        flat.push({
          d,
          t,
          addr: nftStockAta(vaults[d], STOCKS[t].mint, tpMap[STOCKS[t].mint]).toBase58(),
        });
      }
    }

    // Read all account infos (chunked — getMultipleAccountsInfo caps at 100).
    const info = new Map(); // addr -> { exists, amount, tokenProgram }
    for (let i = 0; i < flat.length; i += BATCH) {
      const slice = flat.slice(i, i + BATCH);
      const pubkeys = slice.map((x) => x.addr);
      let value;
      try {
        const result = await heliusRpc("getMultipleAccounts", [
          pubkeys,
          { encoding: "jsonParsed" },
        ]);
        value = result?.value || [];
      } catch (e) {
        value = pubkeys.map(() => null);
      }
      for (let j = 0; j < slice.length; j++) {
        const acc = value[j];
        if (!acc) {
          info.set(slice[j].addr, { exists: false, amount: 0, tokenProgram: null });
          continue;
        }
        const tokenProgram = acc.owner || null; // top-level: the SPL program
        const vaultOwner = acc?.data?.parsed?.info?.owner || null;
        const amtStr = acc?.data?.parsed?.info?.tokenAmount?.amount;
        const amount = amtStr != null ? Number(amtStr) : 0;
        info.set(slice[j].addr, {
          exists: vaultOwner === vaults[slice[j].d].toBase58(),
          amount,
          tokenProgram,
        });
      }
    }

    // Assemble per-desk results.
    const out = desks.map((d, di) => {
      const tickers = STOCKS.map((s, t) => {
        const tp = tpMap[s.mint];
        const addr = nftStockAta(vaults[di], s.mint, tp).toBase58();
        const r = info.get(addr) || { exists: false, amount: 0, tokenProgram: null };
        return {
          index: s.index,
          symbol: s.symbol,
          mint: s.mint,
          decimals: s.decimals,
          extended: s.extended,
          amount: r.exists ? r.amount : 0,
          exists: r.exists,
          token_program: r.exists ? r.tokenProgram : (tp ? tp.toBase58() : null),
        };
      });
      const claimable = tickers.filter((x) => x.exists && x.amount > 0);
      return { asset_id: d.asset_id, name: d.name, image_url: d.image_url, tickers, claimable };
    });

    await saveCache(base44, cache, wallet, out);
    return Response.json({ ok: true, fresh: true, desks: out, wallet, desks_count: desks.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}