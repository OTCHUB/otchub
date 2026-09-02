// Custom SOL -> $OTC swap via Jupiter's public Swap API (no embedded widget).
// Reliability model mirrors otcClaim.js:
//  - Every swap transaction is SIMULATED before the wallet is asked to sign.
//    A failing simulation is logged and aborted — no fee is spent on a tx
//    that would fail on-chain.
//  - Uses the globally connected browser wallet (Phantom/Solflare/Backpack/
//    Jupiter) for signing — never an embedded widget with its own connect.

import { Buffer } from "buffer";
import "@/lib/bufferPolyfill";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  ACCOUNT_SIZE,
  AccountLayout,
} from "@solana/spl-token";
import { relay, ensureConfirmed } from "@/lib/otcClaim";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const OTC_MINT = "MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump";
export const OTC_DECIMALS = 6;
const QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
const SWAP_URL = "https://lite-api.jup.ag/swap/v1/swap";

// Fetch a Jupiter quote for any input->output pair (raw integer amount).
// BUY: getQuote(SOL_MINT, OTC_MINT, lamports, ...) · SELL: getQuote(OTC_MINT,
// SOL_MINT, rawOtc, ...).
export async function getQuote(inputMint, outputMint, amountRaw, slippageBps = 100) {
  const url =
    `${QUOTE_URL}?inputMint=${inputMint}&outputMint=${outputMint}` +
    `&amount=${amountRaw}&slippageBps=${slippageBps}&swapMode=ExactIn`;
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`QUOTE_FAIL (${res.status}) ${t}`);
  }
  return await res.json();
}

// On-chain $OTC balance of a wallet (its standard ATA — where both bought and
// claimed OTC live). Used by SELL mode to show the balance and a MAX button.
export async function fetchOtcBalance(wallet) {
  try {
    // $OTC is a Token-2022 mint (verified on-chain) — its ATA must be derived
    // against the Token-2022 program, not the default Token program.
    const ata = getAssociatedTokenAddressSync(
      new PublicKey(OTC_MINT),
      new PublicKey(wallet),
      false,
      new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
    ).toBase58();
    const r = await relay("accounts", { pubkeys: [ata] });
    const acc = (r.accounts || [])[0];
    if (!acc?.data) return 0;
    const buf = Buffer.from(acc.data, "base64");
    if (buf.length < ACCOUNT_SIZE) return 0;
    return Number(AccountLayout.decode(buf).amount) / 10 ** OTC_DECIMALS;
  } catch {
    return 0;
  }
}

// On-chain native SOL balance of a wallet (relayed via Helius server-side,
// since the public RPC endpoint rate-limits the browser).
export async function fetchSolBalance(wallet) {
  try {
    const r = await relay("balance", { pubkey: wallet });
    return Number(r.lamports ?? 0) / 1e9;
  } catch {
    return 0;
  }
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
    // make sure the swap actually landed — re-broadcast if stuck pending
    onLog({ type: "info", msg: "Confirming landing..." });
    await ensureConfirmed(
      [{ sig, b64: Buffer.from(signedBytes).toString("base64") }],
      onLog
    );
    return { ok: true, sig };
  } catch (e) {
    onLog({ type: "err", msg: `SEND_FAIL: ${e.message}` });
    return { ok: false, reason: e.message };
  }
}