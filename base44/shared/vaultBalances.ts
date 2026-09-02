// Shared on-chain vault-stock reader for OTC desks.
//
// Derives every desk's per-ticker vault token accounts (nft_stock ATAs) and
// reads their REAL balances through Helius. One authoritative implementation
// shared by the wallet claim scan (scanWalletClaims) and the snapshot ingest's
// listing integrity check (otcSnapshot) — so a claimed-out desk is detected
// identically everywhere and nothing can credit a vault with stock it no
// longer holds.
//
// PDA derivation (verified on-chain):
//   vault     = PDA(["vault", asset]) under the OTC program
//   nft_stock = ATA with CUSTOM seed order [vault, tokenProgram, mint] under
//               the ATA program — NOT the standard [mint, owner, tokenProgram]

import { Buffer } from "node:buffer";
import { heliusRpc } from "./otcSources.ts";
import { PROGRAM_ID, STOCKS } from "./otcIdl.ts";

// web3.js expects a global Buffer; set it before the module is imported.
if (!globalThis.Buffer) globalThis.Buffer = Buffer;
const { PublicKey } = await import("npm:@solana/web3.js@1.98.4");

const OTC_PROGRAM_ID = new PublicKey(PROGRAM_ID);
const ATA_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

const BATCH = 100; // getMultipleAccounts caps at 100 pubkeys per call
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_DESKS = 100; // hard cap — callers already bound their own inputs

function vaultPda(assetStr) {
  const assetPk = new PublicKey(assetStr);
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), assetPk.toBuffer()],
    OTC_PROGRAM_ID
  );
  return vault;
}

// Custom seed order [vault, tokenProgram, mint] (verified on-chain) — NOT the
// standard [mint, owner, tokenProgram] ATA order.
function nftStockAta(vault, mintStr, tokenProgramPk) {
  const tp = tokenProgramPk || TOKEN_PROGRAM_ID;
  const [addr] = PublicKey.findProgramAddressSync(
    [vault.toBuffer(), tp.toBuffer(), new PublicKey(mintStr).toBuffer()],
    ATA_PROGRAM_ID
  );
  return addr;
}

// Resolve whether each stock mint lives under the standard Token program or
// Token-2022 (the "extended" tickers use Token-2022). Defaults to the standard
// Token program on any failure.
async function resolveTokenPrograms() {
  const mints = STOCKS.map((s) => s.mint);
  let value;
  try {
    const result = await heliusRpc("getMultipleAccounts", [mints, { encoding: "base64" }]);
    value = result?.value || [];
  } catch {
    value = mints.map(() => null);
  }
  const map = {};
  const t22 = TOKEN_2022_PROGRAM_ID.toBase58();
  for (let i = 0; i < mints.length; i++) {
    map[mints[i]] = value[i]?.owner === t22 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  }
  return map;
}

// Read the REAL vault stock for the given desk asset ids.
// Returns Map<asset_id, { tickers, claimable, hasStock }> — tickers match the
// claim-scan shape ({index,symbol,mint,decimals,extended,amount,exists,
// token_program}). Never throws: a failed RPC batch degrades to "account
// missing" (amount 0), exactly like the wallet scan. Invalid ids are skipped.
export async function readVaultStock(assetIds) {
  const ids = [...new Set(assetIds || [])]
    .filter((a) => typeof a === "string" && BASE58_RE.test(a))
    .slice(0, MAX_DESKS);
  const result = new Map();
  if (!ids.length) return result;

  const tpMap = await resolveTokenPrograms();
  const vaults = ids.map((id) => vaultPda(id));

  // Flat list of vault stock ATA addresses to read.
  const flat = []; // {d, t, addr}
  for (let d = 0; d < ids.length; d++) {
    for (let t = 0; t < STOCKS.length; t++) {
      flat.push({
        d,
        t,
        addr: nftStockAta(vaults[d], STOCKS[t].mint, tpMap[STOCKS[t].mint]).toBase58(),
      });
    }
  }

  const info = new Map(); // addr -> { exists, amount, tokenProgram }
  for (let i = 0; i < flat.length; i += BATCH) {
    const slice = flat.slice(i, i + BATCH);
    const pubkeys = slice.map((x) => x.addr);
    let value;
    try {
      const rpcResult = await heliusRpc("getMultipleAccounts", [
        pubkeys,
        { encoding: "jsonParsed" },
      ]);
      value = rpcResult?.value || [];
    } catch {
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

  for (let d = 0; d < ids.length; d++) {
    const tickers = STOCKS.map((s) => {
      const tp = tpMap[s.mint];
      const addr = nftStockAta(vaults[d], s.mint, tp).toBase58();
      const r = info.get(addr) || { exists: false, amount: 0, tokenProgram: null };
      return {
        index: s.index,
        symbol: s.symbol,
        mint: s.mint,
        decimals: s.decimals,
        extended: s.extended,
        amount: r.exists ? r.amount : 0,
        exists: r.exists,
        token_program: r.exists ? r.tokenProgram : tp ? tp.toBase58() : null,
      };
    });
    const claimable = tickers.filter((x) => x.exists && x.amount > 0);
    result.set(ids[d], { tickers, claimable, hasStock: claimable.length > 0 });
  }
  return result;
}