import React, { useState } from "react";
import { WALLET_PROVIDERS, useSolanaWallet } from "@/hooks/useSolanaWallet";

export default function WalletConnect({ onConnected }) {
  const { connect, connecting, error } = useSolanaWallet();
  const [manual, setManual] = useState("");

  const handleConnect = async (id) => {
    const pk = await connect(id);
    if (pk) onConnected?.(pk);
  };

  const submitManual = (e) => {
    e.preventDefault();
    const a = manual.trim();
    if (a) onConnected?.(a);
  };

  const available = WALLET_PROVIDERS.filter((p) => p.get());

  return (
    <div className="border border-green-500/30 bg-black p-3">
      <div className="text-[10px] uppercase tracking-widest text-green-500/70">
        WALLET_CONNECT :: OTC_PORTFOLIO
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {available.map((p) => (
          <button
            key={p.id}
            onClick={() => handleConnect(p.id)}
            disabled={connecting}
            className="border border-green-500/50 px-3 py-1.5 text-[11px] text-green-400 hover:bg-green-500/10 disabled:opacity-40"
          >
            [{p.name.toUpperCase()}]
          </button>
        ))}
        {!available.length && (
          <span className="text-[11px] text-amber-400">
            No Solana wallet detected — install Phantom/Solflare/Jupiter, or enter address below.
          </span>
        )}
      </div>
      <form onSubmit={submitManual} className="mt-3 flex gap-2">
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="OR ENTER WALLET ADDRESS..."
          className="min-w-0 flex-1 border border-green-500/30 bg-black px-2 py-1.5 font-mono text-[11px] text-green-400 placeholder:text-green-500/30 focus:outline-none"
        />
        <button
          type="submit"
          className="border border-green-500/50 px-3 py-1.5 text-[11px] text-green-400 hover:bg-green-500/10"
        >
          [LOOKUP]
        </button>
      </form>
      {error && <div className="mt-2 text-[11px] text-amber-400">ERR: {error}</div>}
    </div>
  );
}