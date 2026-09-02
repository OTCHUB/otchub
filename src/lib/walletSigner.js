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

export function getSigner() {
  if (!_connected) return null;
  return {
    publicKey: _connected.publicKey,
    name: _connected.name,
    signTransactionRaw: (tx) => signTransactionRaw(_connected, tx),
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

async function signTransactionRaw(conn, tx) {
  // Injected (window.*) wallet: provider.signTransaction(tx) -> signed tx object.
  if (conn.kind === "injected" && conn.provider?.signTransaction) {
    const signed = await conn.provider.signTransaction(tx);
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

  const res = await feat.signTransaction({
    account,
    transaction: serializeForSigning(tx),
    chain,
  });
  const out = Array.isArray(res) ? res[0] : res;
  const signed = out?.signedTransaction;
  if (!signed || typeof signed.length !== "number") {
    throw new Error("Wallet returned no signed transaction");
  }
  return new Uint8Array(signed);
}