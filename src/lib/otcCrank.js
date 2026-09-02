// Crank executor for the permissionless distribute(index) sweep.
// ONE wallet approval per ~100-tx wave: the crank has no cross-tx
// dependencies (slot-major ordering makes every distribute independent), so
// a whole wave can share one blockhash, be simulated in parallel, signed in a
// single signAll prompt, and then broadcast DIRECTLY through the app's Helius
// RPC relay (plain sendTransaction — no bundles, no tips, no Sender).

import { Buffer } from "buffer";
import {
  Transaction,
  ComputeBudgetProgram,
  PublicKey,
} from "@solana/web3.js";
import {
  relay,
  currentPriorityFee,
  ensureConfirmed,
  writableKeys,
  simulateMany,
  sendMany,
} from "@/lib/otcClaim";

const WAVE_IX = 600; // ~100 txs per wallet approval wave
const CRANK_MAX_MSG_BYTES = 1080; // packing budget (real limit ≈ 1167)
const CU_PER_DIST = 180_000; // generous per-distribute CU allowance
const CU_BASE = 60_000;
const CU_CAP = 1_400_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pack slot-major distribute ixs into txs. Each tx is [CU limit, CU price,
// distributes...] filled greedily by serialized message size. Consecutive
// slot-major ixs share mint/pool/token-program keys, so ~7-9 fit.
function packCrankTxs(ixs, user, blockhash, microLamports) {
  const userPk = new PublicKey(user);
  const txs = [];
  let cur = null;
  const finalize = () => {
    if (!cur) return;
    const dists = cur.instructions.length - 2;
    cur.instructions[0] = ComputeBudgetProgram.setComputeUnitLimit({
      units: Math.min(CU_CAP, CU_BASE + dists * CU_PER_DIST),
    });
    txs.push(cur);
    cur = null;
  };
  const start = () => {
    cur = new Transaction();
    cur.feePayer = userPk;
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

// Direct broadcast of already-signed txs via the Helius RPC relay, followed
// by a landing check (pending txs are re-broadcast while the blockhash is
// still valid — idempotent).
async function sendWaveDirect(b64s, waveNo, onLog, results, onProgress, totalWaves) {
  const sends = await sendMany(b64s);
  const sentEntries = [];
  for (let i = 0; i < sends.length; i++) {
    const s = sends[i];
    if (s.ok) {
      onLog({ type: "ok", msg: `W${waveNo} TX ${i + 1} SENT ${s.sig}`, sig: s.sig });
      sentEntries.push({ sig: s.sig, b64: b64s[i] });
      results.push({ ok: true, sig: s.sig });
    } else {
      onLog({ type: "err", msg: `W${waveNo} TX ${i + 1} SEND_FAIL: ${s.reason}` });
      results.push({ ok: false, reason: s.reason });
    }
  }
  onProgress?.({ group: waveNo, totalGroups: totalWaves, phase: "confirm", signaturesLeft: totalWaves - waveNo, pending: sentEntries.length });
  await ensureConfirmed(sentEntries, onLog, (c) =>
    onProgress?.({ group: waveNo, totalGroups: totalWaves, phase: "confirm", signaturesLeft: totalWaves - waveNo, ...c })
  );
}

// Execute a permissionless distribute(index) sweep. ixs must be slot-major
// (buildDistributeInstructions(desks, wallet, tpMap, true), depth pre-applied).
// Per wave: fresh blockhash → parallel sims → ONE signAll prompt → direct
// Helius RPC broadcast → landing confirmation.
export async function executeCrank(ixs, user, signAllTransactionsRaw, onLog, onProgress) {
  const results = [];
  if (!ixs || !ixs.length) {
    onLog({ type: "info", msg: "Nothing to do — no distribute ixs." });
    return results;
  }
  const totalWaves = Math.ceil(ixs.length / WAVE_IX);
  const fee = await currentPriorityFee(writableKeys(ixs));
  onLog({
    type: "info",
    msg: `CRANK :: ${ixs.length} ix in ${totalWaves} wave(s) :: ~1 approval per wave :: direct RPC send.`,
  });
  onLog({ type: "info", msg: `PRIORITY_FEE ${fee} µlamports/CU (helius est.)` });

  for (let w = 0; w < totalWaves; w++) {
    const waveNo = w + 1;
    const waveIxs = ixs.slice(w * WAVE_IX, (w + 1) * WAVE_IX);
    const bh = await relay("blockhash"); // fresh blockhash per wave
    const txs = packCrankTxs(waveIxs, user, bh.blockhash, fee);
    onProgress?.({
      group: waveNo,
      totalGroups: totalWaves,
      phase: "sim",
      signaturesLeft: totalWaves - w,
    });
    onLog({
      type: "info",
      msg: `WAVE ${waveNo}/${totalWaves} :: ${txs.length} tx(s) :: simulating...`,
    });
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
          msg: `W${waveNo} TX ${j + 1} SIM_FAIL: ${sim.err}${errLine ? ` :: ${errLine.replace("Program log: ", "")}` : ""}`,
        });
        results.push({ ok: false, reason: sim.err });
      } else {
        passing.push(txs[j]);
      }
    }
    if (!passing.length) {
      onLog({ type: "err", msg: `WAVE ${waveNo} :: all sims failed — skipping.` });
      continue;
    }
    onProgress?.({
      group: waveNo,
      totalGroups: totalWaves,
      phase: "sign",
      signaturesLeft: totalWaves - w,
    });
    onLog({
      type: "info",
      msg: `WAVE ${waveNo} :: SIGN :: 1 prompt for ${passing.length} tx(s)...`,
    });
    let signed;
    try {
      signed = await signAllTransactionsRaw(passing);
    } catch (e) {
      onLog({
        type: "err",
        msg: `WAVE ${waveNo} SIGN_REJECTED: ${e.message || "user rejected the prompt"}`,
      });
      for (let k = 0; k < passing.length; k++) results.push({ ok: false, reason: "rejected" });
      break; // user rejected — stop the whole run
    }
    if (!Array.isArray(signed) || signed.length !== passing.length) {
      onLog({ type: "err", msg: `WAVE ${waveNo} :: wallet returned wrong number of signed txs.` });
      for (let k = 0; k < passing.length; k++) results.push({ ok: false, reason: "bad-sign" });
      continue;
    }
    const b64s = signed.map((b) => Buffer.from(b).toString("base64"));
    onProgress?.({
      group: waveNo,
      totalGroups: totalWaves,
      phase: "send",
      signaturesLeft: totalWaves - w - 1,
    });
    await sendWaveDirect(b64s, waveNo, onLog, results, onProgress, totalWaves);
    // brief pause so prior sends commit and the next wave's blockhash is fresh
    if (w + 1 < totalWaves) await sleep(1500);
  }
  return results;
}