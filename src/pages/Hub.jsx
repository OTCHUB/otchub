/// <reference types="vite/client" />
import React, { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { queryClientInstance } from "@/lib/query-client";
import CommunityMenu from "@/components/otc/CommunityMenu";
import ThemeToggle from "@/components/otc/ThemeToggle";
import { EnvBadge, HubProvider, HubRoutes, rpcHost, useHub } from "@/hub";

// $HUB protocol landing (Treasury · Burn · Pot · yield) — mounted at "/" so the
// hub module's relative routes resolve to /treasury, /deployments, /desk/:asset.
// Read-only: no wallet signer, separate devnet RPC from the mainnet relay.
const CLUSTERS = ["devnet", "mainnet-beta", "localnet"];
const envCluster = import.meta.env.VITE_HUB_CLUSTER ?? "devnet";
export const HUB_CONFIG = {
  rpcUrl: import.meta.env.VITE_HUB_RPC_URL ?? "https://api.devnet.solana.com",
  // Defaults to the address baked into the vendored IDL (devnet deploy).
  programId: import.meta.env.VITE_HUB_PROGRAM_ID || undefined,
  cluster: CLUSTERS.includes(envCluster) ? envCluster : "devnet",
};

// Shared with pages/Home.jsx: the address persisted by WalletConnect.
const WALLET_STORAGE_KEY = "otc_wallet_address";

const navCls = ({ isActive }) =>
  `inline-flex items-center whitespace-nowrap border px-2 py-1 text-[12px] sm:px-2.5 sm:py-1.5 sm:text-[13px] ${
    isActive
      ? "border-green-400 bg-green-500/15 text-green-200"
      : "border-green-500/50 text-green-400 hover:bg-green-500/10"
  }`;

function HubHeader() {
  const { cluster, programId, connection } = useHub();
  return (
    <header className="border border-green-500/30 bg-black">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-green-500/30 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-sm font-bold uppercase tracking-widest text-green-400 sm:text-base">
            &gt; $HUB :: TREASURY DASHBOARD &amp; YIELD TRACKER
            <span className="ml-1 inline-block animate-blink text-green-500">▋</span>
          </h1>
          <EnvBadge />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <NavLink to="/" end className={navCls}>
            [DASHBOARD]
          </NavLink>
          <NavLink to="/treasury" className={navCls}>
            [TREASURY]
          </NavLink>
          <NavLink to="/deployments" className={navCls}>
            [DEPLOYMENTS]
          </NavLink>
          <Link
            to="/otc"
            className="inline-flex items-center whitespace-nowrap border border-emerald-500/70 px-2 py-1 text-[12px] font-bold text-emerald-400 hover:bg-emerald-500/10 sm:px-2.5 sm:py-1.5 sm:text-[13px]"
            title="OTC_DESK analytics: $OTC price, desk arbitrage, pot revenue, claims"
          >
            [OTC_HUB →]
          </Link>
          <CommunityMenu />
          <ThemeToggle />
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 px-3 py-1 text-[10px] text-green-500/50">
        <span>cluster: {cluster}</span>
        <span className="truncate">rpc: {rpcHost(connection.rpcEndpoint)}</span>
        <span className="truncate">program: {programId.toBase58()}</span>
      </div>
    </header>
  );
}

export default function Hub() {
  // Follow the wallet connected on /otc (same tab or another) without a second connect UI.
  const [wallet, setWallet] = useState(() => {
    try {
      return window.localStorage.getItem(WALLET_STORAGE_KEY) || undefined;
    } catch {
      return undefined;
    }
  });
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === WALLET_STORAGE_KEY) setWallet(e.newValue || undefined);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <HubProvider
      rpcUrl={HUB_CONFIG.rpcUrl}
      programId={HUB_CONFIG.programId}
      cluster={HUB_CONFIG.cluster}
      queryClient={queryClientInstance}
    >
      <div className="min-h-screen max-w-[100vw] overflow-x-hidden bg-black font-mono text-green-400">
        <div className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6 xl:max-w-[1500px]">
          <HubHeader />
          <main className="mt-3">
            <HubRoutes walletAddress={wallet} />
          </main>
        </div>
      </div>
    </HubProvider>
  );
}
