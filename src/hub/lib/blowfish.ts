// Blowfish pre-flight scan (optional, env-gated): an anti-phishing/maliciousness check layered
// ON TOP of the validity-only RPC simulation every flow already runs. Wallets warn users about
// txs via Blowfish; this runs the same scan dapp-side BEFORE the wallet prompt so a tx that
// would scare the wallet is caught (and explained) here first.
//
// Enabled only when `VITE_BLOWFISH_API_KEY` is present in the build env (free self-service key
// from the Blowfish developer portal; the `free.` subdomain endpoint pairs with it). When unset
// or when the API is unreachable, scanning silently no-ops (fail-open): the RPC simulation gate
// remains the hard safety boundary, Blowfish is strictly additive. For production scale, proxy
// the call server-side (e.g. the workers/solana-relay worker) so the key isn't in the client
// bundle — Blowfish's own integration guide recommends exactly that.
import { Buffer } from "buffer";
import type { Transaction, VersionedTransaction } from "@solana/web3.js";

const API_KEY = (import.meta.env?.VITE_BLOWFISH_API_KEY as string | undefined) || undefined;
const API_VERSION = "2023-06-05";
const HOST = "https://free.api.blowfish.xyz";
const TIMEOUT_MS = 8_000;

export type BlowfishVerdict = {
  action: "NONE" | "WARN" | "BLOCK";
  messages: string[];
};

type AnyTx = Transaction | VersionedTransaction;

const encodeTx = (tx: AnyTx): string =>
  Buffer.from(
    "message" in tx
      ? tx.serialize()
      : tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
  ).toString("base64");

const endpointFor = (rpcEndpoint: string) =>
  `${HOST}/solana/v0/${/devnet/i.test(rpcEndpoint) ? "devnet" : "mainnet"}/scan/transactions`;

const origin = () =>
  (globalThis as { location?: { origin?: string } }).location?.origin ?? "https://otchub.dev";

/**
 * Scan one unsigned tx. Returns null when disabled (no API key), the API errors, or the response
 * is unparseable — callers treat null as "no opinion" and continue with the RPC-sim gate only.
 * `BLOCK` is the only verdict that should stop a tx from reaching the wallet; `WARN` is surfaced
 * to the user in the tx log.
 */
export async function blowfishScanTx(opts: {
  tx: AnyTx;
  userAccount: string;
  rpcEndpoint: string;
}): Promise<BlowfishVerdict | null> {
  if (!API_KEY) return null;
  try {
    const res = await fetch(endpointFor(opts.rpcEndpoint), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Api-Key": API_KEY,
        "X-Api-Version": API_VERSION,
      },
      body: JSON.stringify({
        transactions: [encodeTx(opts.tx)],
        userAccount: opts.userAccount,
        metadata: { origin: origin() },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as {
      action?: string;
      warnings?: { message?: string }[];
    } | null;
    if (body?.action !== "NONE" && body?.action !== "WARN" && body?.action !== "BLOCK")
      return null;
    return {
      action: body.action,
      messages: (body.warnings ?? [])
        .map((w) => w?.message)
        .filter((m): m is string => typeof m === "string" && m.length > 0),
    };
  } catch {
    return null;
  }
}
