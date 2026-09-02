import { useState, useCallback, useEffect } from "react";

export const WALLET_PROVIDERS = [
  {
    id: "phantom",
    name: "Phantom",
    get: () => (typeof window !== "undefined" ? window.phantom?.solana || window.solana : null),
  },
  {
    id: "solflare",
    name: "Solflare",
    get: () => (typeof window !== "undefined" ? window.solflare : null),
  },
  {
    id: "backpack",
    name: "Backpack",
    get: () => (typeof window !== "undefined" ? window.backpack : null),
  },
  {
    id: "jupiter",
    name: "Jupiter",
    // Jupiter's in-app browser injects its provider; some versions nest under .solana.
    get: () => (typeof window !== "undefined" ? window.jupiter?.solana || window.jupiter : null),
  },
];

export function useSolanaWallet() {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);
  // Re-scan detected providers periodically + after load so late-injecting
  // wallets (e.g. Jupiter's in-app browser, which injects after first paint)
  // show up and become connectable.
  const [detectedIds, setDetectedIds] = useState(() =>
    WALLET_PROVIDERS.filter((p) => p.get()).map((p) => p.id)
  );

  const scan = useCallback(() => {
    setDetectedIds(WALLET_PROVIDERS.filter((p) => p.get()).map((p) => p.id));
  }, []);

  useEffect(() => {
    scan();
    const onLoad = () => scan();
    window.addEventListener("load", onLoad);
    // Wallets commonly inject a few hundred ms after first paint.
    const timers = [200, 600, 1500].map((ms) => setTimeout(scan, ms));
    // Wallet Standard wallets announce themselves via this event.
    const onRegister = () => scan();
    window.addEventListener("wallet-standard:app-ready", onRegister);
    return () => {
      window.removeEventListener("load", onLoad);
      window.removeEventListener("wallet-standard:app-ready", onRegister);
      timers.forEach(clearTimeout);
    };
  }, [scan]);

  const connect = useCallback(async (id) => {
    setConnecting(true);
    setError(null);
    try {
      const p = WALLET_PROVIDERS.find((x) => x.id === id);
      const provider = p?.get();
      if (!provider) throw new Error(`${p?.name || "Wallet"} not detected`);
      const res = await provider.connect();
      const pk =
        res?.publicKey?.toString?.() ||
        (typeof res?.publicKey === "string" ? res.publicKey : null);
      if (!pk) throw new Error("No public key returned");
      return pk;
    } catch (e) {
      setError(e?.message || "Connect failed");
      return null;
    } finally {
      setConnecting(false);
    }
  }, []);

  return { connect, connecting, error, detectedIds, scan };
}