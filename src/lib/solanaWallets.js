// Lightweight Solana wallet detection + connect.
// Merges window-injected providers (Phantom, Solflare, Backpack, etc.) with
// Wallet Standard wallets (Jupiter Mobile, and any standard-only wallet that
// does NOT inject a window global), so a single button handles every brand.
//
// IMPORTANT: @wallet-standard/app's `getWallets()` returns a *manager* object
// ({ get, on, register }), NOT an array. Standard wallets also register
// asynchronously: the first `getWallets()` call dispatches
// `wallet-standard:app-ready`, and wallets reply with
// `wallet-standard:register-wallet` whenever they load. So we must (1) init the
// manager early to fire app-ready, and (2) subscribe to `register` events so
// wallets that appear after first paint are picked up.

import { getWallets as getStandardWallets } from "@wallet-standard/app";
import { setConnectedWallet } from "@/lib/walletSigner";

let _manager = null;
const _subscribers = new Set();

function standardManager() {
  if (_manager) return _manager;
  try {
    _manager = getStandardWallets();
    if (_manager && typeof _manager.on === "function") {
      _manager.on("register", () => {
        _subscribers.forEach((cb) => {
          try {
            cb();
          } catch {
            /* ignore */
          }
        });
      });
      _manager.on("unregister", () => {
        _subscribers.forEach((cb) => {
          try {
            cb();
          } catch {
            /* ignore */
          }
        });
      });
    }
  } catch {
    _manager = null;
  }
  return _manager;
}

// Fire app-ready as soon as this module loads so standard wallets register ASAP.
if (typeof window !== "undefined") {
  standardManager();
}

export function subscribeStandardWallets(cb) {
  _subscribers.add(cb);
  // Ensure the manager exists so the listener is attached.
  standardManager();
  return () => {
    _subscribers.delete(cb);
  };
}

function windowWallets() {
  const w = typeof window !== "undefined" ? window : {};
  const found = [];
  const add = (id, name, provider) => {
    if (provider && typeof provider.connect === "function" && !found.find((x) => x.id === id)) {
      found.push({ id, name, provider, kind: "injected" });
    }
  };
  // Phantom injects both window.phantom.solana and window.solana.
  add("phantom", "Phantom", w.phantom?.solana || w.solana);
  add("solflare", "Solflare", w.solflare);
  add("backpack", "Backpack", w.backpack);
  add("jupiter", "Jupiter", w.jupiter?.solana || w.jupiter);
  add("coinbase", "Coinbase", w.coinbaseSolana);
  add("glow", "Glow", w.glow);
  return found;
}

function standardWallets() {
  const m = standardManager();
  if (!m) return [];
  try {
    const list = typeof m.get === "function" ? m.get() : [];
    return (Array.isArray(list) ? list : [])
      .filter((w) => Array.isArray(w?.chains) && w.chains.some((c) => String(c).startsWith("solana:")))
      .filter(
        (w) => w?.features && typeof w.features["standard:connect"]?.connect === "function"
      )
      .map((w) => ({
        id: `std:${w.name}`,
        name: w.name || "Standard Wallet",
        wallet: w,
        kind: "standard",
      }));
  } catch {
    return [];
  }
}

export function detectWallets() {
  const injected = windowWallets();
  const standard = standardWallets();
  // Merge, de-duping by lowercased name (prefer injected if a brand injects
  // both ways, otherwise keep the standard entry for standard-only wallets).
  const seen = new Set(injected.map((w) => w.name.toLowerCase()));
  const merged = [...injected];
  for (const w of standard) {
    if (!seen.has(w.name.toLowerCase())) merged.push(w);
  }
  return merged;
}

export async function connectWallet(entry) {
  if (entry?.kind === "standard" && entry.wallet) {
    const connect = entry.wallet.features["standard:connect"]?.connect;
    if (!connect) throw new Error("Wallet does not support standard:connect");
    const out = await connect();
    const account = out?.accounts?.[0] || entry.wallet.accounts?.[0];
    const pk =
      account?.address ||
      account?.publicKey?.toString?.() ||
      (typeof account?.publicKey === "string" ? account.publicKey : null);
    if (!pk) throw new Error("Wallet returned no public key");
    setConnectedWallet(entry, account, pk);
    return pk;
  }
  // injected — NOTE: Solflare's connect() resolves VOID; the key must be read
  // off the provider after the handshake (Phantom resolves { publicKey }).
  // Read both shapes so Solflare/Backpack/etc. all work.
  const res = await entry.provider.connect();
  const pk =
    res?.publicKey?.toString?.() ||
    (typeof res?.publicKey === "string" ? res.publicKey : null) ||
    entry.provider.publicKey?.toString?.() ||          // Solflare path
    (typeof entry.provider.publicKey === "string" ? entry.provider.publicKey : null) ||
    null;
  if (pk) setConnectedWallet(entry, null, pk);
  return pk;
}