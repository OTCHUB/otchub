// Custom SOL -> $OTC swap via Jupiter's public Swap API (no embedded widget).
// Reliability model mirrors otcClaim.js:
//  - Every swap transaction is SIMULATED before the wallet is asked to sign.
//    A failing simulation is logged and aborted — no fee is spent on a tx
//    that would fail on-chain.
//  - Uses the globally connected browser wallet (Phantom/Solflare/Backpack/
//    Jupiter) for signing — never an embedded widget with its own connect.

import { Buffer } from "buffer";
import "@/lib/bufferPolyfill";
import { Connection, VersionedTransaction } from "@solana/web3.js";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const OTC_MINT = "MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump";
export const OTC_DECIMALS = 6;
const QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
const SWAP_URL = "https://lite-api.jup.ag/swap/v1/swap";

let _conn = null;
function conn() {
  if (!_conn) _conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  return _conn;
}

// Fetch a SOL -> OTC quote for a given amount of lamports.
export async function getQuote(solLamports, slippageBps = 100) {
  const url =
    `${QUOTE_URL}?inputMint=${SOL_MINT}&outputMint=${OTC_MINT}` +
    `&amount=${solLamports}&slippageBps=${slippageBps}&swapMode=ExactIn`;
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`QUOTE_FAIL (${res.status}) ${t}`);
  }
  return await res.json();
}

// Ask Jupiter to build the serialized swap transaction for this user.
export async function getSwapTx(quoteResponse, userPublicKey) {
  const res = await fetch(SWAP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quoteResponse, userPublicKey }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`SWAP_BUILD_FAIL (${res.status}) ${t}`);
  }
  return await res.json(); // { swapTransaction, lastValidBlockHeight, ... }
}

// Simulate the (unsigned) versioned swap tx before asking the wallet to sign.
export async function simulateSwapTx(base64Tx) {
  try {
    const tx = VersionedTransaction.from(Buffer.from(base64Tx, "base64"));
    const res = await conn().simulateTransaction(tx, {
      replaceRecentConnectedBlockhash: true,
      sigVerify: false,
    });
    if (res.value.err) {
      return { ok: false, err: JSON.stringify(res.value.err), logs: res.value.logs };
    }
    return { ok: true, units: res.value.unitsConsumed, logs: res.value.logs };
  } catch (e) {
    return { ok: false, err: e.message, logs: [] };
  }
}

// Full swap lifecycle: simulate -> sign -> send. Aborts on sim failure so the
// wallet is never asked to sign a tx that would fail (no wasted fee).
export async function executeSwap(base64Tx, provider, onLog) {
  onLog({ type: "info", msg: "Simulating swap tx..." });
  const sim = await simulateSwapTx(base64Tx);
  if (!sim.ok) {
    onLog({ type: "err", msg: `SIM_FAIL: ${sim.err}` });
    return { ok: false, reason: sim.err };
  }
  onLog({ type: "sim", msg: `Sim OK (${sim.units} CU). Requesting signature...` });

  const unsignedTx = VersionedTransaction.from(Buffer.from(base64Tx, "base64"));
  let signed;
  try {
    signed = await provider.signTransaction(unsignedTx);
  } catch (e) {
    onLog({ type: "err", msg: `SIGN_REJECTED: ${e.message}` });
    return { ok: false, reason: "rejected" };
  }

  try {
    const sig = await conn().sendRawTransaction(signed.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });
    onLog({ type: "ok", msg: `SWAP SENT ${sig}`, sig });
    return { ok: true, sig };
  } catch (e) {
    onLog({ type: "err", msg: `SEND_FAIL: ${e.message}` });
    return { ok: false, reason: e.message };
  }
}