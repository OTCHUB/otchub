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

// ---- Priority fee policy ----
// Ask Helius for the current recommended µlamports/CU for the accounts we're
// about to write (contended desk vault / config PDAs can need more than the
// global average), then clamp into a sane band so gas stays reasonable:
//   floor 2,000 µ/CU — high enough to beat zero-fee spam when the network is quiet
//   cap 1,000,000 µ/CU — a 200k-CU claim tx costs at most ~0.0002 SOL
// This keeps claim txs from sitting PENDING forever on congested networks
// without overpaying on quiet ones.
const FEE_FLOOR_UL = 2_000;
const FEE_CAP_UL = 1_000_000;

export async function currentPriorityFee(accountKeys = []) {
  try {
    const r = await relay("fee", { pubkeys: accountKeys.slice(0, 128) });
    const est = Number(r.microLamports);
    if (!Number.isFinite(est) || est <= 0) return FEE_FLOOR_UL;
    return Math.min(FEE_CAP_UL, Math.max(FEE_FLOOR_UL, Math.round(est)));
  } catch {
    return FEE_FLOOR_UL;
  }
}

// Writable account keys across a set of instructions — fed to the fee
// estimator so the estimate reflects contention on the PDAs being written.
function writableKeys(ixs) {
  return [...new Set(ixs.flatMap((ix) => ix.keys.filter((k) => k.isWritable).map((k) => k.pubkey.toBase58())))];
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

  // The claim instruction ALWAYS requires config_ext + vault_ext, even for
  // non-extended tickers — without them the program reads the next account
  // (the Metaplex Core asset) as config_ext and fails AccountOwnedByWrongProgram.
  const keys = [
    { pubkey: userPk, isSigner: true, isWritable: true },
    { pubkey: configPda(), isSigner: false, isWritable: false },
    { pubkey: configExtPda(), isSigner: false, isWritable: false },
    { pubkey: assetPk, isSigner: false, isWritable: false },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: vaultExtPda(vault), isSigner: false, isWritable: true },
    { pubkey: new PublicKey(ticker.mint), isSigner: false, isWritable: false },
    { pubkey: nftStock, isSigner: false, isWritable: true },
    { pubkey: userStock, isSigner: false, isWritable: true },
    { pubkey: tp, isSigner: false, isWritable: false },
    { pubkey: ATA_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

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

async function packTxs(ixs, user, microLamports = FEE_FLOOR_UL) {
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
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports })
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
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports })
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

// Batched simulation: one relay invocation per ~25 txs instead of one per tx
// — far fewer round trips (latency + invocation overhead) on big runs. Each
// item has the same result shape as simulate().
export async function simulateMany(txs) {
  const out = [];
  for (let i = 0; i < txs.length; i += 25) {
    const b64s = txs
      .slice(i, i + 25)
      .map((t) =>
        t.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64")
      );
    const r = await relay("simulateBatch", { txs: b64s });
    for (const s of r.results || []) {
      out.push(
        s && s.err
          ? { ok: false, err: s.err, logs: s.logs || [] }
          : { ok: true, units: s?.units, logs: s?.logs || [] }
      );
    }
  }
  return out;
}

// Batched broadcast of already-signed base64 txs — one relay invocation per
// ~20 txs. Each item is { ok: true, sig } or { ok: false, reason }.
export async function sendMany(b64s) {
  const out = [];
  for (let i = 0; i < b64s.length; i += 20) {
    const r = await relay("sendBatch", { txs: b64s.slice(i, i + 20) });
    for (const s of r.results || []) {
      out.push(s?.sig ? { ok: true, sig: s.sig } : { ok: false, reason: s?.error || "send failed" });
    }
  }
  return out;
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
      const errLine = (sim.logs || []).find((l) => l.includes("Error Message")) ||
        (sim.logs || []).find((l) => l.includes("Error Code"));
      onLog({
        type: "err",
        msg: `TX ${i + 1} SIM_FAIL: ${sim.err}${errLine ? ` :: ${errLine.replace("Program log: ", "")}` : ""}`,
      });
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

// Run a bounded number of async tasks at once. Keeps large parallel batches
// (simulate/send of dozens of txs) from hammering Helius rate limits while
// still finishing well inside the blockhash validity window.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) break;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

// Race a promise against a timeout so a stalled RPC relay (e.g. a broadcast
// that never confirms) can never hang the whole batch indefinitely.
async function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// A broadcast the RPC accepted can still sit PENDING forever on a congested
// network — the tx was accepted but landed in no block. Poll each sent
// signature; as soon as all have landed, return (usually one short poll).
// Anything still unseen after the polls is RE-BROADCAST once with the same
// signed bytes (idempotent — Helius returns "already processed" if it just
// landed) while the blockhash is still valid, which normally unsticks it.
async function ensureConfirmed(entries, onLog) {
  if (!entries || !entries.length) return;
  const pending = new Map(entries.map((e) => [e.sig, e.b64]));
  for (const delay of [4000, 6000, 8000]) {
    await new Promise((r) => setTimeout(r, delay));
    let statuses = [];
    try {
      const r = await relay("confirm", { sigs: [...pending.keys()] });
      statuses = r.statuses || [];
    } catch {
      continue;
    }
    [...pending.keys()].forEach((sig, i) => {
      const st = statuses[i];
      if (!st) return; // null → not seen on-chain yet
      if (st.slot != null) {
        // landed. If it errored on-chain, re-sending the same tx can't help.
        if (st.err) {
          onLog({ type: "err", msg: `TX ${sig.slice(0, 8)} FAILED_ON_CHAIN: ${JSON.stringify(st.err)}` });
        }
        pending.delete(sig);
      }
    });
    if (!pending.size) return;
  }
  onLog({ type: "info", msg: `PEND :: ${pending.size} tx(s) unconfirmed — re-broadcasting...` });
  for (const [sig, b64] of pending) {
    try {
      await withTimeout(relay("send", { tx: b64 }), 30000, "rebroadcast");
    } catch (e) {
      onLog({ type: "err", msg: `PEND ${sig.slice(0, 8)} RESEND_FAIL: ${e.message}` });
    }
  }
}

// Batch execution: simulate ALL txs first, then request ONE wallet signature
// for every passing tx (signAllTransactions — a single approval for the whole
// batch on Phantom / Solflare / Backpack), then broadcast them all. A failing
// simulation drops just that tx; the rest still sign and send. Simulations
// and sends run with limited concurrency so an 80+ tx batch finishes in a few
// seconds, safely inside the blockhash validity window.
export async function executeClaimTxsBatch(txs, signAllTransactionsRaw, onLog) {
  const results = [];
  if (!txs || !txs.length) return results;

  onLog({ type: "info", msg: `SIM :: ${txs.length} tx(s)...` });
  const sims = await simulateMany(txs);
  const passing = [];
  for (let i = 0; i < txs.length; i++) {
    const sim = sims[i];
    if (!sim.ok) {
      const errLine = (sim.logs || []).find((l) => l.includes("Error Message")) ||
        (sim.logs || []).find((l) => l.includes("Error Code"));
      onLog({
        type: "err",
        msg: `TX ${i + 1} SIM_FAIL: ${sim.err}${errLine ? ` :: ${errLine.replace("Program log: ", "")}` : ""}`,
      });
      results.push({ ok: false, reason: sim.err });
    } else {
      passing.push({ tx: txs[i], idx: i });
    }
  }
  if (!passing.length) {
    onLog({ type: "err", msg: "All simulations failed — nothing to sign." });
    return results;
  }

  onLog({ type: "info", msg: `SIGN :: 1 prompt for ${passing.length} tx(s)...` });
  let signed;
  try {
    signed = await signAllTransactionsRaw(passing.map((p) => p.tx));
  } catch (e) {
    onLog({ type: "err", msg: `SIGN_REJECTED: ${e.message}` });
    for (const p of passing) results.push({ ok: false, reason: "rejected" });
    return results;
  }
  if (!Array.isArray(signed) || signed.length !== passing.length) {
    onLog({ type: "err", msg: "Wallet returned wrong number of signed txs." });
    for (const p of passing) results.push({ ok: false, reason: "bad-sign" });
    return results;
  }
  onLog({ type: "info", msg: `WALLET_SIGNED :: ${signed.length} tx(s). Broadcasting...` });

  onLog({ type: "info", msg: `SEND :: ${passing.length} tx(s)...` });
  const sends = await sendMany(signed.map((bytes) => Buffer.from(bytes).toString("base64")));
  sends.forEach((s, i) => {
    if (s.ok) onLog({ type: "ok", msg: `TX ${passing[i].idx + 1} SENT ${s.sig}`, sig: s.sig });
    else onLog({ type: "err", msg: `TX ${passing[i].idx + 1} SEND_FAIL: ${s.reason}` });
  });
  for (let i = 0; i < passing.length; i++) {
    const s = sends[i];
    if (s.ok) results.push({ ok: true, sig: s.sig });
    else results.push({ ok: false, reason: s.reason });
  }
  return results;
}

// Chunked execution for large claim runs (300+ claimable). Wallets reject /
// let the blockhash expire on one giant signAll of 100+ txs, so we split the
// instruction list into groups of ~chunkSize, and each group is ONE wallet
// signAll prompt. Each group gets a fresh blockhash, is simulated first (a
// failing sim is dropped — no fee), signed in a single approval, then sent
// sequentially (preserving activate → distribute → claim order) and confirmed
// before the next group. A stalled sign or broadcast times out instead of
// hanging forever. So a 300-ticker claim = a handful of approvals, not one
// giant batch and not 300 individual prompts.
export async function executeClaimChunked(
  ixs,
  user,
  signAllTransactionsRaw,
  onLog,
  chunkSize = 60,
  onProgress
) {
  const results = [];
  if (!ixs || !ixs.length) {
    onLog({ type: "info", msg: "Nothing to do — no instructions." });
    return results;
  }
  const totalGroups = Math.ceil(ixs.length / chunkSize);
  onLog({
    type: "info",
    msg: `CHUNKED :: ${ixs.length} ix(s) in ${totalGroups} group(s) :: ~${totalGroups} wallet approval(s).`,
  });
  onProgress?.({ group: 0, totalGroups, phase: "start", desks: [], signaturesLeft: totalGroups });
  for (let c = 0, g = 0; c < ixs.length; c += chunkSize, g++) {
    const groupNo = g + 1;
    const groupIxs = ixs.slice(c, c + chunkSize);
    // Helius-recommended priority fee for this group's writable accounts,
    // clamped to a sane band — keeps txs from sitting pending on congestion
    // without overpaying when the network is quiet.
    const fee = await currentPriorityFee(writableKeys(groupIxs));
    onLog({ type: "info", msg: `GROUP ${groupNo} :: PRIORITY_FEE ${fee} µlamports/CU (helius est.)` });
    const txs = await packTxs(groupIxs, user, fee); // fresh blockhash per group
    onLog({ type: "info", msg: `GROUP ${groupNo}/${totalGroups} :: ${txs.length} tx(s) :: simulating...` });
    onProgress?.({ group: groupNo, totalGroups, phase: "sim", desks: [], signaturesLeft: totalGroups - groupNo + 1 });
    const sims = await simulateMany(txs);
    const passing = [];
    for (let j = 0; j < txs.length; j++) {
      const sim = sims[j];
      if (!sim.ok) {
        const errLine =
          (sim.logs || []).find((l) => l.includes("Error Message")) ||
          (sim.logs || []).find((l) => l.includes("Error Code"));
        onLog({
          type: "err",
          msg: `G${groupNo} TX ${j + 1} SIM_FAIL: ${sim.err}${errLine ? ` :: ${errLine.replace("Program log: ", "")}` : ""}`,
        });
        results.push({ ok: false, reason: sim.err });
      } else {
        passing.push(txs[j]);
      }
    }
    if (!passing.length) {
      onLog({ type: "err", msg: `GROUP ${groupNo} :: all sims failed — skipping.` });
      continue;
    }
    onLog({ type: "info", msg: `GROUP ${groupNo} :: SIGN :: 1 prompt for ${passing.length} tx(s)...` });
    onProgress?.({ group: groupNo, totalGroups, phase: "sign", desks: [], signaturesLeft: totalGroups - groupNo + 1 });
    let signed;
    try {
      signed = await signAllTransactionsRaw(passing);
    } catch (e) {
      onLog({ type: "err", msg: `GROUP ${groupNo} SIGN_REJECTED: ${e.message || "user rejected the prompt"}` });
      for (let k = 0; k < passing.length; k++) results.push({ ok: false, reason: "rejected" });
      break; // user rejected — stop the whole run
    }
    if (!Array.isArray(signed) || signed.length !== passing.length) {
      onLog({ type: "err", msg: `GROUP ${groupNo} :: wallet returned wrong number of signed txs.` });
      for (let k = 0; k < passing.length; k++) results.push({ ok: false, reason: "bad-sign" });
      continue;
    }
    onLog({ type: "info", msg: `GROUP ${groupNo} :: WALLET_SIGNED :: sending ${signed.length} tx(s) sequentially...` });
    onProgress?.({ group: groupNo, totalGroups, phase: "send", desks: [], signaturesLeft: totalGroups - groupNo });
    const sentEntries = [];
    for (let k = 0; k < signed.length; k++) {
      try {
        const b64 = Buffer.from(signed[k]).toString("base64");
        const r = await withTimeout(relay("send", { tx: b64 }), 60000, `G${groupNo} TX ${k + 1} broadcast`);
        onLog({ type: "ok", msg: `G${groupNo} TX ${k + 1} SENT ${r.sig}`, sig: r.sig });
        sentEntries.push({ sig: r.sig, b64 });
        results.push({ ok: true, sig: r.sig });
      } catch (e) {
        onLog({ type: "err", msg: `G${groupNo} TX ${k + 1} SEND_FAIL: ${e.message}` });
        results.push({ ok: false, reason: e.message });
      }
    }
    // make sure the whole group actually LANDED before the next one starts
    await ensureConfirmed(sentEntries, onLog);
    // brief pause so the next group's blockhash is fresh and prior state committed
    if (c + chunkSize < ixs.length) await new Promise((r) => setTimeout(r, 2000));
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
export async function buildDistributeInstructions(deskPlans, _user, tokenProgramMap, groupBySlot = false) {
  const ixs = [];
  if (groupBySlot) {
    // Slot-major ordering for pure-crank runs: consecutive ixs share the same
    // mint + pool ATA, so packTxs fits more ixs per tx (~2x) → fewer txs, fewer
    // fees, fewer wallet prompts for a global distribute sweep.
    for (const s of LINEUP_STOCKS) {
      for (const d of deskPlans) {
        ixs.push(buildDistributeIx(d.asset_id, s.slot, s.mint, tokenProgramMap));
      }
    }
    return ixs;
  }
  for (const d of deskPlans) {
    for (const s of LINEUP_STOCKS) {
      ixs.push(buildDistributeIx(d.asset_id, s.slot, s.mint, tokenProgramMap));
    }
  }
  return ixs;
}

const SLOT_BY_SYMBOL = Object.fromEntries(LINEUP_STOCKS.map((s) => [s.symbol, s]));

// Build distribute(index) ixs ONLY for the claimable tickers' slots — the
// minimum set needed to clear the program's UndistributedBalance guard so the
// subsequent claims succeed. distribute is permissionless and a no-op for
// slots already current, so it's always safe to run. Use this (vs the full
// buildDistributeInstructions) when you want to unblock claims without pulling
// the full owed backlog into currently-empty vaults.
export async function buildDistributeForClaimable(deskPlans, tokenProgramMap) {
  const ixs = [];
  for (const d of deskPlans) {
    for (const t of d.claimable || []) {
      const slot = SLOT_BY_SYMBOL[t.symbol];
      if (!slot) continue;
      ixs.push(buildDistributeIx(d.asset_id, slot.slot, slot.mint, tokenProgramMap));
    }
  }
  return ixs;
}

// Build one atomic [distribute(slot), claim(ticker)] pair per claimable
// ticker. Each pair is packed into a tx together (never split), so the tx is
// self-contained: its claim depends only on its own distribute landing in the
// SAME tx. That makes every tx independent of every other — no cross-tx
// ordering, no pause between groups, safe parallel send, and far fewer wallet
// approvals (large signAll batches). This is the fast path for claiming
// already-owed stock. Each pair carries its desk name/symbol so the progress
// UI can show exactly which desks the current signing group covers.
export async function buildClaimPairs(deskPlans, user, tokenProgramMap) {
  const pairs = [];
  for (const d of deskPlans) {
    for (const t of d.claimable || []) {
      const slot = SLOT_BY_SYMBOL[t.symbol];
      if (!slot) continue;
      const distIx = buildDistributeIx(d.asset_id, slot.slot, slot.mint, tokenProgramMap);
      const claimIx = buildClaimIx(user, d.asset_id, t, tokenProgramMap);
      pairs.push({
        distIx,
        claimIx,
        deskName: d.name || d.asset_id.slice(0, 8),
        assetId: d.asset_id,
        symbol: t.symbol,
      });
    }
  }
  return pairs;
}

// distribute(slot) advances a desk ONE coin/round at a time for that slot
// (verified against the live program: a desk behind R rounds needs R distribute
// calls before its claim clears UndistributedBalance 6022). So the "atomic
// [distribute, claim] per ticker" fast path only works for desks already
// current (1 round). For desks behind multiple rounds we must emit N
// distributes before the claim. N is found by simulating [dist×N, claim] at
// increasing N — UNSIGNED, so it costs no fee and needs no wallet prompt:
//   OK              → claimable with N distributes
//   6025 NothingToWithdraw → vault has nothing accrued to withdraw (skip)
//   6022 at cap     → still >MAX rounds behind (skip; retry after more buybacks)
//   other error    → skip
const MAX_RESOLVE_N = 8;

function errCode(sim) {
  if (typeof sim.err !== "string") return null;
  const m = sim.err.match(/Custom":(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// Probe each ticker for the minimum distribute count that makes its claim
// simulate OK. Returns per-pair distCount (0 = not claimable) and an
// unclaimable flag. Phase A packs all pairs at distCount=1 and sims the packed
// txs (a handful of sims, fast) — passing txs resolve all their tickers at 1.
// Only the tickers in failing txs are then drilled individually at N=2..MAX.
async function resolveDistCounts(pairs, user, onLog) {
  const userPk = new PublicKey(user);
  const bh = await relay("blockhash");
  const blockhash = bh.blockhash;
  const distCounts = new Array(pairs.length).fill(0);
  const unclaimable = new Array(pairs.length).fill(false);

  // Phase A: pack at distCount=1, sim packed txs.
  const packed = packPairedTxs(
    pairs.map((p) => ({ ...p, distCount: 1 })),
    user,
    blockhash
  );
  const packedSims = await simulateMany(packed.txs);
  const drillIdx = [];
  let fastOk = 0;
  for (let ti = 0; ti < packed.txs.length; ti++) {
    const sim = packedSims[ti];
    const members = packed.members[ti];
    if (sim.ok) {
      for (const idx of members) {
        distCounts[idx] = 1;
        fastOk++;
      }
    } else {
      // a failing packed tx usually means at least one member is behind >1 round
      // (or unclaimable) — drill each member individually.
      drillIdx.push(...members);
    }
  }
  onLog({
    type: "info",
    msg: `RESOLVE :: ${fastOk} ticker(s) current (1 distribute); probing ${drillIdx.length} behind (cap ${MAX_RESOLVE_N})...`,
  });

  // Phase B: iterative N=1..MAX for drill candidates (dedup, first-seen order).
  let active = [...new Set(drillIdx)];
  for (let n = 1; n <= MAX_RESOLVE_N && active.length; n++) {
    const probeTxs = active.map((idx) => {
      const p = pairs[idx];
      const tx = new Transaction();
      tx.feePayer = userPk;
      tx.recentBlockhash = blockhash;
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }));
      for (let i = 0; i < n; i++) tx.add(p.distIx);
      tx.add(p.claimIx);
      return tx;
    });
    const sims = await simulateMany(probeTxs);
    const stillActive = [];
    let okCount = 0;
    let nothingCount = 0;
    let otherCount = 0;
    active.forEach((idx, i) => {
      const s = sims[i];
      const code = errCode(s);
      if (s.ok) {
        distCounts[idx] = n;
        okCount++;
      } else if (code === 6022) {
        stillActive.push(idx);
      } else if (code === 6025) {
        unclaimable[idx] = true;
        nothingCount++;
      } else {
        unclaimable[idx] = true;
        otherCount++;
      }
    });
    onLog({
      type: "info",
      msg: `RESOLVE n=${n} :: +${okCount} claimable, ${nothingCount} nothing-to-withdraw, ${otherCount} other, ${stillActive.length} still behind.`,
    });
    active = stillActive;
  }
  // anything still 6022 at the cap is too far behind to claim now
  active.forEach((idx) => {
    unclaimable[idx] = true;
  });
  if (active.length) {
    onLog({
      type: "info",
      msg: `RESOLVE :: ${active.length} ticker(s) >${MAX_RESOLVE_N} rounds behind — skipped (retry later).`,
    });
  }
  return { distCounts, unclaimable };
}

// Pack whole pairs into transactions (a pair is never split across txs). Each
// pair carries distCount = how many distribute(slot) calls must precede its
// claim (1 for a current desk, more for a desk behind multiple rounds). Packed
// by serialized message size AND compute budget — extended pairs (many dists)
// are bigger and cost more CU, so fewer fit per tx. Returns {txs, members}
// where members[ti] is the list of pair indices packed into tx ti (used by the
// resolve probe to attribute packed-sim results to individual tickers).
function packPairedTxs(pairs, user, blockhash, microLamports = FEE_FLOOR_UL) {
  const userPk = new PublicKey(user);
  const CU_PER_DIST = 40_000;
  const CU_PER_CLAIM = 120_000;
  const CU_BASE = 30_000;
  const MAX_CU = 1_000_000;
  const txs = [];
  const members = [];
  let cur = null;
  let curCu = 0;
  let curMembers = null;
  const start = () => {
    cur = new Transaction();
    cur.feePayer = userPk;
    cur.recentBlockhash = blockhash;
    cur.add(ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_CU }));
    cur.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
    curCu = CU_BASE;
    curMembers = [];
  };
  const flush = () => {
    if (cur) {
      cur.instructions[0] = ComputeBudgetProgram.setComputeUnitLimit({
        units: Math.min(MAX_CU, curCu),
      });
      txs.push(cur);
      members.push(curMembers);
    }
    cur = null;
  };
  for (let pi = 0; pi < pairs.length; pi++) {
    const p = pairs[pi];
    const n = p.distCount || 1;
    if (!cur) start();
    const beforeCount = cur.instructions.length;
    for (let i = 0; i < n; i++) cur.add(p.distIx);
    cur.add(p.claimIx);
    const pairCu = n * CU_PER_DIST + CU_PER_CLAIM;
    const overflow =
      cur.serializeMessage().length > MAX_MSG_BYTES || curCu + pairCu > MAX_CU;
    if (overflow) {
      // didn't fit — undo this pair and start a fresh tx for it
      cur.instructions.length = beforeCount;
      flush();
      start();
      for (let i = 0; i < n; i++) cur.add(p.distIx);
      cur.add(p.claimIx);
    }
    curCu += pairCu;
    curMembers.push(pi);
  }
  flush();
  return { txs, members };
}

// Execute atomic distribute+claim pairs. First probe each ticker for how many
// distributes it needs (no wallet prompt), drop the unclaimable ones, then
// pack the rest into txs split into signAll groups; each group gets a FRESH
// blockhash, is simulated, signed with ONE prompt, then sent SEQUENTIALLY.
// Sequential send matters because pairs are desk-ordered, so several txs in a
// group usually write the SAME desk vault PDA — Solana can only land one write
// to an account per block, so sending them in parallel silently drops the
// conflicts (accepted but never confirms). Sequential submit lets them land in
// order, one per block.
export async function executePairedClaim(
  pairs,
  user,
  signAllTransactionsRaw,
  onLog,
  pairsPerGroup = 60,
  onProgress
) {
  const results = [];
  if (!pairs || !pairs.length) {
    onLog({ type: "info", msg: "Nothing to do — no claimable pairs." });
    return results;
  }

  onLog({
    type: "info",
    msg: `RESOLVE :: probing distribute count per ticker (cap ${MAX_RESOLVE_N})...`,
  });
  onProgress?.({
    group: 0,
    totalGroups: 0,
    phase: "resolve",
    desks: [],
    signaturesLeft: 0,
  });
  const { distCounts, unclaimable } = await resolveDistCounts(pairs, user, onLog);
  const goodPairs = [];
  let skippedCount = 0;
  for (let i = 0; i < pairs.length; i++) {
    if (unclaimable[i] || !distCounts[i]) {
      skippedCount++;
      results.push({ ok: false, reason: "unclaimable" });
      continue;
    }
    goodPairs.push({ ...pairs[i], distCount: distCounts[i] });
  }
  const totalDists = goodPairs.reduce((a, p) => a + p.distCount, 0);
  onLog({
    type: "info",
    msg: `PAIRS :: ${goodPairs.length} claimable ticker(s), ${totalDists} distribute(s) total :: ${skippedCount} skipped.`,
  });
  if (!goodPairs.length) {
    onLog({ type: "err", msg: "Nothing claimable after resolve." });
    return results;
  }

  const totalGroups = Math.ceil(goodPairs.length / pairsPerGroup);
  onLog({
    type: "info",
    msg: `PAIRED :: ${goodPairs.length} ticker(s) in ${totalGroups} group(s) :: ~${totalGroups} wallet approval(s).`,
  });
  onProgress?.({
    group: 0,
    totalGroups,
    phase: "start",
    desks: [],
    signaturesLeft: totalGroups,
  });
  for (let g = 0; g < totalGroups; g++) {
    const groupNo = g + 1;
    const groupPairs = goodPairs.slice(g * pairsPerGroup, (g + 1) * pairsPerGroup);
    // Distinct desk names covered by this signing group, in first-seen order —
    // shown in the progress UI so the user knows which desks are signing now.
    const desks = [...new Set(groupPairs.map((p) => p.deskName))];
    // Fresh blockhash per group — one blockhash for all groups expires before
    // later groups are signed/sent, causing every tx in them to 500 on send.
    const bh = await relay("blockhash");
    // Helius-recommended priority fee for this group's writable accounts,
    // clamped to a sane band (see currentPriorityFee).
    const fee = await currentPriorityFee(
      writableKeys(groupPairs.flatMap((p) => [p.distIx, p.claimIx]))
    );
    onLog({ type: "info", msg: `GROUP ${groupNo} :: PRIORITY_FEE ${fee} µlamports/CU (helius est.)` });
    const groupTxs = packPairedTxs(groupPairs, user, bh.blockhash, fee).txs;
    onLog({
      type: "info",
      msg: `GROUP ${groupNo}/${totalGroups} :: ${groupTxs.length} tx(s) :: ${desks.length} desk(s) :: simulating...`,
    });
    onProgress?.({
      group: groupNo,
      totalGroups,
      phase: "sim",
      desks,
      signaturesLeft: totalGroups - groupNo + 1,
    });
    const sims = await simulateMany(groupTxs);
    const passing = [];
    for (let j = 0; j < groupTxs.length; j++) {
      const sim = sims[j];
      if (!sim.ok) {
        const errLine =
          (sim.logs || []).find((l) => l.includes("Error Message")) ||
          (sim.logs || []).find((l) => l.includes("Error Code"));
        onLog({
          type: "err",
          msg: `G${groupNo} TX ${j + 1} SIM_FAIL: ${sim.err}${errLine ? ` :: ${errLine.replace("Program log: ", "")}` : ""}`,
        });
        results.push({ ok: false, reason: sim.err });
      } else {
        passing.push(groupTxs[j]);
      }
    }
    if (!passing.length) {
      onLog({ type: "err", msg: `GROUP ${groupNo} :: all sims failed — skipping.` });
      continue;
    }
    onLog({
      type: "info",
      msg: `GROUP ${groupNo} :: SIGN :: 1 prompt for ${passing.length} tx(s)...`,
    });
    onProgress?.({
      group: groupNo,
      totalGroups,
      phase: "sign",
      desks,
      signaturesLeft: totalGroups - groupNo + 1,
    });
    let signed;
    try {
      signed = await signAllTransactionsRaw(passing);
    } catch (e) {
      onLog({
        type: "err",
        msg: `GROUP ${groupNo} SIGN_REJECTED: ${e.message || "user rejected the prompt"}`,
      });
      for (let k = 0; k < passing.length; k++) results.push({ ok: false, reason: "rejected" });
      break;
    }
    if (!Array.isArray(signed) || signed.length !== passing.length) {
      onLog({ type: "err", msg: `GROUP ${groupNo} :: wallet returned wrong number of signed txs.` });
      for (let k = 0; k < passing.length; k++) results.push({ ok: false, reason: "bad-sign" });
      continue;
    }
    onLog({
      type: "info",
      msg: `GROUP ${groupNo} :: WALLET_SIGNED :: sending ${signed.length} tx(s) sequentially...`,
    });
    onProgress?.({
      group: groupNo,
      totalGroups,
      phase: "send",
      desks,
      signaturesLeft: totalGroups - groupNo,
    });
    const sentEntries = [];
    for (let k = 0; k < signed.length; k++) {
      try {
        const b64 = Buffer.from(signed[k]).toString("base64");
        const r = await withTimeout(relay("send", { tx: b64 }), 60000, `G${groupNo} TX ${k + 1} broadcast`);
        onLog({ type: "ok", msg: `G${groupNo} TX ${k + 1} SENT ${r.sig}`, sig: r.sig });
        sentEntries.push({ sig: r.sig, b64 });
        results.push({ ok: true, sig: r.sig });
      } catch (e) {
        onLog({ type: "err", msg: `G${groupNo} TX ${k + 1} SEND_FAIL: ${e.message}` });
        results.push({ ok: false, reason: e.message });
      }
    }
    // make sure the whole group actually LANDED before the next one starts
    await ensureConfirmed(sentEntries, onLog);
    // brief pause so prior sends commit and the next group's blockhash is fresh
    if (g + 1 < totalGroups) await new Promise((r) => setTimeout(r, 1500));
  }
  return results;
}

export { packTxs, ensureConfirmed, mapLimit, writableKeys, simulate };