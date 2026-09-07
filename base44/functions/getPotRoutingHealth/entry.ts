import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import { ADDRESSES, heliusRpc, fetchProtocolStats } from "../../shared/otcSources.ts";

/* Live fee-routing health watch — verifies on-chain state directly instead of
   trusting stored/hardcoded route assumptions:
     - CONFIG account fingerprint: any protocol fee-config change (data, owner
       or space) flips `config.changed` so the dashboard re-flags its route map
     - POT account: live SOL balance + owner program
     - POT activity: newest confirmed transfers decoded for the last real SOL
       inflow (amount + time) and a 24h inflow sample
     - otcdesks stats: SOL currently OWED to desks — the ecosystem's pivotal
       obligation — compared against the live pot balance (covered/shortfall)
   The last seen config hash is persisted in a DataLock row so a change is
   detected across requests, isolates and viewers (not just per browser). */

const LAMPORTS = 1e9;
const FRESH_MS = 60_000;
const STALE_MS = 15 * 60_000;
const WATCH_KEY = "pot_routing_watch";
const INFLOW_WINDOW_H = 24;
const SAMPLE_TXS = 5;

let mem = { at: 0, body: null };
let inflight = null;

const jsonOut = (body, cacheState) =>
  Response.json(body, {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
      "X-Watch-Cache": cacheState,
    },
  });

// FNV-1a 32-bit — deterministic short fingerprint of arbitrary account data
// (no async Web Crypto needed; only CHANGE detection matters, not the value).
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// Account snapshot + change fingerprint (hash over data bytes + owner + space).
async function accountFingerprint(address) {
  const res = await heliusRpc("getAccountInfo", [address, { encoding: "base64" }]);
  const v = res?.value;
  if (!v) return { exists: false, hash: null, owner: null, dataLen: 0, lamports: 0 };
  const data = Array.isArray(v.data) ? v.data[0] || "" : "";
  return {
    exists: true,
    hash: fnv1a(`${data}:${v.owner}:${v.space ?? data.length}`),
    owner: v.owner,
    dataLen: v.space ?? data.length,
    lamports: v.lamports,
  };
}

// Newest confirmed pot transfers: net SOL delta to the pot per tx, bounded to
// SAMPLE_TXS decodes so the endpoint stays cheap under its 60s cache.
async function scanPotActivity() {
  const sigs =
    (await heliusRpc("getSignaturesForAddress", [
      ADDRESSES.POT,
      { limit: 15 },
    ])) || [];
  const ok = sigs.filter((s) => !s.err && s.blockTime);
  const lastTouchAt = ok.length ? ok[0].blockTime * 1000 : null;
  const windowStart = Date.now() / 1000 - INFLOW_WINDOW_H * 3600;
  let lastInflow = null;
  let inflowWindowSol = 0;
  for (const s of ok.slice(0, SAMPLE_TXS)) {
    const tx = await heliusRpc("getTransaction", [
      s.signature,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
    ]);
    if (!tx?.meta) continue;
    const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey || k);
    for (const bucket of [
      tx.meta.loadedAddresses?.writable || [],
      tx.meta.loadedAddresses?.readonly || [],
    ]) {
      keys.push(...bucket);
    }
    const i = keys.indexOf(ADDRESSES.POT);
    if (i < 0 || !tx.meta.preBalances || !tx.meta.postBalances) continue;
    const delta = (tx.meta.postBalances[i] - tx.meta.preBalances[i]) / LAMPORTS;
    if (delta > 0) {
      if (!lastInflow) lastInflow = { at: tx.blockTime * 1000, sol: delta };
      if (tx.blockTime >= windowStart) inflowWindowSol += delta;
    }
  }
  return { lastTouchAt, lastInflow, inflowWindowSol };
}

async function buildBody(base44) {
  const [cfgR, potR, statsR, activityR] = await Promise.allSettled([
    accountFingerprint(ADDRESSES.CONFIG),
    accountFingerprint(ADDRESSES.POT),
    fetchProtocolStats(),
    scanPotActivity(),
  ]);
  const cfg = cfgR.status === "fulfilled" ? cfgR.value : null;
  const pot = potR.status === "fulfilled" ? potR.value : null;
  const stats = statsR.status === "fulfilled" ? statsR.value : null;
  const activity = activityR.status === "fulfilled" ? activityR.value : null;

  const solOf = (v) => (v != null ? v / LAMPORTS : null);
  const owedSol = solOf(stats?.owed);
  const potSol = pot?.exists ? pot.lamports / LAMPORTS : null;

  // Config change detection against the persisted baseline. First successful
  // read just records the baseline; a later hash/owner flip flags `changed`.
  let watch = null;
  try {
    const rows =
      (await base44.asServiceRole.entities.DataLock.filter({ key: WATCH_KEY })) ||
      [];
    watch = rows[0] || null;
  } catch (e) {
    watch = null;
  }
  const configHash = cfg?.hash ?? null;
  const prevHash = watch?.payload?.configHash ?? null;
  let changed = false;
  let since = watch?.payload?.at ?? null;
  if (configHash != null && prevHash !== configHash) {
    changed = prevHash != null;
    since = Date.now();
    const payload = { configHash, at: since };
    try {
      if (watch?.id) {
        await base44.asServiceRole.entities.DataLock.update(watch.id, { payload });
      } else {
        await base44.asServiceRole.entities.DataLock.create({ key: WATCH_KEY, payload });
      }
    } catch (e) {
      /* keep serving the check; baseline persistence retries next poll */
    }
  }

  const covered = owedSol != null && potSol != null ? potSol >= owedSol : null;
  const lastInflow = activity?.lastInflow ?? null;
  const potLive = lastInflow
    ? Date.now() - lastInflow.at <= INFLOW_WINDOW_H * 3600 * 1000
    : null;

  const errors = [];
  if (cfgR.status === "rejected") errors.push("config");
  if (potR.status === "rejected") errors.push("pot");
  if (statsR.status === "rejected") errors.push("stats");
  if (activityR.status === "rejected") errors.push("activity");

  return {
    at: Date.now(),
    owed_sol: owedSol,
    distributed_sol: solOf(stats?.distributed),
    to_pot_sol: solOf(stats?.toPot),
    desks: stats?.perDesk?.length ? stats.perDesk[stats.perDesk.length - 1].desks : null,
    pot: { sol: potSol, owner: pot?.owner ?? null, exists: pot?.exists ?? null },
    config: {
      hash: configHash,
      owner: cfg?.owner ?? null,
      data_len: cfg?.dataLen ?? null,
      exists: cfg?.exists ?? null,
      changed,
      prev_hash: prevHash,
      since,
    },
    pot_activity: {
      last_inflow: lastInflow,
      inflow_window_sol: activity?.inflowWindowSol ?? null,
      last_touch_at: activity?.lastTouchAt ?? null,
      window_h: INFLOW_WINDOW_H,
    },
    checks: {
      covered,
      shortfall_sol: covered === false ? owedSol - potSol : 0,
      pot_live: potLive,
    },
    errors,
  };
}

export default async function (req) {
  const now = Date.now();
  if (mem.body && now - mem.at < FRESH_MS) return jsonOut(mem.body, "hit");
  if (!inflight) {
    inflight = (() => {
      const base44 = createClientFromRequest(req);
      return buildBody(base44)
        .then((body) => {
          mem = { at: Date.now(), body };
          return body;
        })
        .finally(() => {
          inflight = null;
        });
    })();
  }
  try {
    return jsonOut(await inflight, "miss");
  } catch (e) {
    if (mem.body && now - mem.at < STALE_MS) return jsonOut({ ...mem.body, stale: true }, "stale");
    return Response.json({ error: e.message }, { status: 500 });
  }
}