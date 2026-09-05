import React, { useState, useEffect } from "react";
import { detectWallets, connectWallet, subscribeStandardWallets } from "@/lib/solanaWallets";
import HelpNote from "@/components/otc/HelpNote";

// official brand marks, vendored in /public/wallets (no hotlinks)
const BRAND_ICON = {
  phantom: "/wallets/phantom.svg",
  solflare: "/wallets/solflare.ico",
  backpack: "/wallets/backpack.ico",
  jupiter: "/wallets/jupiter.ico",
};

export default function WalletConnect({ onConnected }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);   // e.g. AWAITING_SOLFLARE_APPROVAL
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);       // connected pk -> panel auto-collapses
  const [connectingId, setConnectingId] = useState(null);  // row-level pulse during handshake
  const [manual, setManual] = useState("");
  const [wallets, setWallets] = useState(() => detectWallets());
  // Solflare universal link: opens THIS page inside Solflare's in-app browser,
  // where window.solflare is injected and connect works natively.
  const solflareDeepLink = `https://solflare.com/ul/v1/browse/${encodeURIComponent(
    typeof window !== "undefined" ? window.location.href : "https://otchub.dev"
  )}`;

  // Standard wallets (e.g. Jupiter Mobile) register asynchronously after the
  // app fires `wallet-standard:app-ready`. Re-detect whenever one registers.
  useEffect(() => {
    const refresh = () => setWallets(detectWallets());
    refresh();
    const unsub = subscribeStandardWallets(refresh);
    // Also poll briefly for the first couple seconds — some wallets register
    // slightly out of band of the event in in-app browsers.
    const t1 = setTimeout(refresh, 500);
    const t2 = setTimeout(refresh, 1500);
    const t3 = setTimeout(refresh, 3000);
    return () => {
      unsub();
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  const handleConnect = async () => {
    setError(null);
    setBusy(true);
    try {
      const list = detectWallets();
      setWallets(list);
      if (!list.length) {
        setError(
          "No Solana wallet detected yet. On mobile, open this page inside Solflare (link below) or Jupiter's in-app browser — or paste your address."
        );
        return;
      }
      if (list.length === 1) {
        await doConnect(list[0]);
      }
      // several providers: the always-visible row list is the picker
    } catch (e) {
      setError(e?.message || "Connect failed");
    } finally {
      setBusy(false);
    }
  };

  const doConnect = async (wallet) => {
    setConnectingId(wallet.id);
    setBusy(true);
    setError(null);
    setStatus(`AWAITING_${wallet.name.toUpperCase().replace(/\s+/g, "_")}_APPROVAL`);
    try {
      const pk = await connectWallet(wallet);
      if (!pk) throw new Error(`${wallet.name} returned no public key`);
      setStatus(null);
      setDone(pk);                  // success -> collapse the panel, reveal the app
      onConnected?.(pk);
    } catch (e) {
      setStatus(null);
      const msg = e?.message || `${wallet.name} connect failed`;
      setError(/reject|declin|denied|4001/i.test(msg) ? `${wallet.name}: request rejected — approve the prompt in your wallet to continue.` : msg);
    } finally {
      setBusy(false);
      setConnectingId(null);
    }
  };

  const submitManual = (e) => {
    e.preventDefault();
    const a = manual.trim();
    if (a) { setDone(a); onConnected?.(a); }
  };

  if (done) {
    // verified -> auto-dismiss to the tape/portfolio (manual reopen available)
    const short = `${done.slice(0, 6)}…${done.slice(-4)}`;
    return (
      <button
        type="button"
        onClick={() => setDone(null)}
        className="flex w-full items-center justify-between border border-green-500/30 bg-black px-3 py-2 text-left transition-opacity"
        title="reopen wallet connect"
      >
        <span className="text-[10px] uppercase tracking-widest text-green-500/70">WALLET_CONNECT</span>
        <span className="text-[11px] font-bold text-green-400">[ CONNECTED ✓ {short} ]</span>
        <span className="text-[9px] text-green-500/40">▾</span>
      </button>
    );
  }

  return (
    <div className="border border-green-500/30 bg-black p-3 transition-all duration-200">
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
          {wallets.length > 0 && ` · ${wallets.length} DETECTED`}
        </span>
      </div>

      {status && (
        <div className="mt-2 text-[11px] text-green-400 animate-pulse">&gt; {status}</div>
      )}

      {wallets.length === 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-green-500/50">
          <span>MOBILE?</span>
          <a
            href={solflareDeepLink}
            className="border border-green-500/50 px-2.5 py-1.5 text-[11px] text-green-400 hover:bg-green-500/10"
          >
            [OPEN_IN_SOLFLARE ↗]
          </a>
          <span className="text-green-500/40">opens this page in the Solflare in-app browser</span>
        </div>
      )}

      <HelpNote label="[?] WALLET_SAFETY :: WHY_SIGNING_WARNS">
        Wallet warnings here are NORMAL for a community tool — Phantom flags any app or program that
        is not on its own verified list. Connecting is READ-ONLY: the app sees your public balances,
        never your keys. Claim transactions only touch the official otcdesks.cash desk program
        (AjMx…dHQW — cross-check it on the sign screen against the CONTRACTS panel) and always
        deliver stock to YOUR OWN wallet; every transaction is simulated first, so you are never
        asked to sign one that would fail. Swaps route through Jupiter — an "unknown token" warning
        only means $OTC is not on Phantom's verified-token list. When in doubt, verify the program
        ID on the wallet prompt at solscan.io before approving.
      </HelpNote>

      {wallets.length > 0 && (
        <div className="mt-3 border border-green-500/30 p-2">
          <span className="text-[10px] text-green-500/60">SELECT_WALLET:</span>
          <div className="mt-1.5 space-y-1.5">
            {wallets.map((p) => (
              <button
                key={p.id}
                onClick={() => doConnect(p)}
                disabled={busy}
                className={`flex w-full items-center gap-2.5 border border-green-500/30 px-2.5 py-2 text-left text-[12px] text-green-400 hover:bg-green-500/10 disabled:opacity-50 ${connectingId === p.id ? "animate-pulse bg-green-500/10" : ""}`}
              >
                <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center border border-green-500/35 bg-black text-[11px] font-bold text-green-400 overflow-hidden">
                  {(p.wallet?.icon || BRAND_ICON[p.id])
                    ? <img src={p.wallet?.icon || BRAND_ICON[p.id]} alt="" className="h-full w-full object-contain p-[2px]" />
                    : (p.name || "?")[0].toUpperCase()}
                </span>
                <span className="flex-1">{p.name.toUpperCase()}</span>
                <span className="text-[9px] text-green-500/40">{connectingId === p.id ? "CONNECTING…" : "DETECTED"}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={submitManual} className="mt-3 flex flex-wrap gap-2">
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