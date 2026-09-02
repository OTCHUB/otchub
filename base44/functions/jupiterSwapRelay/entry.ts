// Server-side Jupiter aggregator relay: fetches quotes and builds swap
// transactions from https://lite-api.jup.ag so the browser never calls
// Jupiter directly (browser-side calls hit CORS / rate limits, which broke
// swaps). The wallet still signs locally; only quote/build requests and the
// already-signed bytes are relayed.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.44";
import {
  VersionedTransaction,
  TransactionMessage,
  AddressLookupTableAccount,
  PublicKey,
  SystemProgram,
} from "npm:@solana/web3.js@1.98.4";
import { heliusRpc } from "../../shared/otcSources.ts";

const QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
const SWAP_URL = "https://lite-api.jup.ag/swap/v1/swap";

// Helius Sender (https://www.helius.dev/docs/sending-transactions/
// jupiter-swap-api-via-sender) broadcasts across all pathways (Helius, Jito,
// Harmonic, Rakurai...) for a much better landing rate, but REQUIRES the tx
// to carry a tip transfer of >= 200,000 lamports to one of these Helius tip
// wallets. The tip instruction is appended to the Jupiter swap tx here,
// SERVER-SIDE, before the tx is returned to the browser — the user's wallet
// still reviews and signs it (and the app simulates it) before it is sent.
const HELIUS_TIP_LAMPORTS = 200_000;
const HELIUS_TIP_ACCOUNTS = [
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

const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesToB64 = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 4096) {
    s += String.fromCharCode(...bytes.subarray(i, i + 4096));
  }
  return btoa(s);
};

// Make a Jupiter swap tx Helius-Sender-ready: deserialize it, resolve its
// address lookup tables, append the required Helius tip transfer, recompile.
// The message (fee payer, blockhash, swap instructions) is unchanged apart
// from the added tip — the wallet still signs locally after the app simulates.
async function makeSenderReady(swapTransactionB64) {
  const tx = VersionedTransaction.deserialize(b64ToBytes(swapTransactionB64));
  const lookups = tx.message.addressTableLookups || [];
  const altAccounts = [];
  for (const l of lookups) {
    const r = await heliusRpc("getAccountInfo", [l.accountKey, { encoding: "base64" }]);
    const data = r?.value?.data?.[0];
    if (!data) throw new Error("address lookup table fetch failed");
    altAccounts.push(AddressLookupTableAccount.fromAccountData(b64ToBytes(data)));
  }
  const decompiled = TransactionMessage.decompile(tx.message, {
    addressLookupTableAccounts: altAccounts,
  });
  const tipAccount = new PublicKey(
    HELIUS_TIP_ACCOUNTS[Math.floor(Math.random() * HELIUS_TIP_ACCOUNTS.length)]
  );
  decompiled.instructions.push(
    SystemProgram.transfer({
      fromPubkey: decompiled.payer,
      toPubkey: tipAccount,
      lamports: HELIUS_TIP_LAMPORTS,
    })
  );
  const ready = new VersionedTransaction(
    decompiled.compileToV0Message(altAccounts)
  );
  return bytesToB64(ready.serialize());
}

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Jupiter's lite API intermittently 429s (rate limit) or throws (timeouts /
// connection resets) — a single attempt surfaced as user-facing quote/swap
// failures. Retry transient failures a few times with backoff; only give up
// after the retries are exhausted.
const fetchJup = async (url, opts = {}, attempts = 3) => {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(12000) });
      if ((res.status === 429 || res.status >= 500) && i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
        continue;
      }
    }
  }
  throw lastErr || new Error("Jupiter request failed");
};

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      /* fall through to 401 */
    }
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const args = await req.json().catch(() => ({}));
    const mode = String(args.mode || "");

    if (mode === "quote") {
      const { inputMint, outputMint, amount, slippageBps } = args;
      if (
        !BASE58_RE.test(String(inputMint || "")) ||
        !BASE58_RE.test(String(outputMint || "")) ||
        !Number.isInteger(Number(amount)) ||
        Number(amount) <= 0 ||
        !Number.isInteger(Number(slippageBps)) ||
        Number(slippageBps) < 0 ||
        Number(slippageBps) > 5000
      ) {
        return Response.json({ error: "Invalid quote params" }, { status: 400 });
      }
      const url =
        `${QUOTE_URL}?inputMint=${inputMint}&outputMint=${outputMint}` +
        `&amount=${amount}&slippageBps=${slippageBps}&swapMode=ExactIn`;
      const res = await fetchJup(url);
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return Response.json(
          { error: `QUOTE_FAIL (${res.status}) ${t.slice(0, 200)}` },
          { status: 502 }
        );
      }
      const quote = await res.json();
      return Response.json({ ok: true, quote });
    }

    if (mode === "swap") {
      const { quoteResponse, userPublicKey } = args;
      if (!quoteResponse || !BASE58_RE.test(String(userPublicKey || ""))) {
        return Response.json({ error: "Invalid swap params" }, { status: 400 });
      }
      // Jupiter's /quote returns swapInfo.updateContextSlot as a NUMBER but
      // its own /swap endpoint requires it as a STRING. The TOP-LEVEL
      // contextSlot is the opposite — it must stay a NUMBER (u64). A verbatim
      // round-trip fails with 422 on every swap build, so normalize ONLY
      // updateContextSlot; leave every other field untouched.
      const normalized = JSON.parse(JSON.stringify(quoteResponse), (key, value) =>
        key === "updateContextSlot" && typeof value === "number" ? String(value) : value
      );
      const res = await fetchJup(SWAP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteResponse: normalized, userPublicKey }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return Response.json(
          { error: `SWAP_BUILD_FAIL (${res.status}) ${t.slice(0, 200)}` },
          { status: 502 }
        );
      }
      const swap = await res.json();
      if (!swap?.swapTransaction) {
        return Response.json({ error: "SWAP_BUILD_FAIL: no transaction" }, { status: 502 });
      }
      // Append the Helius Sender tip so the tx can broadcast through Sender
      // (all-pathway send — see makeSenderReady). The browser still simulates
      // and signs the final bytes.
      try {
        swap.swapTransaction = await makeSenderReady(swap.swapTransaction);
        swap.heliusTipLamports = HELIUS_TIP_LAMPORTS;
      } catch (e) {
        return Response.json(
          { error: `SENDER_READY_FAIL: ${e?.message || e}` },
          { status: 502 }
        );
      }
      return Response.json({ ok: true, swap });
    }

    return Response.json({ error: "Unknown mode" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}