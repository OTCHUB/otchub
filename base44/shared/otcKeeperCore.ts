// Server-side keeper core: automates the permissionless distribute(index)
// crank with a dedicated, minimally-funded wallet (OTC_KEEPER_SECRET_KEY).
// The keeper signs and sends distribute txs on a schedule so owed desk
// earnings flow from the protocol pot into desk vaults without anyone
// running the manual crank. Guardrails: DataLock config (enabled / depth /
// per-run tx + fee caps), a 10-minute run lock (no overlapping or spammed
// runs), sim-first sends (failing txs cost nothing), a minimum-balance check
// with an admin email alert, and a KeeperRun log record per attempt.

import { secrets } from "base44:runtime";
import { heliusRpc } from "./otcSources.ts";
import { STOCKS } from "./otcIdl.ts";
import { getSpotPrices } from "./spotPrices.ts";
import { acquireLock, releaseLock } from "./dataLock.ts";
import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
} from "npm:@solana/web3.js@1.98.4";

const PROGRAM_ID = new PublicKey("AjMx5My4YUDHMiCtLpTAtgkiUJgrpJnQqd5AcQnddHQW");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ATA_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");
const DISTRIBUTE_DISC = [191, 44, 223, 207, 164, 236, 126, 61];

// On-chain distribution lineup (slot -> stock), mirrored from the client crank.
const LINEUP = [
  { slot: 0, mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp" },
  { slot: 1, mint: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX" },
  { slot: 2, mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh" },
  { slot: 3, mint: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg" },
  { slot: 4, mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1" },
  { slot: 5, mint: "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8" }, // SPCXx — verified on-chain (pool ATA mint)
  { slot: 6, mint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw" },
  { slot: 7, mint: "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP" },
  { slot: 8, mint: "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua" },
  { slot: 9, mint: "PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S" },
  { slot: 10, mint: "MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump" },
  { slot: 11, mint: "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB" },
  { slot: 12, mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF" },
];

const CFG_KEY = "otc_keeper_config";
const RUN_LOCK_KEY = "otc_keeper_run";
const RUN_LOCK_TTL_MS = 10 * 60 * 1000;
const MICRO_LAMPORTS = 10_000; // fixed priority fee: ~0.000014 SOL per packed tx
const CRANK_MAX_MSG_BYTES = 1080;
const CU_PER_DIST = 180_000;
const CU_BASE = 60_000;
const CU_CAP = 1_400_000;
const IX_PER_TX_BUDGET = 8; // conservative packing estimate for chunk sizing

const enc = (s) => new TextEncoder().encode(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- keeper keypair (from the app secret; base58 or JSON-array export) ----

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function decodeBase58(str) {
  let num = 0n;
  for (const c of str) {
    const v = B58_ALPHABET.indexOf(c);
    if (v < 0) throw new Error("invalid base58 character in keeper secret");
    num = num * 58n + BigInt(v);
  }
  const bytes = [];
  while (num > 0n) {
    bytes.unshift(Number(num & 0xffn));
    num >>= 8n;
  }
  for (const c of str) {
    if (c === "1") bytes.unshift(0);
    else break;
  }
  return new Uint8Array(bytes);
}

export function keeperKeypair() {
  const raw = (secrets.get("OTC_KEEPER_SECRET_KEY") || "").trim();
  if (!raw) throw new Error("OTC_KEEPER_SECRET_KEY is not set");
  const bytes = raw.startsWith("[") ? new Uint8Array(JSON.parse(raw)) : decodeBase58(raw);
  if (bytes.length !== 64) throw new Error(`keeper secret must decode to 64 bytes, got ${bytes.length}`);
  return Keypair.fromSecretKey(bytes);
}

// ---- PDA derivations (mirrors src/lib/otcClaim.js, Buffer-free) ----

const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const configPda = () => pda([enc("config")]);
const configExtPda = () => pda([enc("config_ext")]);
const vaultPda = (assetPk) => pda([enc("vault"), assetPk.toBytes()]);
const vaultExtPda = (vault) => pda([enc("vault_ext"), vault.toBytes()]);
// The OTC program derives stock token accounts with a CUSTOM [owner, tokenProgram, mint]
// seed order under the ATA program — NOT the standard ATA order.
const stockAta = (ownerPk, mintPk, tpPk) =>
  PublicKey.findProgramAddressSync([ownerPk.toBytes(), tpPk.toBytes(), mintPk.toBytes()], ATA_PROGRAM_ID)[0];

async function resolveTokenPrograms() {
  const mints = LINEUP.map((s) => s.mint);
  const r = await heliusRpc("getMultipleAccounts", [mints, { encoding: "base64" }]);
  const map = {};
  const t22 = TOKEN_2022_PROGRAM_ID.toBase58();
  const value = r?.value || [];
  for (let i = 0; i < mints.length; i++) {
    map[mints[i]] = value[i]?.owner === t22 ? t22 : TOKEN_PROGRAM_ID.toBase58();
  }
  return map;
}

function buildDistributeIx(assetId, slot, mint, tpMap) {
  const assetPk = new PublicKey(assetId);
  const tpPk = new PublicKey(tpMap[mint] || TOKEN_2022_PROGRAM_ID.toBase58());
  const mintPk = new PublicKey(mint);
  const vault = vaultPda(assetPk);
  const cfg = configPda();
  const keys = [
    { pubkey: cfg, isSigner: false, isWritable: true },
    { pubkey: configExtPda(), isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: vaultExtPda(vault), isSigner: false, isWritable: true },
    { pubkey: mintPk, isSigner: false, isWritable: false },
    { pubkey: stockAta(cfg, mintPk, tpPk), isSigner: false, isWritable: true }, // pool
    { pubkey: stockAta(vault, mintPk, tpPk), isSigner: false, isWritable: true }, // nft_stock
    { pubkey: tpPk, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  const data = new Uint8Array(9);
  data.set(DISTRIBUTE_DISC, 0);
  data[8] = slot;
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data });
}

// Pack slot-major distribute ixs into txs (consecutive ixs share mint/pool
// keys so ~7-9 fit per tx). Returns {tx, cu} so fees can be capped per run.
function packCrankTxs(ixs, feePayer, blockhash, microLamports) {
  const txs = [];
  let cur = null;
  const finalize = () => {
    if (!cur) return;
    const dists = cur.instructions.length - 2;
    const units = Math.min(CU_CAP, CU_BASE + dists * CU_PER_DIST);
    cur.instructions[0] = ComputeBudgetProgram.setComputeUnitLimit({ units });
    txs.push({ tx: cur, cu: units });
    cur = null;
  };
  const start = () => {
    cur = new Transaction();
    cur.feePayer = feePayer;
    cur.recentBlockhash = blockhash;
    cur.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports })
    );
  };
  for (const ix of ixs) {
    if (!cur) start();
    cur.add(ix);
    if (cur.serializeMessage().length > CRANK_MAX_MSG_BYTES) {
      cur.instructions.pop(); // remove the ix that overflowed
      if (cur.instructions.length > 2) finalize();
      start(); // fresh tx for this ix
      cur.add(ix);
    }
  }
  finalize();
  return txs;
}

// Pool stock balances (the config's 13 stock ATAs). Their deltas over a run
// measure EXACTLY what the distributes pushed from the pool into desk vaults:
// one batched read of 13 accounts, before and after the sweep. A missing/null
// account (ticker not launched) is skipped for the metric, and an RPC failure
// on the before-read disables the metric for the run rather than overcounting.
function poolAccounts(tpMap) {
  const cfg = configPda();
  return LINEUP.map((s) => {
    const mintPk = new PublicKey(s.mint);
    const tpPk = new PublicKey(tpMap[s.mint] || TOKEN_2022_PROGRAM_ID.toBase58());
    return { mint: s.mint, addr: stockAta(cfg, mintPk, tpPk).toBase58() };
  });
}

async function readPoolAmounts(tpMap) {
  const pools = poolAccounts(tpMap);
  const r = await heliusRpc("getMultipleAccounts", [pools.map((p) => p.addr), { encoding: "jsonParsed" }]);
  const value = r?.value || [];
  const out = {};
  for (let i = 0; i < pools.length; i++) {
    const acc = value[i];
    const amtStr = acc?.data?.parsed?.info?.tokenAmount?.amount;
    out[pools[i].mint] = acc && amtStr != null ? Number(amtStr) : null;
  }
  return out;
}

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

// u64 token amount at SPL account offset 64, decoded from base64 account data.
function b64TokenAmount(b64) {
  try {
    const bin = atob(b64);
    if (bin.length < 72) return null;
    const bytes = new Uint8Array(72);
    for (let i = 0; i < 72; i++) bytes[i] = bin.charCodeAt(i);
    return Number(new DataView(bytes.buffer).getBigUint64(64, true));
  } catch {
    return null;
  }
}

// Simulate one tx. probeAddrs optionally asks the RPC to return the simulated
// POST-execution data of those accounts (never committed, always free) — the
// keeper uses this to read whether its distributes would actually move pool
// tokens before spending a single lamport on fees.
async function simOne(tx, probeAddrs = null) {
  try {
    const b64 = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
    const config = { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed", encoding: "base64" };
    if (probeAddrs && probeAddrs.length) {
      config.accounts = { encoding: "base64", addresses: probeAddrs };
    }
    const r = await heliusRpc("simulateTransaction", [b64, config]);
    const v = r?.value || {};
    const poolPost =
      probeAddrs && Array.isArray(v.accounts)
        ? v.accounts.map((a) => (typeof a === "string" ? b64TokenAmount(a) : null))
        : null;
    return { ok: !v.err, err: v.err ? JSON.stringify(v.err) : null, poolPost };
  } catch (e) {
    return { ok: false, err: e?.message || "simulation failed", poolPost: null };
  }
}

async function sendOne(b64) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const sig = await heliusRpc("sendTransaction", [
        b64,
        { encoding: "base64", skipPreflight: true, maxRetries: 3, commitment: "confirmed" },
      ]);
      return { ok: true, sig };
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await sleep(400 * (attempt + 1));
    }
  }
  return { ok: false, reason: lastErr?.message || "send failed" };
}

// ---- keeper config (DataLock row) ----

async function readConfig(base44) {
  const rows = await base44.asServiceRole.entities.DataLock.filter({ key: CFG_KEY });
  const row = rows?.[0] || null;
  const p = row?.payload || {};
  return {
    rowId: row?.id || null,
    enabled: p.enabled !== false,
    depth: clamp(Number(p.depth) || 1, 1, 10),
    maxTxs: clamp(Number(p.maxTxs) || 30, 1, 100),
    maxFeeSol: clamp(Number(p.maxFeeSol) || 0.05, 0.001, 1),
    minBalanceSol: clamp(Number(p.minBalanceSol) || 0.05, 0.001, 10),
    cursor: Number(p.cursor) || 0,
  };
}

async function writeConfig(base44, cfg) {
  const payload = {
    enabled: cfg.enabled,
    depth: cfg.depth,
    maxTxs: cfg.maxTxs,
    maxFeeSol: cfg.maxFeeSol,
    minBalanceSol: cfg.minBalanceSol,
    cursor: cfg.cursor,
  };
  if (cfg.rowId) {
    await base44.asServiceRole.entities.DataLock.update(cfg.rowId, { payload });
  } else {
    await base44.asServiceRole.entities.DataLock.create({ key: CFG_KEY, payload });
  }
}

export async function setKeeperEnabled(base44, enabled) {
  const cfg = await readConfig(base44);
  const next = { ...cfg, enabled: !!enabled };
  await writeConfig(base44, next);
  return { enabled: next.enabled };
}

async function recordRun(base44, log) {
  try {
    await base44.asServiceRole.entities.KeeperRun.create({ ...log });
  } catch {
    /* the run log is best-effort and must not fail the run itself */
  }
}

async function maybeAlertLowBalance(base44, balanceSol) {
  try {
    // one alert per dry-out stretch: skip if the previous run already alerted
    const last = await base44.asServiceRole.entities.KeeperRun.list("-created_date", 1);
    if (last?.[0]?.status === "low_balance") return;
    const admins = await base44.asServiceRole.entities.User.filter({ role: "admin" });
    for (const a of (admins || []).slice(0, 3)) {
      if (!a?.email) continue;
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: a.email,
        subject: "OTC keeper wallet needs SOL",
        body: `The OTC distribute keeper wallet is down to ${balanceSol.toFixed(3)} SOL. Top it up so desk distributions keep flowing automatically. Keeper runs are paused until funded.`,
      });
    }
  } catch {
    /* the alert is best-effort */
  }
}

export async function keeperStatus(base44) {
  const cfg = await readConfig(base44);
  let keeper_pubkey = null;
  let keeper_balance_sol = null;
  try {
    const kp = keeperKeypair();
    keeper_pubkey = kp.publicKey.toBase58();
    const bal = await heliusRpc("getBalance", [keeper_pubkey, { commitment: "confirmed" }]);
    keeper_balance_sol = (bal?.value ?? 0) / 1e9;
  } catch {
    /* secret missing or invalid — the panel shows NOT_SET */
  }
  // Lifetime CRKR impact: aggregate every logged run (public read — note the
  // keeper secret never leaves this module; only the public pubkey is exposed).
  const all = (await base44.asServiceRole.entities.KeeperRun.list("-created_date", 2000)) || [];
  const totals = all.reduce(
    (a, r) => {
      if (r.status === "ok") a.ok_runs++;
      a.desks += r.desks || 0;
      a.txs_sent += r.txs_sent || 0;
      a.txs_failed += r.txs_failed || 0;
      a.fees_sol += r.fees_sol || 0;
      a.cleared_sol += r.cleared_sol || 0;
      a.cleared_usd += r.cleared_usd || 0;
      return a;
    },
    { ok_runs: 0, desks: 0, txs_sent: 0, txs_failed: 0, fees_sol: 0, cleared_sol: 0, cleared_usd: 0 }
  );
  let sol_price_usd = null;
  try {
    const snap = await base44.asServiceRole.entities.OtcSnapshot.list("-created_date", 1);
    sol_price_usd = snap?.[0]?.sol_price_usd ?? null;
  } catch {
    /* USD context is best-effort */
  }
  return {
    enabled: cfg.enabled,
    depth: cfg.depth,
    maxTxs: cfg.maxTxs,
    maxFeeSol: cfg.maxFeeSol,
    minBalanceSol: cfg.minBalanceSol,
    keeper_pubkey,
    keeper_balance_sol,
    sol_price_usd,
    totals: {
      runs: all.length,
      ...totals,
      since: all.length ? all[all.length - 1].created_date : null,
    },
    runs: all.slice(0, 8).map((r) => ({
      id: r.id,
      created_date: r.created_date,
      status: r.status,
      desks: r.desks,
      txs_sent: r.txs_sent,
      txs_failed: r.txs_failed,
      fees_sol: r.fees_sol,
      backlog_sol_before: r.backlog_sol_before,
      cleared_sol: r.cleared_sol,
      cleared_by_stock: r.cleared_by_stock || null,
    })),
  };
}

export async function runKeeper(base44) {
  // Run lock: no overlapping runs — the scheduled workflow and manual
  // triggers can't double-spend fees. A crashed holder auto-expires via TTL.
  const lock = await acquireLock(base44, RUN_LOCK_KEY, RUN_LOCK_TTL_MS);
  if (!lock.acquired) return { status: "skipped_locked" };

  try {
  const log = {
    status: "ok",
    keeper_pubkey: null,
    desks: 0,
    ixs: 0,
    txs_sent: 0,
    txs_failed: 0,
    fees_sol: 0,
    backlog_sol_before: null,
    cleared_sol: null,
    cleared_usd: null,
    cleared_by_stock: null,
    keeper_balance_sol: null,
    error: null,
  };

  try {
    const kp = keeperKeypair();
    log.keeper_pubkey = kp.publicKey.toBase58();
    const cfg = await readConfig(base44);

    const bal = await heliusRpc("getBalance", [log.keeper_pubkey, { commitment: "confirmed" }]);
    log.keeper_balance_sol = (bal?.value ?? 0) / 1e9;

    const latest = await base44.asServiceRole.entities.OtcSnapshot.list("-created_date", 1);
    log.backlog_sol_before = latest?.[0]?.protocol_owed_sol ?? null;

    if (!cfg.enabled) {
      log.status = "paused";
      await recordRun(base44, log);
      return log;
    }
    if (log.keeper_balance_sol < cfg.minBalanceSol) {
      log.status = "low_balance";
      await recordRun(base44, log);
      await maybeAlertLowBalance(base44, log.keeper_balance_sol);
      return log;
    }

    // Desk lineup from the holdings table (rewritten by each snapshot ingest).
    const holdings = await base44.asServiceRole.entities.NftHolding.list("asset_id", 5000);
    const desks = (holdings || []).map((h) => h.asset_id).filter(Boolean);
    if (!desks.length) {
      log.status = "no_desks";
      await recordRun(base44, log);
      return log;
    }

    // Rotating chunk: each run advances the next slice of the collection so
    // every desk gets covered over time, bounded by the per-run tx budget.
    const perDesk = LINEUP.length * cfg.depth;
    const chunk = Math.max(1, Math.min(desks.length, Math.floor((cfg.maxTxs * IX_PER_TX_BUDGET) / perDesk)));
    const chosen = [];
    for (let i = 0; i < chunk; i++) chosen.push(desks[(cfg.cursor + i) % desks.length]);
    log.desks = chunk;

    const tpMap = await resolveTokenPrograms();
    let poolBefore = null;
    try {
      poolBefore = await readPoolAmounts(tpMap);
    } catch (e) {
      console.log("[keeper] poolBefore failed:", e?.message || e);
      poolBefore = null; // metric disabled this run — never overcount
    }
    // Idle gate: when every pool stock account holds zero tokens, distribute
    // is a guaranteed no-op — skip signing/sending entirely (zero fees). The
    // pool re-check is free and runs each cadence, so the first buyback round
    // that loads the pool is swept within one schedule interval. Not recorded
    // as a run, to keep the log focused on real sweeps.
    if (poolBefore && !Object.values(poolBefore).some((v) => (v || 0) > 0)) {
      log.status = "pool_empty";
      log.cleared_sol = 0;
      log.cleared_usd = 0;
      log.cleared_by_stock = {};
      return log;
    }
    const ixs = [];
    for (const s of LINEUP) {
      for (const assetId of chosen) {
        ixs.push(buildDistributeIx(assetId, s.slot, s.mint, tpMap));
      }
    }
    log.ixs = ixs.length;

    const bh = await heliusRpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
    const blockhash = bh?.value?.blockhash;
    if (!blockhash) throw new Error("no blockhash from RPC");

    let feeEntries = packCrankTxs(ixs, kp.publicKey, blockhash, MICRO_LAMPORTS).map((p) => ({
      ...p,
      lamports: 5000 + Math.ceil((MICRO_LAMPORTS * p.cu) / 1e6),
    }));

    // Fee cap per run: drop tail txs until the estimated total fits.
    const feeCapLamports = Math.round(cfg.maxFeeSol * 1e9);
    while (feeEntries.length && feeEntries.reduce((a, t) => a + t.lamports, 0) > feeCapLamports) {
      feeEntries.pop();
    }
    if (!feeEntries.length) throw new Error("fee cap left no txs to send");

    // Simulate first — failing txs are dropped with no fee spent (vault ticker
    // accounts not yet open fail sim and are skipped harmlessly). Each sim
    // also returns the post-run POOL balances (free) so the probe gate below
    // knows whether the tx would actually move pool tokens.
    const pools = poolAccounts(tpMap);
    const probeAddrs = pools.map((p) => p.addr);
    const sims = await mapLimit(feeEntries, 5, async (t) => simOne(t.tx, probeAddrs));
    const passing = [];
    let probed = 0;
    let due = !poolBefore; // no before-read → can't prove nothing is due → send
    for (let i = 0; i < feeEntries.length; i++) {
      const s = sims[i];
      if (!s.ok) continue;
      passing.push(feeEntries[i]);
      if (Array.isArray(s.poolPost) && s.poolPost.length === pools.length) {
        probed++;
        if (!due && poolBefore) {
          for (let j = 0; j < pools.length; j++) {
            const post = s.poolPost[j];
            const before = poolBefore[pools[j].mint];
            if (post != null && before != null && post < before) {
              due = true;
              break;
            }
          }
        }
      }
    }
    log.txs_failed += feeEntries.length - passing.length;
    if (!passing.length) {
      log.status = "all_sims_failed";
      await writeConfig(base44, { ...cfg, cursor: (cfg.cursor + chunk) % desks.length });
      await recordRun(base44, log);
      return log;
    }
    // Probe gate: every passing tx simulated cleanly WITH pool reads and NONE
    // would move pool tokens → the desks in this chunk are already current on
    // every released round; sending would burn fees for guaranteed no-ops.
    // Skip the send entirely (zero fees). Cursor still advances so coverage
    // keeps rotating; real backlog (a new round released or a desk activated)
    // is swept within one cadence tick. An unreadable probe stays permissive —
    // the run proceeds exactly as before rather than skipping a real sweep.
    if (!due && probed === passing.length) {
      log.status = "nothing_due";
      await writeConfig(base44, { ...cfg, cursor: (cfg.cursor + chunk) % desks.length });
      await recordRun(base44, log);
      return log;
    }

    // Sign with the keeper keypair and broadcast directly through Helius.
    const sendResults = await mapLimit(passing, 4, async (t) => {
      t.tx.sign(kp);
      const b64 = t.tx.serialize().toString("base64");
      const r = await sendOne(b64);
      return { ...r, lamports: t.lamports };
    });
    const sentSigs = [];
    for (const r of sendResults) {
      if (r.ok) {
        sentSigs.push(r.sig);
        log.fees_sol += r.lamports / 1e9;
      } else {
        log.txs_failed++;
      }
    }
    log.txs_sent = sentSigs.length;

    // Landing check (one poll): anything still unseen is counted failed; the
    // next run's distributes continue the sweep regardless (idempotent).
    if (sentSigs.length) {
      await sleep(8000);
      try {
        const st = await heliusRpc("getSignatureStatuses", [sentSigs, { searchTransactionHistory: true }]);
        const landed = (st?.value || []).filter((s) => s && s.slot != null).length;
        log.txs_failed += sentSigs.length - landed;
      } catch {
        /* status read failed — the sends themselves were accepted */
      }
    }

    // Impact metric: pool-stock deltas over the run window = tokens CRKR
    // pushed from the protocol pool into desk vaults, valued at current spot
    // prices. Stock mints without a live price are excluded (conservative).
    if (poolBefore) {
      try {
        const poolAfter = await readPoolAmounts(tpMap);
        const meta = Object.fromEntries(STOCKS.map((s) => [s.mint, s]));
        const spot = await getSpotPrices(base44);
        const solUsd = spot?.sol_price_usd ?? null;
        let clearedUsd = 0;
        const byStock = {};
        for (const s of LINEUP) {
          const b = poolBefore[s.mint];
          const a = poolAfter?.[s.mint] ?? null;
          if (b == null || a == null || a >= b) continue;
          const dec = meta[s.mint]?.decimals ?? 6;
          const dUi = (b - a) / Math.pow(10, dec);
          const usd = dUi * (spot?.prices?.[s.mint] || 0);
          const symbol = meta[s.mint]?.symbol || s.mint.slice(0, 4);
          if (usd > 0) {
            clearedUsd += usd;
            byStock[symbol] = solUsd ? +(usd / solUsd).toFixed(6) : 0;
          }
        }
        // Both pool reads succeeded → record the measurement even when 0,
        // so "measured: nothing cleared" is distinguishable from a failed read (null).
        if (solUsd) {
          log.cleared_sol = +(clearedUsd / solUsd).toFixed(6);
          log.cleared_usd = +clearedUsd.toFixed(2);
          log.cleared_by_stock = byStock;
        }
      } catch {
        /* impact metric is best-effort */
      }
    }

    await writeConfig(base44, { ...cfg, cursor: (cfg.cursor + chunk) % desks.length });
    log.status = log.txs_sent ? "ok" : "no_txs_landed";
    await recordRun(base44, log);
    return log;
  } catch (e) {
    log.status = "error";
    log.error = e?.message || String(e);
    await recordRun(base44, log);
    return log;
  }
  } finally {
    // Always release the run lock, including the early returns above.
    await releaseLock(base44, lock);
  }
}