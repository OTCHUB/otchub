// §A7.1 snapshot airdrop — Merkle tree over `(desk asset, amount)` leaves, byte-compatible with
// `programs/hub/src/instructions/tokenomics.rs` (`airdrop_leaf` / `verify_merkle`):
//   leaf   = sha256(AIRDROP_LEAF_TAG ‖ asset(32) ‖ amount u64 LE)
//   parent = sha256(min(a,b) ‖ max(a,b))          (sorted pair → order-independent proofs)
//   odd node at a level is promoted unchanged (no duplication).
// sha256 via WebCrypto so the SDK stays dependency-free in both Node and the browser.
import { PublicKey, type Connection } from "@solana/web3.js";
import { AIRDROP_LEAF_TAG, AIRDROP_PER_DESK_UNITS } from "./constants";

export type AirdropEntry = { asset: PublicKey; amountUnits: bigint };

export type AirdropTree = {
  /** 32-byte root as the program stores it. */
  root: Uint8Array;
  rootHex: string;
  entries: AirdropEntry[];
  totalUnits: bigint;
  /** Sibling path for each leaf, keyed by asset base58. */
  proofs: Map<string, Uint8Array[]>;
};

const subtle = () => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) throw new Error("WebCrypto unavailable (Node ≥ 19 or a browser required)");
  return c.subtle;
};

export async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const buf = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  return new Uint8Array(await subtle().digest("SHA-256", buf));
}

const cmp = (a: Uint8Array, b: Uint8Array) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const hashPair = (a: Uint8Array, b: Uint8Array) => (cmp(a, b) <= 0 ? sha256(a, b) : sha256(b, a));

export function airdropLeaf(asset: PublicKey, amountUnits: bigint): Promise<Uint8Array> {
  const amount = new Uint8Array(8);
  new DataView(amount.buffer).setBigUint64(0, amountUnits, true);
  return sha256(new TextEncoder().encode(AIRDROP_LEAF_TAG), asset.toBytes(), amount);
}

/** Uniform allocation: every desk in `assets` gets `perDeskUnits` (default 10,000 $HUB). */
export const uniformEntries = (
  assets: PublicKey[],
  perDeskUnits: bigint = AIRDROP_PER_DESK_UNITS,
): AirdropEntry[] => assets.map((asset) => ({ asset, amountUnits: perDeskUnits }));

export async function buildAirdropTree(entries: AirdropEntry[]): Promise<AirdropTree> {
  if (entries.length === 0) throw new Error("airdrop tree needs at least one entry");
  const seen = new Set<string>();
  for (const e of entries) {
    const k = e.asset.toBase58();
    if (seen.has(k)) throw new Error(`duplicate asset in airdrop entries: ${k}`);
    seen.add(k);
  }
  const leaves = await Promise.all(entries.map((e) => airdropLeaf(e.asset, e.amountUnits)));
  // levels[0] = leaves … levels[last] = [root]
  const levels: Uint8Array[][] = [leaves];
  while (levels[levels.length - 1].length > 1) {
    const cur = levels[levels.length - 1];
    const next: Uint8Array[] = [];
    for (let i = 0; i < cur.length; i += 2) {
      next.push(i + 1 < cur.length ? await hashPair(cur[i], cur[i + 1]) : cur[i]);
    }
    levels.push(next);
  }
  const proofs = new Map<string, Uint8Array[]>();
  entries.forEach((e, leafIdx) => {
    const path: Uint8Array[] = [];
    let idx = leafIdx;
    for (let lvl = 0; lvl < levels.length - 1; lvl++) {
      const sib = idx ^ 1;
      if (sib < levels[lvl].length) path.push(levels[lvl][sib]);
      idx >>= 1;
    }
    proofs.set(e.asset.toBase58(), path);
  });
  const root = levels[levels.length - 1][0];
  return {
    root,
    rootHex: Buffer.from(root).toString("hex"),
    entries,
    totalUnits: entries.reduce((s, e) => s + e.amountUnits, 0n),
    proofs,
  };
}

/** Client-side mirror of the program's `verify_merkle`. */
export async function verifyAirdropProof(
  root: Uint8Array,
  asset: PublicKey,
  amountUnits: bigint,
  proof: Uint8Array[],
): Promise<boolean> {
  let node = await airdropLeaf(asset, amountUnits);
  for (const sib of proof) node = await hashPair(node, sib);
  return cmp(node, root) === 0;
}

/** Anchor arg shape for `claim_airdrop(amount_units, proof)`: `number[][]` of 32-byte arrays. */
export const proofToArgs = (proof: Uint8Array[]) => proof.map((p) => Array.from(p));

// ---------------------------------------------------------------------------
// Post-distribution reads: every `AirdropClaim` PDA (["airdrop", asset]) is a receipt —
// one per desk, recording who was actually paid. Scanned on demand for the tokenomics
// "distribution by address" table; ~2.2k accounts, trimmed by dataSlice to the fields read.
// Layout: disc(8) · asset(32) · claimant(32) · amount_units(u64) · claimed_ts(i64) · bump(1).

export type AirdropClaimView = {
  /** The claim-receipt PDA itself — its first on-chain signature is the payment tx. */
  claim: string;
  asset: string;
  /** The desk's owner at payment time — who received the $HUB. */
  claimant: string;
  amountUnits: bigint;
  claimedTs: number;
};

/** Anchor discriminator of `AirdropClaim` — sha256("account:AirdropClaim")[..8], base64 for the
 *  RPC memcmp filter. Computed once (WebCrypto is async), cached at module scope. */
const claimDiscB64 = sha256(new TextEncoder().encode("account:AirdropClaim")).then((h) =>
  btoa(String.fromCharCode(...h.slice(0, 8))),
);

const toClaimView = (pubkey: PublicKey, raw: Uint8Array): AirdropClaimView => {
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  return {
    claim: pubkey.toBase58(),
    asset: new PublicKey(raw.subarray(0, 32)).toBase58(),
    claimant: new PublicKey(raw.subarray(32, 64)).toBase58(),
    amountUnits: dv.getBigUint64(64, true),
    claimedTs: Number(dv.getBigInt64(72, true)),
  };
};

export async function listAirdropClaims(
  connection: Connection,
  programId: PublicKey,
): Promise<AirdropClaimView[]> {
  const accounts = await connection.getProgramAccounts(programId, {
    filters: [{ memcmp: { offset: 0, bytes: await claimDiscB64, encoding: "base64" } }],
    dataSlice: { offset: 8, length: 80 },
  });
  return accounts.map((a) => toClaimView(a.pubkey, a.account.data as Uint8Array));
}

/** One wallet's receipts only (claimant sits at offset 40: disc 8 + asset 32). Powers the
 *  connected-wallet "you received X $HUB" card without scanning the whole set client-side. */
export async function listAirdropClaimsByOwner(
  connection: Connection,
  programId: PublicKey,
  owner: PublicKey,
): Promise<AirdropClaimView[]> {
  const accounts = await connection.getProgramAccounts(programId, {
    filters: [
      { memcmp: { offset: 0, bytes: await claimDiscB64, encoding: "base64" } },
      { memcmp: { offset: 40, bytes: owner.toBase58() } },
    ],
    dataSlice: { offset: 8, length: 80 },
  });
  return accounts.map((a) => toClaimView(a.pubkey, a.account.data as Uint8Array));
}
