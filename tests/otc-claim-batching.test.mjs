// Regression test for the claim portal's per-transaction stock batching.
// `packTxs` must pack up to 4 claimable stocks (one desk, already-distributed
// — the common case) into a single legacy transaction, matching the official
// OTC portal's behavior, while the resulting tx stays provably under
// Solana's hard 1232-byte packet limit (1 signature + message).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as web3 from "@solana/web3.js";
import * as spl from "@solana/spl-token";
import * as lighthouse from "lighthouse-sdk";

const source = readFileSync(new URL("../src/lib/otcClaim.js", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

const TOKEN_2022 = spl.TOKEN_2022_PROGRAM_ID.toBase58();
const PACKET_LIMIT = 1232; // Solana's hard transaction wire-size limit.
const SIG_OVERHEAD = 65; // 1 compact-u16 count byte + 64-byte signature (single signer here).

function harness({ blockhash = web3.PublicKey.unique().toBase58() } = {}) {
  const module = { exports: {} };
  const modules = {
    buffer: { Buffer },
    "@/lib/bufferPolyfill": {},
    "@/api/base44Client": { base44: {} },
    "@solana/web3.js": web3,
    "@solana/spl-token": spl,
    "lighthouse-sdk": lighthouse,
    "@/lib/otcRelay": { relay: async (method) => (method === "blockhash" ? { blockhash } : {}) },
  };
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (name) => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected dependency ${name}`);
      return modules[name];
    },
  });
  return module.exports;
}

function deskPlan(assetId, tickerCount) {
  return {
    asset_id: assetId,
    claimable: Array.from({ length: tickerCount }, (_, i) => ({
      index: i,
      symbol: `STOCK${i}`,
      mint: web3.PublicKey.unique().toBase58(),
      decimals: 8,
      extended: false,
    })),
  };
}

test("packs 4 claimable stocks for one desk into a single transaction", async () => {
  const { buildClaimInstructions, packTxs } = harness();
  const user = web3.PublicKey.unique().toBase58();
  const assetId = web3.PublicKey.unique().toBase58();
  const tokenProgramMap = {};
  const plan = deskPlan(assetId, 4);
  for (const t of plan.claimable) tokenProgramMap[t.mint] = TOKEN_2022;

  const ixs = await buildClaimInstructions([plan], user, tokenProgramMap);
  assert.equal(ixs.length, 8, "4 tickers -> 4 [claim, assert] pairs -> 8 instructions");

  const txs = await packTxs(ixs, user);
  assert.equal(txs.length, 1, "all 4 stocks must land in a single transaction");

  const messageBytes = txs[0].serializeMessage().length;
  const wireBytes = messageBytes + SIG_OVERHEAD;
  assert.ok(
    wireBytes <= PACKET_LIMIT,
    `packed tx (${wireBytes} bytes incl. signature) must stay under Solana's ${PACKET_LIMIT}-byte packet limit`
  );
});

test("a 5th stock for the same desk overflows into a second transaction", async () => {
  const { buildClaimInstructions, packTxs } = harness();
  const user = web3.PublicKey.unique().toBase58();
  const assetId = web3.PublicKey.unique().toBase58();
  const tokenProgramMap = {};
  const plan = deskPlan(assetId, 5);
  for (const t of plan.claimable) tokenProgramMap[t.mint] = TOKEN_2022;

  const ixs = await buildClaimInstructions([plan], user, tokenProgramMap);
  const txs = await packTxs(ixs, user);
  assert.equal(txs.length, 2, "a 5th stock cannot fit alongside 4 others in one tx");

  for (const tx of txs) {
    const wireBytes = tx.serializeMessage().length + SIG_OVERHEAD;
    assert.ok(wireBytes <= PACKET_LIMIT, `every packed tx must stay under ${PACKET_LIMIT} bytes`);
  }
  // Claim+assert pairs are atomic — each tx's instruction count (2 compute
  // budget + 2*N pairs) must be even after subtracting the budget prefix.
  for (const tx of txs) assert.equal((tx.instructions.length - 2) % 2, 0);
});

test("stocks spanning two different desks still never exceed the hard packet limit", async () => {
  const { buildClaimInstructions, packTxs } = harness();
  const user = web3.PublicKey.unique().toBase58();
  const planA = deskPlan(web3.PublicKey.unique().toBase58(), 2);
  const planB = deskPlan(web3.PublicKey.unique().toBase58(), 2);
  const tokenProgramMap = {};
  for (const t of [...planA.claimable, ...planB.claimable]) tokenProgramMap[t.mint] = TOKEN_2022;

  const ixs = await buildClaimInstructions([planA, planB], user, tokenProgramMap);
  const txs = await packTxs(ixs, user);
  for (const tx of txs) {
    const wireBytes = tx.serializeMessage().length + SIG_OVERHEAD;
    assert.ok(wireBytes <= PACKET_LIMIT, `every packed tx must stay under ${PACKET_LIMIT} bytes`);
  }
  // 4 stocks across 2 desks costs more bytes per stock (less account reuse)
  // than 4 on one desk, so this may legitimately take more than 1 tx — the
  // only hard invariant is the packet-size ceiling, asserted above.
});
