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

// Silent reconnect after a page reload — TWO prompt-free paths:
//  1. The provider already exposes publicKey for this site: register it with
//     NO connect() call at all.
//  2. connect({ onlyIfTrusted: true }) — the wallets' documented eager-connect
//     path: resolves SILENTLY when this site is still authorized, rejects
//     (no popup ever) when it isn't. Wallet Standard's connect() is likewise
//     silent for already-authorized accounts.
// CRITICAL: most injected wallets (Phantom, Solflare, Backpack) expose
// publicKey ONLY after connect() — on a fresh page load it is null even for
// authorized sites, so path 1 alone never matched. That left the app with no
// signer after every refresh and claims/swaps failed until the user
// manually disconnected and reconnected.
// Returns the matched address, or null when no authorized wallet matches
// (the portfolio then stays read-only until the user reconnects).
let _busyPk = null; // one in-flight restore per stored key: retry timers must not race connect()
export async function silentReconnect(storedPk) {
  if (!storedPk || _busyPk === storedPk) return null;
  _busyPk = storedPk;
  try {
    const entries = detectWallets();

    // 1. publicKey already exposed — register without any connect() call.
    for (const entry of entries) {
      if (entry.kind !== "injected") continue;
      const p = entry.provider?.publicKey;
      const pk = p?.toString?.() || (typeof p === "string" ? p : null);
      if (pk === storedPk) {
        setConnectedWallet(entry, null, pk);
        return pk;
      }
    }

    // 2. Trusted connect — silent for authorized sites, rejection (never a
    //    prompt) otherwise. Try each detected wallet until one matches the
    //    stored address.
    for (const entry of entries) {
      try {
        if (entry.kind === "standard" && entry.wallet) {
          const connect = entry.wallet.features["standard:connect"]?.connect;
          if (!connect) continue;
          const out = await connect();
          const account = out?.accounts?.[0] || entry.wallet.accounts?.[0];
          const pk =
            account?.address ||
            account?.publicKey?.toString?.() ||
            (typeof account?.publicKey === "string" ? account.publicKey : null);
          if (pk === storedPk) {
            setConnectedWallet(entry, account, pk);
            return pk;
          }
          continue;
        }
        if (entry.kind === "injected" && typeof entry.provider?.connect === "function") {
          const res = await entry.provider.connect({ onlyIfTrusted: true });
          const pk =
            res?.publicKey?.toString?.() ||
            (typeof res?.publicKey === "string" ? res.publicKey : null) ||
            entry.provider.publicKey?.toString?.() || // Solflare resolves void
            (typeof entry.provider.publicKey === "string" ? entry.provider.publicKey : null);
          if (pk === storedPk) {
            setConnectedWallet(entry, null, pk);
            return pk;
          }
        }
      } catch {
        /* not authorized in this wallet — try the next one */
      }
    }
    return null;
  } finally {
    _busyPk = null;
  }
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