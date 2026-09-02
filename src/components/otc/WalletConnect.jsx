import React, { useState } from "react";
import { detectWallets, connectWallet } from "@/lib/solanaWallets";

export default function WalletConnect({ onConnected }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [picker, setPicker] = useState(null); // list when multiple wallets found
  const [manual, setManual] = useState("");

  const handleConnect = async () => {
    setError(null);
    setBusy(true);
    try {
      const wallets = detectWallets();
      if (!wallets.length) {
        setError(
          "No injected Solana wallet found. Open this app directly in your wallet's in-app browser (e.g. Jupiter app → enter URL), or paste your address below."
        );
        return;
      }
      if (wallets.length === 1) {
        await doConnect(wallets[0]);
      } else {
        setPicker(wallets);
      }
    } catch (e) {
      setError(e?.message || "Connect failed");
    } finally {
      setBusy(false);
    }
  };

  const doConnect = async (wallet) => {
    setPicker(null);
    setBusy(true);
    setError(null);
    try {
      const pk = await connectWallet(wallet);
      if (!pk) throw new Error("No public key returned");
      onConnected?.(pk);
    } catch (e) {
      setError(e?.message || `${wallet.name} connect failed`);
    } finally {
      setBusy(false);
    }
  };

  const submitManual = (e) => {
    e.preventDefault();
    const a = manual.trim();
    if (a) onConnected?.(a);
  };

  return (
    <div className="border border-green-500/30 bg-black p-3">
      <div className="text-[10px] uppercase tracking-widest text-green-500/70">
        WALLET_CONNECT :: OTC_PORTFOLIO
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={handleConnect}
          disabled={busy}
          className="border border-green-500/50 px-4 py-2 text-[12px] font-bold text-green-400 hover:bg-green-500/10 disabled:opacity-40"
        >
          {busy ? "[CONNECTING...]" : "[CONNECT_WALLET]"}
        </button>
        <span className="text-[10px] text-green-500/40">
          PHANTOM · SOLFLARE · BACKPACK · JUPITER · OTHERS
        </span>
      </div>

      {picker && (
        <div className="mt-3 flex flex-wrap gap-2 border border-green-500/30 p-2">
          <span className="text-[10px] text-green-500/60">SELECT_WALLET:</span>
          {picker.map((p) => (
            <button
              key={p.id}
              onClick={() => doConnect(p)}
              className="border border-green-500/50 px-3 py-1.5 text-[11px] text-green-400 hover:bg-green-500/10"
            >
              [{p.name.toUpperCase()}]
            </button>
          ))}
        </div>
      )}

      <form onSubmit={submitManual} className="mt-3 flex gap-2">
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="OR PASTE WALLET ADDRESS..."
          className="min-w-0 flex-1 border border-green-500/30 bg-black px-2 py-1.5 font-mono text-[11px] text-green-400 placeholder:text-green-500/30 focus:outline-none"
        />
        <button
          type="submit"
          className="border border-green-500/50 px-3 py-1.5 text-[11px] text-green-400 hover:bg-green-500/10"
        >
          [LOOKUP]
        </button>
      </form>

      {error && <div className="mt-2 text-[11px] leading-relaxed text-amber-400">ERR: {error}</div>}
    </div>
  );
}