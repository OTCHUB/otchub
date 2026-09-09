// Unified Solana transaction signer for injected (window.*) AND Wallet Standard
// wallets (Phantom, Solflare, Backpack, Jupiter Mobile, and any standard-only
// wallet). SECURITY MODEL:
//  - The app NEVER holds, sees, or transmits private keys. This module only
//    asks the user's wallet to sign a transaction the user already reviews and
//    approves in their own wallet UI, then returns the signed serialized bytes
//    for broadcast. No `signMessage`, no raw key access, no off-chain signing.
//  - Callers ALWAYS simulate the (unsigned) transaction before invoking this
//    signer, so a failing tx is aborted before signing (no wasted fee).
//  - A signer is only returned for the exact public key that was connected, so
//    a stale or different wallet can never sign for a viewed portfolio address.
//
// Wallet Standard signing uses the documented `solana:signTransaction` feature:
//   features['solana:signTransaction'].signTransaction({ account, transaction, chain })
//   -> [{ signedTransaction: Uint8Array }]

import { Transaction, VersionedTransaction } from "@solana/web3.js";

let _connected = null; // { kind, name, publicKey, provider?, wallet?, account? }

export function setConnectedWallet(entry, account, publicKey) {
  _connected = { ...entry, account, publicKey };
}

export function clearConnectedWallet() {
  _connected = null;
}

// Does the wallet expose signAndSendTransaction at all (injected provider
// method or Wallet Standard feature)? Callers use this to gate the wallet-side
// send path BEFORE prompting the user, instead of discovering mid-swap that
// the wallet can't sign & send.
function canSignAndSend(conn) {
  if (conn.kind === "injected" && typeof conn.provider?.signAndSendTransaction === "function") return true;
  return !!conn.wallet?.features?.["solana:signAndSendTransaction"]?.signAndSendTransaction;
}

export function getSigner() {
  if (!_connected) return null;
  return {
    publicKey: _connected.publicKey,
    name: _connected.name,
    signTransactionRaw: (tx) => signTransactionRaw(_connected, tx),
    signAllTransactionsRaw: (txs) => signAllTransactionsRaw(_connected, txs),
    signAndSendRaw: (tx) => signAndSendRaw(_connected, tx),
    canSignAndSend: canSignAndSend(_connected),
  };
}

// Only return a signer if it matches the given (public key) address — prevents
// signing with a wallet that isn't the one being viewed.
export function getSignerForAddress(address) {
  const s = getSigner();
  if (!s || !address) return null;
  return s.publicKey === address ? s : null;
}

function serializeForSigning(tx) {
  if (tx instanceof VersionedTransaction) return tx.serialize();
  if (tx instanceof Transaction) {
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  }
  throw new Error("Unsupported transaction type");
}

// Wallet sign calls can silently hang if the wallet prompt closes without
// responding (a known quirk on some injected wallets — especially mobile
// deep-link wallets where the prompt navigates away and never resolves).
// Race each call against a generous timeout so a stalled prompt surfaces as a
// clear error instead of hanging the whole claim run forever.
const SIGN_TIMEOUT_MS = 120000;

// Rejectors of every currently pending sign call — used by the CANCEL button
// so the user can always end a stuck "AWAITING SIGNATURE" state themselves.
const _pendingSignRejects = new Set();

// Abort every in-flight wallet sign prompt (CANCEL during the signature
// phase). Rejects the pending sign promise(s); the claim executors catch that
// as a rejected batch and end the run cleanly. Cancelling is always safe at
// sign time: nothing has been broadcast yet.
export function abortPendingSigns(reason = "Cancelled — no tx was sent") {
  const err = new Error(reason);
  for (const rej of [..._pendingSignRejects]) {
    try {
      rej(err);
    } catch {
      /* ignore */
    }
  }
  _pendingSignRejects.clear();
}

function withSignTimeout(promise, label) {
  return new Promise((resolve, reject) => {
    const wrappedReject = (e) => {
      _pendingSignRejects.delete(wrappedReject);
      reject(e);
    };
    _pendingSignRejects.add(wrappedReject);
    const timer = setTimeout(
      () =>
        wrappedReject(
          new Error(
            `${label} timed out after ${SIGN_TIMEOUT_MS / 1000}s — the wallet prompt may have closed without responding. Nothing was sent; re-run the claim.`
          )
        ),
      SIGN_TIMEOUT_MS
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        _pendingSignRejects.delete(wrappedReject);
        resolve(v);
      },
      wrappedReject
    );
  });
}

async function signTransactionRaw(conn, tx) {
  // Injected (window.*) wallet: provider.signTransaction(tx) -> signed tx object.
  if (conn.kind === "injected" && conn.provider?.signTransaction) {
    const signed = await withSignTimeout(conn.provider.signTransaction(tx), "Wallet sign prompt");
    if (!signed) throw new Error("Wallet did not return a signed transaction");
    return new Uint8Array(signed.serialize());
  }

  // Wallet Standard: solana:signTransaction feature.
  const feat = conn.wallet?.features?.["solana:signTransaction"];
  if (!feat?.signTransaction) {
    throw new Error("Connected wallet does not support solana:signTransaction");
  }
  const account = conn.account;
  if (!account) throw new Error("No authorized account from wallet");
  const chain = account.chains?.[0];
  if (!chain) throw new Error("Wallet did not report a supported chain");

  const res = await withSignTimeout(
    feat.signTransaction({ account, transaction: serializeForSigning(tx), chain }),
    "Wallet sign prompt"
  );
  const out = Array.isArray(res) ? res[0] : res;
  const signed = out?.signedTransaction;
  if (!signed || typeof signed.length !== "number") {
    throw new Error("Wallet returned no signed transaction");
  }
  return new Uint8Array(signed);
}

// Sign AND broadcast through the wallet itself (signAndSendTransaction) —
// the fallback path for mobile wallets (notably Phantom's in-app browser)
// whose signTransaction resolves with an unsigned transaction. Returns the
// base58 signature; the signed bytes never leave the wallet, so the app
// cannot re-broadcast (confirmation is poll-only via the signature).
async function signAndSendRaw(conn, tx) {
  const finish = (sig) => {
    if (typeof sig !== "string" || !sig.length) throw new Error("Wallet returned no signature");
    return sig;
  };
  if (conn.kind === "injected" && typeof conn.provider?.signAndSendTransaction === "function") {
    const res = await withSignTimeout(conn.provider.signAndSendTransaction(tx), "Wallet sign & send prompt");
    return finish(res?.signature ?? res);
  }
  const feat = conn.wallet?.features?.["solana:signAndSendTransaction"];
  if (!feat?.signAndSendTransaction) {
    throw new Error("Connected wallet does not support signAndSendTransaction");
  }
  const account = conn.account;
  if (!account) throw new Error("No authorized account from wallet");
  const res = await withSignTimeout(
    feat.signAndSendTransaction({ account, transaction: serializeForSigning(tx), chain: account.chains?.[0] }),
    "Wallet sign & send prompt"
  );
  const out = Array.isArray(res) ? res[0] : res;
  return finish(out?.signature ?? out);
}

// Sign many transactions with ONE wallet prompt. Injected wallets (Phantom /
// Solflare / Backpack via window.*) expose signAllTransactions, which signs an
// array in a single approval — collapsing N popups to 1. Wallet Standard has
// no batch-signing standard, so fall back to per-tx signing there (rare; most
// standard wallets also inject).
async function signAllTransactionsRaw(conn, txs) {
  if (!txs || !txs.length) return [];
  if (conn.kind === "injected" && conn.provider?.signAllTransactions) {
    const signed = await withSignTimeout(conn.provider.signAllTransactions(txs), "Wallet batch sign prompt");
    if (!Array.isArray(signed) || signed.length !== txs.length) {
      throw new Error("Wallet returned wrong number of signed transactions");
    }
    return signed.map((s) => new Uint8Array(s.serialize()));
  }
  const out = [];
  for (const tx of txs) out.push(await signTransactionRaw(conn, tx));
  return out;
}