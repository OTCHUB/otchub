// SOL <-> verified SPL mint swaps via Jupiter (no embedded widget).
// Reliability model mirrors otcClaim.js:
//  - Every swap transaction is SIMULATED before the wallet is asked to sign.
//    A failing simulation is logged and aborted — no fee is spent on a tx
//    that would fail on-chain.
//  - Uses the globally connected browser wallet (Phantom/Solflare/Backpack/
//    Jupiter) for signing — never an embedded widget with its own connect.

import { Buffer } from "buffer";
import "@/lib/bufferPolyfill";
import { base44 } from "@/api/base44Client";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  ACCOUNT_SIZE,
  AccountLayout,
  MINT_SIZE,
  MintLayout,
  MULTISIG_SIZE,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { relay, ensureConfirmed } from "@/lib/otcClaim";
import { formatRawAmount, validateRawAmount } from "./swapAmounts.js";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const OTC_MINT = "MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump";
export const OTC_DECIMALS = 6;

const verifiedTokens = new WeakSet();

function checkPair(inputMint, outputMint, amountRaw, slippageBps) {
  if (new PublicKey(inputMint).toBase58() !== inputMint || new PublicKey(outputMint).toBase58() !== outputMint || inputMint === outputMint) {
    throw new Error("Invalid swap mint pair");
  }
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 5000) {
    throw new Error("Slippage must be between 0% and 50%");
  }
  return validateRawAmount(amountRaw, { positive: true }).toString();
}

export function validateQuote(quote, inputMint, outputMint, amountRaw, slippageBps) {
  const amount = checkPair(inputMint, outputMint, amountRaw, slippageBps);
  if (!quote || quote.error || quote.inputMint !== inputMint || quote.outputMint !== outputMint ||
      quote.inAmount !== amount || quote.slippageBps !== slippageBps || quote.swapMode !== "ExactIn") {
    throw new Error("Quote does not match the requested swap");
  }
  if (!Array.isArray(quote.routePlan) || !quote.routePlan.length || quote.routePlan.some((hop) => !hop?.swapInfo)) {
    throw new Error("No Jupiter route is available for this token and amount");
  }
  const out = validateRawAmount(quote.outAmount, { positive: true });
  const min = validateRawAmount(quote.otherAmountThreshold);
  if (min > out) throw new Error("Invalid minimum received in quote");
  return quote;
}

// Fetch a Jupiter quote for any input->output pair (raw integer amount).
// BUY: getQuote(SOL_MINT, OTC_MINT, lamports, ...) · SELL: getQuote(OTC_MINT,
// SOL_MINT, rawOtc, ...).
export async function getQuote(inputMint, outputMint, amountRaw, slippageBps = 100) {
  const amount = checkPair(inputMint, outputMint, amountRaw, slippageBps);
  // Routed through the jupiterSwapRelay backend function — the browser never
  // calls Jupiter directly (CORS / rate limits broke browser-side swaps).
  const res = await base44.functions.invoke("jupiterSwapRelay", {
    mode: "quote",
    inputMint,
    outputMint,
    amount,
    slippageBps,
  });
  const data = res?.data || {};
  if (data.error) throw new Error(data.error);
  return validateQuote(data.quote, inputMint, outputMint, amount, slippageBps);
}

async function readAccount(pubkey) {
  const r = await relay("accounts", { pubkeys: [pubkey] });
  if (r?.ok !== true || !Array.isArray(r.accounts) || r.accounts.length !== 1) {
    throw new Error("Invalid RPC account response");
  }
  const acc = r.accounts[0];
  if (acc === null) return null; // Only an explicit missing account is zero.
  if (!acc || acc.pubkey !== pubkey || typeof acc.data !== "string" || !acc.data.length) {
    throw new Error("Invalid RPC account data");
  }
  const data = Buffer.from(acc.data, "base64");
  if (data.toString("base64") !== acc.data) throw new Error("Invalid account encoding");
  return { ...acc, data };
}

function checkTokenLayout(data, program, size, accountType) {
  const legacy = program === TOKEN_PROGRAM_ID.toBase58();
  if (!legacy && program !== TOKEN_2022_PROGRAM_ID.toBase58()) throw new Error("Unsupported token program owner");
  if (data.length === size) return;
  if (legacy || data.length <= ACCOUNT_SIZE || data.length === MULTISIG_SIZE || data[ACCOUNT_SIZE] !== accountType) {
    throw new Error("Invalid token account layout");
  }
}

// Decimals/program come ONLY from an initialized mint account, never feed data.
export async function getTokenInfo(mint) {
  const address = new PublicKey(mint).toBase58();
  if (address !== mint) throw new Error("Invalid mint address");
  const acc = await readAccount(address);
  if (!acc) throw new Error("Mint account does not exist");
  checkTokenLayout(acc.data, acc.owner, MINT_SIZE, 1);
  const decoded = MintLayout.decode(acc.data.subarray(0, MINT_SIZE));
  if (!decoded.isInitialized || acc.data[45] !== 1 ||
      ![0, 1].includes(decoded.mintAuthorityOption) || ![0, 1].includes(decoded.freezeAuthorityOption)) {
    throw new Error("Mint is not initialized or has invalid authorities");
  }
  const info = Object.freeze({ mint: address, decimals: decoded.decimals, tokenProgram: acc.owner });
  verifiedTokens.add(info);
  return info;
}

// Standard ATA ONLY; other token accounts are not included. Returns raw bigint.
// Requiring our immutable descriptor prevents accidental use of feed decimals.
export async function fetchTokenBalance(wallet, tokenInfo) {
  if (!verifiedTokens.has(tokenInfo)) throw new Error("Load verified mint info first");
  const owner = new PublicKey(wallet);
  const mint = new PublicKey(tokenInfo.mint);
  const program = new PublicKey(tokenInfo.tokenProgram);
  const ata = getAssociatedTokenAddressSync(mint, owner, false, program).toBase58();
  const acc = await readAccount(ata);
  if (acc === null) return 0n;
  if (acc.owner !== tokenInfo.tokenProgram) throw new Error("Token account program owner mismatch");
  checkTokenLayout(acc.data, acc.owner, ACCOUNT_SIZE, 2);
  const decoded = AccountLayout.decode(acc.data.subarray(0, ACCOUNT_SIZE));
  if (!decoded.mint.equals(mint) || !decoded.owner.equals(owner)) throw new Error("Token account mint or wallet mismatch");
  if (decoded.state !== 1) throw new Error("Token account is frozen or uninitialized");
  return validateRawAmount(decoded.amount);
}

// Legacy numeric API kept for existing consumers; failures now reject, not zero.
export async function fetchOtcBalance(wallet) {
  const info = await getTokenInfo(OTC_MINT);
  return Number(formatRawAmount(await fetchTokenBalance(wallet, info), info.decimals));
}

export async function fetchSolBalanceRaw(wallet) {
  const pubkey = new PublicKey(wallet).toBase58();
  const r = await relay("balance", { pubkey });
  if (r?.ok !== true) throw new Error("Invalid RPC balance response");
  return validateRawAmount(r.lamports);
}

export async function fetchSolBalance(wallet) {
  return Number(formatRawAmount(await fetchSolBalanceRaw(wallet), 9));
}

// Ask Jupiter to build the serialized swap transaction for this user.
export async function getSwapTx(quoteResponse, userPublicKey) {
  validateQuote(quoteResponse, quoteResponse?.inputMint, quoteResponse?.outputMint, quoteResponse?.inAmount, quoteResponse?.slippageBps);
  if (new PublicKey(userPublicKey).toBase58() !== userPublicKey) throw new Error("Invalid wallet address");
  // Swap tx built server-side by the jupiterSwapRelay function (Jupiter
  // aggregator); only the serialized tx bytes come back for local signing.
  const res = await base44.functions.invoke("jupiterSwapRelay", {
    mode: "swap",
    quoteResponse,
    userPublicKey,
  });
  const data = res?.data || {};
  if (data.error) throw new Error(data.error);
  if (typeof data.swap?.swapTransaction !== "string" || !data.swap.swapTransaction.length) throw new Error("Swap build returned no transaction");
  return data.swap; // { swapTransaction, lastValidBlockHeight, ... }
}

// Simulate the (unsigned) versioned swap tx before asking the wallet to sign.
export async function simulateSwapTx(base64Tx) {
  try {
    const r = await relay("simulate", { tx: base64Tx });
    if (r?.ok !== true || (r.err !== null && typeof r.err !== "string")) return { ok: false, err: "Invalid simulation response", logs: [] };
    if (r.err !== null) {
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
// shouldContinue is a pre-sign context guard. It is NEVER consulted after the
// wallet has signed: a UI/token change must not silently drop an approved tx.
// shouldBroadcast is optional and wallet-only (not mount/token/amount state).
// signAndSendRaw is the wallet-side sign & send: on mobile wallets / in-app
// browsers it is used as the PRIMARY path (one approval, one broadcast —
// their signTransaction is broken and can double-send); elsewhere it is the
// fallback when signTransaction resolves with an unsigned/changed tx.
export async function executeSwap(base64Tx, signTransactionRaw, onLog, userPublicKey, onPhase, shouldContinue = () => true, shouldBroadcast = () => true, signAndSendRaw = null) {
  const aborted = () => {
    onLog({ type: "err", msg: "ABORT: swap context changed before signing" });
    return { ok: false, reason: "context_changed" };
  };
  if (!shouldContinue()) return aborted();
  // VersionedTransaction has no static .from — the deserializer is .deserialize.
  const unsignedTx = VersionedTransaction.deserialize(new Uint8Array(Buffer.from(base64Tx, "base64")));
  const simulatedMessage = Buffer.from(unsignedTx.message.serialize());

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

  onPhase?.("sim");
  onLog({ type: "info", msg: "Simulating swap tx..." });
  const sim = await simulateSwapTx(base64Tx);
  if (!shouldContinue()) return aborted();
  if (!sim.ok) {
    onLog({ type: "err", msg: `SIM_FAIL: ${sim.err}` });
    return { ok: false, reason: sim.err };
  }
  // Mobile wallets / in-app browsers (notably Phantom's) have a broken
  // signTransaction: the approval itself can sign AND broadcast the tx inside
  // the wallet, then resolve with the original unsigned bytes. Detecting the
  // invalid bytes afterwards and falling back to signAndSendTransaction then
  // sends a SECOND identical swap (the first already landed) — one user
  // intent, two transactions. In those environments skip signTransaction
  // entirely: the wallet signs AND sends in a single approval and returns the
  // real signature, so there is no second broadcast path at all.
  // Mobile-only: desktop wallets (including desktop Phantom) have a working
  // signTransaction, and keeping their broadcast on our Helius relay preserves
  // the re-broadcast-unstick path for pending txs on congestion.
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
  // Callers pass signAndSendRaw ONLY for Phantom (its mobile signTransaction
  // double-broadcasts); other wallets — mobile included — sign and broadcast
  // through our Helius relay, which works everywhere (Jupiter's wallet even
  // resolves signAndSendTransaction with no signature, so it must not be used).
  const preferWalletSend = !!signAndSendRaw && isMobile;
  if (preferWalletSend) {
    if (!shouldContinue()) return aborted();
    if (!shouldBroadcast()) {
      onLog({ type: "err", msg: "ABORT: wallet changed while signing; nothing sent" });
      return { ok: false, reason: "wallet_changed" };
    }
    onPhase?.("send");
    onLog({ type: "info", msg: "Requesting wallet sign & send (single approval)..." });
    try {
      const sig = await signAndSendRaw(unsignedTx);
      onLog({ type: "ok", msg: `SWAP SENT ${sig.slice(0, 8)}…`, sig });
      onPhase?.("confirm");
      onLog({ type: "info", msg: "Confirming landing..." });
      await ensureConfirmed([{ sig, b64: null }], onLog);
      return { ok: true, sig };
    } catch (e) {
      onLog({ type: "err", msg: `SIGN_REJECTED: ${e.message}` });
      return { ok: false, reason: "rejected" };
    }
  }

  onPhase?.("sign");
  onLog({ type: "sim", msg: `Sim OK (${sim.units} CU). Requesting signature...` });
  let signedBytes;
  try {
    if (!shouldContinue()) return aborted();
    signedBytes = await signTransactionRaw(unsignedTx);
  } catch (e) {
    onLog({ type: "err", msg: `SIGN_REJECTED: ${e.message}` });
    return { ok: false, reason: "rejected" };
  }

  try {
    if (!shouldBroadcast()) {
      onLog({ type: "err", msg: "ABORT: wallet changed while signing; nothing sent" });
      return { ok: false, reason: "wallet_changed" };
    }
    // A wallet must return the simulated message, not a different transaction.
    const signedTx = VersionedTransaction.deserialize(new Uint8Array(signedBytes));
    const messageMatches = Buffer.from(signedTx.message.serialize()).equals(simulatedMessage);
    const signaturePresent = !!signedTx.signatures[0]?.some((byte) => byte !== 0);
    if (!messageMatches || !signaturePresent) {
      // Some mobile wallets (notably Phantom's in-app browser) resolve
      // signTransaction with an unsigned or re-serialized transaction. The
      // returned bytes are never trusted or broadcast; instead the wallet
      // signs AND sends OUR original unsigned tx via signAndSendTransaction,
      // which the user reviews in the wallet's own approval prompt.
      if (!signAndSendRaw) {
        throw new Error("Wallet returned a changed or unsigned transaction");
      }
      if (!shouldContinue()) return aborted();
      if (!shouldBroadcast()) {
        onLog({ type: "err", msg: "ABORT: wallet changed while signing; nothing sent" });
        return { ok: false, reason: "wallet_changed" };
      }
      onLog({ type: "info", msg: `WALLET_SIGN_INVALID (${messageMatches ? "unsigned" : "changed"} tx returned — known mobile wallet bug) :: retrying via the wallet's sign & send...` });
      onPhase?.("send");
      const sig = await signAndSendRaw(unsignedTx);
      onLog({ type: "ok", msg: `SWAP SENT ${sig.slice(0, 8)}…`, sig });
      onPhase?.("confirm");
      onLog({ type: "info", msg: "Confirming landing..." });
      await ensureConfirmed([{ sig, b64: null }], onLog);
      return { ok: true, sig };
    }
    // Broadcast through the app's Helius RPC relay (plain sendTransaction).
    onPhase?.("send");
    const r = await relay("send", { tx: Buffer.from(signedBytes).toString("base64") });
    const sig = r.sig;
    // Log a short sig preview only — the full base58 signature is an
    // unbreakable ~88-char string that blows the panel out past the mobile
    // viewport. The [SCAN] link carries the full signature.
    onLog({ type: "ok", msg: `SWAP SENT ${sig.slice(0, 8)}…`, sig });
    // make sure the swap actually landed — re-broadcast if stuck pending
    onPhase?.("confirm");
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