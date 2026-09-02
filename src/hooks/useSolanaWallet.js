import { useState, useCallback } from "react";

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
    get: () => (typeof window !== "undefined" ? window.jupiter : null),
  },
];

export function useSolanaWallet() {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

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

  return { connect, connecting, error };
}