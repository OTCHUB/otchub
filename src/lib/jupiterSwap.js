// Custom SOL -> $OTC swap via Jupiter's public Swap API (no embedded widget).
// Reliability model mirrors otcClaim.js:
//  - Every swap transaction is SIMULATED before the wallet is asked to sign.
//    A failing simulation is logged and aborted — no fee is spent on a tx
//    that would fail on-chain.
//  - Uses the globally connected browser wallet (Phantom/Solflare/Backpack/
//    Jupiter) for signing — never an embedded widget with its own connect.

import { Buffer } from "buffer";
import "@/lib/bufferPolyfill";
import { VersionedTransaction } from "@solana/web3.js";
import { relay } from "@/lib/otcClaim";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const OTC_MINT = "MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump";
export const OTC_DECIMALS = 6;
const QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
const SWAP_URL = "https://lite-api.jup.ag/swap/v1/swap";

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
    const r = await relay("simulate", { tx: base64Tx });
    if (r.err) {
      return { ok: false, err: r.err, logs: r.logs };
    }
    return { ok: true, units: r.units, logs: r.logs };
  } catch (e) {
    return { ok: false, err: e.message, logs: [] };
  }
}

// Full swap lifecycle: verify fee payer -> simulate -> sign -> send.
// Aborts before signing if the tx's fee payer isn't the connected wallet
// (guards against a tampered/baited transaction not meant for this user) or
// if simulation fails (no wasted fee, no broken-tx signing).
export async function executeSwap(base64Tx, signTransactionRaw, onLog, userPublicKey) {
  const unsignedTx = VersionedTransaction.from(Buffer.from(base64Tx, "base64"));

  // Safety: the fee payer (first account key) must be the connected wallet.
  if (userPublicKey) {
    try {
      const feePayer = unsignedTx.message.staticAccountKeys[0];
      if (!feePayer || feePayer.toString() !== userPublicKey) {
        onLog({ type: "err", msg: "ABORT: tx fee payer != connected wallet" });
        return { ok: false, reason: "fee_payer_mismatch" };
      }
    } catch (e) {
      onLog({ type: "err", msg: `ABORT: could not verify fee payer (${e.message})` });
      return { ok: false, reason: "fee_payer_unknown" };
    }
  }

  onLog({ type: "info", msg: "Simulating swap tx..." });
  const sim = await simulateSwapTx(base64Tx);
  if (!sim.ok) {
    onLog({ type: "err", msg: `SIM_FAIL: ${sim.err}` });
    return { ok: false, reason: sim.err };
  }
  onLog({ type: "sim", msg: `Sim OK (${sim.units} CU). Requesting signature...` });
  let signedBytes;
  try {
    signedBytes = await signTransactionRaw(unsignedTx);
  } catch (e) {
    onLog({ type: "err", msg: `SIGN_REJECTED: ${e.message}` });
    return { ok: false, reason: "rejected" };
  }

  try {
    const r = await relay("send", { tx: Buffer.from(signedBytes).toString("base64") });
    const sig = r.sig;
    onLog({ type: "ok", msg: `SWAP SENT ${sig}`, sig });
    return { ok: true, sig };
  } catch (e) {
    onLog({ type: "err", msg: `SEND_FAIL: ${e.message}` });
    return { ok: false, reason: e.message };
  }
}