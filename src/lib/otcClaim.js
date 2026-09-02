// OTC on-chain claim client. Reverse-engineered from the otcdesks.cash IDL.
// Reliability/safety model:
//  - claim moves stock from the desk vault -> the signer's OWN wallet ATA.
//    The program enforces that the signer owns the NFT, so a wrong asset is
//    rejected at simulation. No third party ever receives funds.
//  - Every transaction is SIMULATED before it is signed or sent. A failing
//    simulation is logged and skipped — the wallet is never asked to sign a
//    tx that would fail, so no fee is spent on a broken tx.
//  - Only tickers with a real on-chain balance > 0 are claimed (nothing to
//    claim otherwise), so we never send empty/no-op transactions.

import { Buffer } from "buffer";
import "@/lib/bufferPolyfill";
import { base44 } from "@/api/base44Client";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  ACCOUNT_SIZE,
  AccountLayout,
} from "@solana/spl-token";

export const PROGRAM_ID = new PublicKey(
  "AjMx5My4YUDHMiCtLpTAtgkiUJgrpJnQqd5AcQnddHQW"
);
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);
const ATA_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);
const SYSTEM_PROGRAM_ID = new PublicKey(
  "11111111111111111111111111111111"
);

const CLAIM_DISC = Buffer.from([62, 198, 214, 193, 213, 159, 108, 210]);
const OPEN_DISC = Buffer.from([146, 211, 204, 136, 189, 212, 73, 196]);
const OPEN_EXT_DISC = Buffer.from([218, 121, 110, 45, 87, 244, 170, 225]);
const DISTRIBUTE_DISC = Buffer.from([191, 44, 223, 207, 164, 236, 126, 61]);

export const STOCKS = [
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

// One public mainnet connection for reads/simulation/send. No secret needed.
const RPC_URL = "https://api.mainnet-beta.solana.com";
let _conn = null;
function conn() {
  if (!_conn) _conn = new Connection(RPC_URL, "confirmed");
  return _conn;
}

// Route all client-side Solana RPC (blockhash / simulate / send) through the
// backend solanaRelay function, which uses the app's Helius key server-side.
// The public api.mainnet-beta endpoint rate-limits / 403s from the browser,
// which broke packing and sending. The wallet still signs locally; only the
// already-signed bytes are relayed.
export async function relay(mode, payload = {}) {
  const res = await base44.functions.invoke("solanaRelay", { mode, ...payload });
  const data = res?.data || {};
  if (data.error) throw new Error(data.error);
  return data;
}

const pda = (seeds) =>
  PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const configPda = () => pda([Buffer.from("config")]);
const configExtPda = () => pda([Buffer.from("config_ext")]);
const vaultPda = (asset) => pda([Buffer.from("vault"), new PublicKey(asset).toBuffer()]);
const vaultExtPda = (vault) => pda([Buffer.from("vault_ext"), vault.toBuffer()]);

// The OTC program derives stock token accounts with a CUSTOM seed order —
// [owner, tokenProgram, mint] under the ATA program — NOT the standard
// [mint, owner, tokenProgram] ATA order (verified on-chain against the vault's
// real token accounts). The standard getAssociatedTokenAddressSync produces
// the wrong address, so claims would fail simulation; derive manually.
function stockAta(owner, mint, tokenProgram) {
  const tp = tokenProgram || TOKEN_PROGRAM_ID;
  return PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBuffer(), new PublicKey(tp).toBuffer(), new PublicKey(mint).toBuffer()],
    ATA_PROGRAM_ID
  )[0];
}
function nftStockAta(vault, mint, tokenProgram) {
  return stockAta(vault, mint, tokenProgram);
}
function userStockAta(user, mint, tokenProgram) {
  return stockAta(user, mint, tokenProgram);
}

// Resolve which token program owns each stock mint (Token-2022 vs standard).
export async function resolveTokenPrograms() {
  const mints = STOCKS.map((s) => s.mint);
  const r = await relay("accounts", { pubkeys: mints });
  const accounts = r.accounts || [];
  const map = {};
  const t22 = TOKEN_2022_PROGRAM_ID.toBase58();
  STOCKS.forEach((s, i) => {
    const owner = accounts[i]?.owner;
    map[s.mint] = owner === t22 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  });
  return map;
}

// Scan desks: for each asset + ticker, read the on-chain nft_stock balance.
export async function scanDesks(assets, tokenProgramMap) {
  const result = [];
  for (const a of assets) {
    const assetPk = new PublicKey(a.asset_id);
    const vault = vaultPda(assetPk);
    const nftStockAddrs = STOCKS.map((s) =>
      nftStockAta(vault, s.mint, tokenProgramMap[s.mint]).toBase58()
    );
    const r = await relay("accounts", { pubkeys: nftStockAddrs });
    const accounts = r.accounts || [];
    const tickerRows = [];
    for (let i = 0; i < STOCKS.length; i++) {
      const s = STOCKS[i];
      const acc = accounts[i];
      let amount = 0n;
      let exists = false;
      if (acc?.data) {
        try {
          const buf = Buffer.from(acc.data, "base64");
          if (buf.length >= ACCOUNT_SIZE) {
            const decoded = AccountLayout.decode(buf);
            // owner field must be the vault for it to be the right account
            if (decoded.owner.equals(vault)) {
              amount = decoded.amount;
              exists = true;
            }
          }
        } catch {
          /* not a token account */
        }
      }
      tickerRows.push({
        index: s.index,
        symbol: s.symbol,
        mint: s.mint,
        decimals: s.decimals,
        extended: s.extended,
        amount: Number(amount),
        exists,
      });
    }
    const claimable = tickerRows.filter((t) => t.exists && t.amount > 0);
    result.push({
      asset_id: a.asset_id,
      name: a.name,
      image_url: a.image_url,
      tickers: tickerRows,
      claimable,
    });
  }
  return result;
}

function buildClaimIx(user, assetId, ticker, tokenProgramMap) {
  const userPk = new PublicKey(user);
  const assetPk = new PublicKey(assetId);
  const vault = vaultPda(assetPk);
  const tp = new PublicKey(tokenProgramMap[ticker.mint] || TOKEN_PROGRAM_ID);
  const nftStock = nftStockAta(vault, ticker.mint, tp);
  const userStock = userStockAta(userPk, ticker.mint, tp);

  const keys = [
    { pubkey: userPk, isSigner: true, isWritable: true },
    { pubkey: configPda(), isSigner: false, isWritable: false },
  ];
  if (ticker.extended) {
    keys.push({ pubkey: configExtPda(), isSigner: false, isWritable: false });
  }
  keys.push({ pubkey: assetPk, isSigner: false, isWritable: false });
  keys.push({ pubkey: vault, isSigner: false, isWritable: true });
  if (ticker.extended) {
    keys.push({ pubkey: vaultExtPda(vault), isSigner: false, isWritable: true });
  }
  keys.push({ pubkey: new PublicKey(ticker.mint), isSigner: false, isWritable: false });
  keys.push({ pubkey: nftStock, isSigner: false, isWritable: true });
  keys.push({ pubkey: userStock, isSigner: false, isWritable: true });
  keys.push({ pubkey: tp, isSigner: false, isWritable: false });
  keys.push({ pubkey: ATA_PROGRAM_ID, isSigner: false, isWritable: false });
  keys.push({ pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false });

  const data = Buffer.concat([CLAIM_DISC, Buffer.from([ticker.index])]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys,
    data,
  });
}

// Pack instructions into transactions by serialized message size (legacy tx
// limit ~1232 bytes). Each tx gets a compute-budget instruction up front.
const MAX_MSG_BYTES = 1000;

async function packTxs(ixs, user) {
  const bh = await relay("blockhash");
  const blockhash = bh.blockhash;
  const userPk = new PublicKey(user);
  const txs = [];
  let cur = null;
  const finalize = () => {
    if (cur) txs.push(cur);
    cur = null;
  };
  for (const ix of ixs) {
    if (!cur) {
      cur = new Transaction();
      cur.feePayer = userPk;
      cur.recentBlockhash = blockhash;
      cur.add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 })
      );
    }
    cur.add(ix);
    const size = cur.serializeMessage().length;
    if (size > MAX_MSG_BYTES) {
      cur.instructions.pop(); // remove the ix that overflowed
      if (cur.instructions.length > 2) {
        finalize();
        // start a new tx for this ix
        cur = new Transaction();
        cur.feePayer = userPk;
        cur.recentBlockhash = blockhash;
        cur.add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 })
        );
        cur.add(ix);
      }
    }
  }
  finalize();
  return txs;
}

// Simulate a tx (unsigned) before asking the wallet to sign.
async function simulate(tx) {
  try {
    const b64 = tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64");
    const r = await relay("simulate", { tx: b64 });
    if (r.err) {
      return { ok: false, err: r.err, logs: r.logs };
    }
    return { ok: true, units: r.units, logs: r.logs };
  } catch (e) {
    return { ok: false, err: e.message, logs: [] };
  }
}

// Execute a list of (already-built) transactions: simulate -> sign -> send.
// `signTransactionRaw(tx)` returns signed serialized bytes (Uint8Array); it
// delegates to the connected wallet (injected or Wallet Standard) and never
// exposes private keys. Simulation runs first so a failing tx is skipped
// before signing (no fee spent).
export async function executeClaimTxs(txs, signTransactionRaw, onLog) {
  const results = [];
  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i];
    onLog({ type: "info", msg: `TX ${i + 1}/${txs.length} :: simulating...` });
    const sim = await simulate(tx);
    if (!sim.ok) {
      onLog({ type: "err", msg: `TX ${i + 1} SIM_FAIL: ${sim.err}` });
      results.push({ ok: false, reason: sim.err });
      continue;
    }
    onLog({ type: "sim", msg: `TX ${i + 1} sim OK (${sim.units} CU). requesting signature...` });
    let signedBytes;
    try {
      signedBytes = await signTransactionRaw(tx);
    } catch (e) {
      onLog({ type: "err", msg: `TX ${i + 1} SIGN_REJECTED: ${e.message}` });
      results.push({ ok: false, reason: "rejected" });
      break; // user rejected — stop the batch
    }
    try {
      const r = await relay("send", { tx: Buffer.from(signedBytes).toString("base64") });
      const sig = r.sig;
      onLog({ type: "ok", msg: `TX ${i + 1} SENT ${sig}`, sig });
      results.push({ ok: true, sig });
    } catch (e) {
      onLog({ type: "err", msg: `TX ${i + 1} SEND_FAIL: ${e.message}` });
      results.push({ ok: false, reason: e.message });
    }
  }
  return results;
}

// Build claim instructions for a set of desks' claimable tickers, in order.
export async function buildClaimInstructions(deskPlans, user, tokenProgramMap) {
  const ixs = [];
  for (const d of deskPlans) {
    for (const t of d.claimable) {
      ixs.push(buildClaimIx(user, d.asset_id, t, tokenProgramMap));
    }
  }
  return ixs;
}

// open_ticker_account(index) / open_ticker_account_ext(index): creates the
// desk vault's stock token account (nft_stock PDA) for a ticker so the desk
// can accrue that ticker's distributions. Required when a new ticker is added
// to the lineup and an existing desk hasn't been activated for it yet. Same
// accounts as claim minus user_stock (we create the vault account, not the
// user's). Simulated before signing like claim, so a wrong account list fails
// safely at sim time.
function buildOpenTickerIx(user, assetId, ticker, tokenProgramMap) {
  const userPk = new PublicKey(user);
  const assetPk = new PublicKey(assetId);
  const vault = vaultPda(assetPk);
  const tp = new PublicKey(tokenProgramMap[ticker.mint] || TOKEN_PROGRAM_ID);
  const nftStock = nftStockAta(vault, ticker.mint, tp);
  const disc = ticker.extended ? OPEN_EXT_DISC : OPEN_DISC;
  const keys = [
    { pubkey: userPk, isSigner: true, isWritable: true },
    { pubkey: configPda(), isSigner: false, isWritable: false },
  ];
  if (ticker.extended) {
    keys.push({ pubkey: configExtPda(), isSigner: false, isWritable: false });
  }
  keys.push({ pubkey: assetPk, isSigner: false, isWritable: false });
  keys.push({ pubkey: vault, isSigner: false, isWritable: true });
  if (ticker.extended) {
    keys.push({ pubkey: vaultExtPda(vault), isSigner: false, isWritable: true });
  }
  keys.push({ pubkey: new PublicKey(ticker.mint), isSigner: false, isWritable: false });
  keys.push({ pubkey: nftStock, isSigner: false, isWritable: true });
  keys.push({ pubkey: tp, isSigner: false, isWritable: false });
  keys.push({ pubkey: ATA_PROGRAM_ID, isSigner: false, isWritable: false });
  keys.push({ pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false });
  const data = Buffer.concat([disc, Buffer.from([ticker.index])]);
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data });
}

// Build open_ticker_account ixs for every ticker on the given desks whose
// vault stock account is NOT yet open (exists=false).
export async function buildActivateInstructions(deskPlans, user, tokenProgramMap) {
  const ixs = [];
  for (const d of deskPlans) {
    for (const t of d.tickers || []) {
      if (!t.exists) ixs.push(buildOpenTickerIx(user, d.asset_id, t, tokenProgramMap));
    }
  }
  return ixs;
}

// On-chain distribution lineup (slot index -> stock). Recovered from the
// program's config/config_ext accounts — NOT the same order as STOCKS above.
// distribute(slot) credits a desk's owed share of that stock from the
// protocol pool (ATA of the config PDA) into the desk vault's nft_stock ATA.
// All 13 mints are Token-2022. Permissionless: the fee payer signs the tx but
// is not an instruction signer, so anyone can trigger delivery for any desk.
export const LINEUP_STOCKS = [
  { slot: 0,  symbol: "AAPLx",      mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", decimals: 8 },
  { slot: 1,  symbol: "MSFTx",      mint: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX", decimals: 8 },
  { slot: 2,  symbol: "NVDAx",      mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", decimals: 8 },
  { slot: 3,  symbol: "AMZNx",      mint: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg", decimals: 8 },
  { slot: 4,  symbol: "CRCLx",      mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1", decimals: 8 },
  { slot: 5,  symbol: "SPCXx",      mint: "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8", decimals: 8 },
  { slot: 6,  symbol: "ANTHROPIC",  mint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw", decimals: 9 },
  { slot: 7,  symbol: "POLYMARKET", mint: "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP", decimals: 9 },
  { slot: 8,  symbol: "KALSHI",     mint: "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua", decimals: 9 },
  { slot: 9,  symbol: "NEURALINK",   mint: "PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S", decimals: 9 },
  { slot: 10, symbol: "OTC",        mint: "MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump", decimals: 6 },
  { slot: 11, symbol: "ANDURIL",    mint: "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB", decimals: 9 },
  { slot: 12, symbol: "OPENAI",     mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", decimals: 9 },
];

function buildDistributeIx(assetId, slot, mint, tokenProgramMap) {
  const vault = vaultPda(new PublicKey(assetId));
  const tp = new PublicKey(tokenProgramMap?.[mint] || TOKEN_2022_PROGRAM_ID);
  const stockMint = new PublicKey(mint);
  // pool = ATA of the config PDA (protocol's holding of this stock).
  const pool = stockAta(configPda(), mint, tp);
  const nftStock = nftStockAta(vault, mint, tp);
  const keys = [
    { pubkey: configPda(), isSigner: false, isWritable: true },
    { pubkey: configExtPda(), isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: vaultExtPda(vault), isSigner: false, isWritable: true },
    { pubkey: stockMint, isSigner: false, isWritable: false },
    { pubkey: pool, isSigner: false, isWritable: true },
    { pubkey: nftStock, isSigner: false, isWritable: true },
    { pubkey: tp, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  const data = Buffer.concat([DISTRIBUTE_DISC, Buffer.from([slot])]);
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data });
}

// Build distribute(index) ixs for every lineup slot for each selected desk.
// Permissionless delivery: triggers the desk's owed stock backlog into its
// vault so it becomes claimable. No-op (succeeds, delivers 0) for slots the
// desk is already current on.
export async function buildDistributeInstructions(deskPlans, _user, tokenProgramMap) {
  const ixs = [];
  for (const d of deskPlans) {
    for (const s of LINEUP_STOCKS) {
      ixs.push(buildDistributeIx(d.asset_id, s.slot, s.mint, tokenProgramMap));
    }
  }
  return ixs;
}

export { packTxs };