// Lightweight Solana wallet detection + connect.
// Merges window-injected providers (Phantom, Solflare, Backpack, etc.) with
// Wallet Standard wallets (Jupiter Mobile, and any standard-only wallet that
// does NOT inject a window global), so a single button handles every brand.

import { getWallets as getStandardWallets } from "@wallet-standard/app";

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
  if (!getStandardWallets) return [];
  try {
    const list = getStandardWallets() || [];
    return list
      .filter((w) => Array.isArray(w?.chains) && w.chains.some((c) => String(c).startsWith("solana:")))
      .filter((w) => w?.features && typeof w.features["standard:connect"]?.connect === "function")
      .map((w) => ({ id: `std:${w.name}`, name: w.name || "Standard Wallet", wallet: w, kind: "standard" }));
  } catch (e) {
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
    const connect = entry.wallet.features["standard:connect"].connect;
    const out = await connect();
    const account = out?.accounts?.[0] || entry.wallet.accounts?.[0];
    const pk =
      account?.address ||
      account?.publicKey?.toString?.() ||
      (typeof account?.publicKey === "string" ? account.publicKey : null);
    if (!pk) throw new Error("Wallet returned no public key");
    return pk;
  }
  // injected
  const res = await entry.provider.connect();
  return res?.publicKey?.toString?.() || (typeof res?.publicKey === "string" ? res.publicKey : null) || null;
}