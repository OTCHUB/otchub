// Recent $HUB desk activations feed (trust ticker). Every `activate_tier` /
// `upgrade_tier` (and the `_otc` variants) credits the tier-burn's reward leg
// to the tokenomics `treasuryLockVault`, so the last signatures touching that
// vault ARE the activation history (distribute_treasury_reward sweeps touch
// it too — filtered out below by instruction discriminator).
//
// Decoding follows the same proven pattern as getRecentOtcSwaps: signatures →
// jsonParsed transactions → match the hub program's instruction discriminator
// (sha256("global:<ix_name>")[0..8]) → tier from data byte 8. The desk asset
// in each instruction is identified WITHOUT assuming anchor account order: it
// is simply the one instruction account owned by the Metaplex Core program.
// A short module cache keeps repeat polls off the RPC.

import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { heliusRpc, ADDRESSES } from "../../shared/otcSources.ts";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TTL_MS = 30000;
const MAX_SIGS = 100;
const CHUNK = 20;
const TARGET = 10;
const MPL_CORE = ADDRESSES.METAPLEX_CORE_PROGRAM;
const DEVNET_RPC = "https://api.devnet.solana.com";

function disc(name) {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8).toString("hex");
}
const DISCS = {
  [disc("activate_tier")]: "activate",
  [disc("activate_tier_otc")]: "activate",
  [disc("upgrade_tier")]: "upgrade",
  [disc("upgrade_tier_otc")]: "upgrade",
};

const cache = new Map(); // key -> { ts, items }

async function rpc(cluster, method, params) {
  if (cluster !== "devnet") return heliusRpc(method, params);
  const res = await fetch(DEVNET_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "hub-acts", method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? "devnet RPC error");
  return json.result;
}

export default async function (req) {
  try {
    const body = await req.json().catch(() => ({}));
    const programId = String(body.programId || "");
    const vault = String(body.vaultAddress || "");
    const cluster = body.cluster === "devnet" ? "devnet" : "mainnet-beta";
    if (!BASE58_RE.test(programId) || !BASE58_RE.test(vault))
      return Response.json({ error: "invalid programId or vaultAddress" }, { status: 400 });

    const key = `${programId}|${vault}|${cluster}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < TTL_MS)
      return Response.json({ ok: true, items: hit.items, cached: true });

    const sigs =
      (await rpc(cluster, "getSignaturesForAddress", [vault, { limit: MAX_SIGS }]).catch(
        () => [],
      )) || [];
    const recent = sigs.filter((s) => !s.err && s.signature);

    // Walk newest-first in parallel chunks until TARGET activations are found.
    const rows = [];
    for (let i = 0; i < recent.length && rows.length < TARGET; i += CHUNK) {
      const slice = recent.slice(i, i + CHUNK);
      const txs = await Promise.all(
        slice.map((s) =>
          rpc(cluster, "getTransaction", [
            s.signature,
            { maxSupportedTransactionVersion: 0, encoding: "jsonParsed" },
          ]).catch(() => null),
        ),
      );
      for (let j = 0; j < txs.length && rows.length < TARGET; j++) {
        const tx = txs[j];
        if (!tx) continue;
        for (const ix of tx.transaction?.message?.instructions || []) {
          if (ix.programId !== programId) continue;
          const data = Buffer.from(ix.data || "", "base64");
          const kind = DISCS[data.subarray(0, 8).toString("hex")];
          if (!kind) continue; // claim_yield / distribute / authority ops
          const tier = data.length > 8 ? data[8] : 0;
          if (!(tier >= 1 && tier <= 4)) continue;
          rows.push({
            sig: tx.signatures?.[0] || slice[j].signature,
            blockTime: tx.blockTime ?? slice[j].blockTime ?? null,
            tier,
            kind,
            accounts: ix.accounts || [],
          });
          break; // one activation per tx; a prepended claim_yield is skipped above
        }
      }
    }

    // Resolve each activation's desk asset: the instruction account owned by
    // the Metaplex Core program (every other account is a PDA/mint/wallet).
    const candidates = [...new Set(rows.flatMap((r) => r.accounts))].filter((a) =>
      BASE58_RE.test(a),
    );
    const ownerBy = new Map();
    for (let i = 0; i < candidates.length; i += 100) {
      const slice = candidates.slice(i, i + 100);
      const accs =
        (await rpc(cluster, "getMultipleAccounts", [slice, { encoding: "base64" }]).catch(
          () => null,
        )) || [];
      accs.forEach((a, k) => {
        if (a) ownerBy.set(slice[k], a.owner);
      });
    }
    const items = rows
      .slice(0, TARGET)
      .map((r) => ({
        sig: r.sig,
        blockTime: r.blockTime,
        tier: r.tier,
        kind: r.kind,
        desk: r.accounts.find((a) => ownerBy.get(a) === MPL_CORE) || null,
      }));

    cache.set(key, { ts: Date.now(), items });
    return Response.json({ ok: true, items });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}