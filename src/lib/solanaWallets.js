// Lightweight Solana wallet detection + connect without any SDK dependency.
// Scans all common window-injected providers (Phantom, Solflare, Backpack,
// Jupiter, etc.) so a single button can handle every brand.

export function detectWallets() {
  const w = typeof window !== "undefined" ? window : {};
  const found = [];
  const add = (id, name, provider) => {
    if (provider && typeof provider.connect === "function" && !found.find((x) => x.id === id)) {
      found.push({ id, name, provider });
    }
  };
  // Phantom injects both window.phantom.solana and window.solana.
  add("phantom", "Phantom", w.phantom?.solana || w.solana);
  add("solflare", "Solflare", w.solflare);
  add("backpack", "Backpack", w.backpack);
  // Jupiter's in-app browser injects its provider; some versions nest under .solana.
  add("jupiter", "Jupiter", w.jupiter?.solana || w.jupiter);
  add("coinbase", "Coinbase", w.coinbaseSolana);
  add("glow", "Glow", w.glow);
  return found;
}

export async function connectProvider(provider) {
  const res = await provider.connect();
  const pk =
    res?.publicKey?.toString?.() ||
    (typeof res?.publicKey === "string" ? res.publicKey : null);
  return pk || null;
}