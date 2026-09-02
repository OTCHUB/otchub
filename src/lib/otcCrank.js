// Bundled crank executor for the permissionless distribute(index) sweep.
// Two improvements over the chunked claim executor:
//  1. ONE wallet approval per ~100-tx wave (vs one per 60 ixs): the crank has
//     no cross-tx dependencies (slot-major ordering makes every distribute
//     independent), so a whole wave can share one blockhash, be simulated in
//     parallel, signed in a single signAll prompt, and only then broadcast.
//  2. Helius bundles (direct Jito proxy): signed txs are submitted 5-at-a-time
//     as ATOMIC, sequentially-executed bundles. Every crank tx writes the
//     shared config PDA — normal parallel sends get dropped from the same
//     slot by the scheduler's write-conflict rule, while a bundle guarantees
//     all 5 txs land in order in one slot, all-or-nothing. Each tx carries the
//     required 5,000-lamport Jito tip. Any bundle that doesn't land within the
//     poll window falls back to a normal broadcast of the same signed bytes
//     (idempotent — already-landed txs just return "already processed"), so
//     nothing is lost either way.

import { Buffer } from "buffer";
import {
  Transaction,
  ComputeBudgetProgram,
  SystemProgram,
  PublicKey,
} from "@solana/web3.js";
import {
  relay,
  currentPriorityFee,
  ensureConfirmed,
  mapLimit,
  writableKeys,
  simulateMany,
  sendMany,
} from "@/lib/otcClaim";

// Helius tip accounts (docs.helius.dev → send-bundle → Tip Accounts). At
// least one tx per bundle must transfer SOL to one of these; minimum tip is
// 5,000 lamports. Picked once per run to reduce contention.
const JITO_TIP_ACCOUNTS = [
  "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
  "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ",
  "9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta",
  "5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn",
  "2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD",
  "2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ",
  "wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF",
  "3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT",
  "4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey",
  "4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or",
];
const TIP_LAMPORTS = 5_000;
const BUNDLE_SIZE = 5; // Jito max txs per bundle
const WAVE_IX = 600; // ~100 txs per wallet approval wave
const CRANK_MAX_MSG_BYTES = 1080; // packing budget (real limit ≈ 1167)
const CU_PER_DIST = 180_000; // generous per-distribute CU allowance
const CU_BASE = 60_000;
const CU_CAP = 1_400_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Pack slot-major distribute ixs into txs. Each tx is [CU limit, CU price,
// jito tip, distributes...] filled greedily by serialized message size.
// Consecutive slot-major ixs share mint/pool/token-program keys, so ~6-8 fit.
function packCrankTxs(ixs, user, blockhash, microLamports) {
  const userPk = new PublicKey(user);
  const tipIx = SystemProgram.transfer({
    fromPubkey: userPk,
    toPubkey: new PublicKey(
      JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]
    ),
    lamports: TIP_LAMPORTS,
  });
  const txs = [];
  let cur = null;
  const finalize = () => {
    if (!cur) return;
    const dists = cur.instructions.length - 3;
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
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
      tipIx
    );
  };
  for (const ix of ixs) {
    if (!cur) start();
    cur.add(ix);
    if (cur.serializeMessage().length > CRANK_MAX_MSG_BYTES) {
      cur.instructions.pop(); // remove the ix that overflowed
      if (cur.instructions.length > 3) finalize();
      start(); // fresh tx for this ix
      cur.add(ix);
    }
  }
  finalize();
  return txs;
}

// Normal broadcast of already-signed txs (also the fallback path for bundles
// that don't land in time — the same bytes, idempotent).
async function sendWaveDirect(b64s, waveNo, onLog, results) {
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
  await ensureConfirmed(sentEntries, onLog);
}

// Submit txs as ≤5-tx atomic Jito bundles, poll for landing, and fall back
// to a direct broadcast for anything that didn't land in the poll window.
async function sendWaveBundled(b64s, waveNo, onLog, results) {
  const groups = chunk(b64s, BUNDLE_SIZE);
  onLog({
    type: "info",
    msg: `WAVE ${waveNo} :: ${groups.length} atomic bundle(s) of ≤${BUNDLE_SIZE} tx :: JITO...`,
  });
  // Up to 6 bundles per relay invocation (server-side sends respect
  // sendBundle's 5 RPS rate limit).
  const submitted = [];
  for (const batch of chunk(groups, 6)) {
    let r;
    try {
      r = await relay("bundleBatch", { bundles: batch });
    } catch (e) {
      onLog({ type: "err", msg: `W${waveNo} BUNDLE_SUBMIT_FAIL: ${e.message}` });
      r = { results: [] };
    }
    const br = r.results || [];
    for (let i = 0; i < batch.length; i++) {
      const res = br[i];
      if (res?.bundleId) {
        submitted.push({ txs: batch[i], id: res.bundleId });
      } else {
        const plan =
          res?.error && res.error.toLowerCase().includes("plan")
            ? " — bundles need a Helius API key on a plan with bundle access"
            : "";
        onLog({ type: "err", msg: `W${waveNo} BUNDLE_SUBMIT_FAIL: ${res?.error || "unknown"}${plan}` });
        submitted.push({ txs: batch[i], id: null });
      }
    }
  }

  // Poll landing. getBundleStatuses returns null until the bundle lands; a
  // landed bundle is all-or-nothing success (a failing tx means the whole
  // bundle is dropped and never lands — it just stays null here).
  const stillPending = new Map(
    submitted.filter((s) => s.id).map((s) => [s.id, s])
  );
  for (let p = 0; p < 6 && stillPending.size; p++) {
    await sleep(3000);
    const checks = await mapLimit(chunk([...stillPending.keys()], 5), 2, (idBatch) =>
      relay("bundleStatus", { ids: idBatch })
        .then((r) => r.statuses)
        .catch(() => null)
    );
    for (const statuses of checks) {
      if (!statuses) continue;
      for (const st of statuses) {
        if (!st?.bundleId) continue; // null → not landed yet
        const entry = stillPending.get(st.bundleId);
        if (!entry) continue;
        if (st.slot != null) {
          onLog({
            type: "ok",
            msg: `W${waveNo} BUNDLE ${st.bundleId.slice(0, 8)} landed (${entry.txs.length} tx)`,
          });
          for (let k = 0; k < entry.txs.length; k++) results.push({ ok: true });
          stillPending.delete(st.bundleId);
        }
      }
    }
  }
  // Not landed in time (congestion, uncompetitive tip) → direct broadcast of
  // the same signed bytes while the blockhash is still valid.
  const fallback = [...stillPending.values(), ...submitted.filter((s) => !s.id)];
  if (fallback.length) {
    onLog({
      type: "info",
      msg: `WAVE ${waveNo} :: ${fallback.length} bundle(s) not landed — direct broadcast fallback...`,
    });
    await sendWaveDirect(fallback.flatMap((f) => f.txs), waveNo, onLog, results);
  }
}

// Execute a permissionless distribute(index) sweep. ixs must be slot-major
// (buildDistributeInstructions(desks, wallet, tpMap, true), depth pre-applied).
// Per wave: fresh blockhash → parallel sims → ONE signAll prompt → atomic
// bundles (or direct sends) → landing confirmation.
export async function executeCrank(
  ixs,
  user,
  signAllTransactionsRaw,
  onLog,
  onProgress,
  opts = {}
) {
  const useBundles = opts.useBundles !== false;
  const results = [];
  if (!ixs || !ixs.length) {
    onLog({ type: "info", msg: "Nothing to do — no distribute ixs." });
    return results;
  }
  const totalWaves = Math.ceil(ixs.length / WAVE_IX);
  const fee = await currentPriorityFee(writableKeys(ixs));
  onLog({
    type: "info",
    msg: `CRANK :: ${ixs.length} ix in ${totalWaves} wave(s) :: ~1 approval per wave :: ${useBundles ? "JITO bundles" : "direct send"}.`,
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
    if (useBundles) {
      await sendWaveBundled(b64s, waveNo, onLog, results);
    } else {
      await sendWaveDirect(b64s, waveNo, onLog, results);
    }
    // brief pause so prior sends commit and the next wave's blockhash is fresh
    if (w + 1 < totalWaves) await sleep(1500);
  }
  return results;
}