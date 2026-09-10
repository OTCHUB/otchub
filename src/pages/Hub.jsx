/// <reference types="vite/client" />
import React, { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { queryClientInstance } from "@/lib/query-client";
import { getQuote, getSwapTx } from "@/lib/jupiterSwap";
import { getSignerForAddress } from "@/lib/walletSigner";
import CommunityMenu from "@/components/otc/CommunityMenu";
import ThemeToggle from "@/components/otc/ThemeToggle";
import Footer from "@/components/otc/Footer";
import { TerminalTopBar, TerminalBottomBar } from "@/components/otc/TerminalBars";
import {
  EnvBadge,
  HubProvider,
  HubRoutes,
  rpcHost,
  useHub,
} from "@/hub";

// $HUB protocol landing (Treasury · Burn · Pot · yield) — mounted at "/hub/*"
// (and, as a forced-devnet sandbox, "/devnet/*") so the hub module's relative
// routes resolve under whichever base path it's mounted at; header nav links
// below are relative (no leading slash) so they work from either mount.
// Signing reuses the wallet connected on "/" (walletSigner); swaps go through
// the jupiterSwapRelay backend function like the OTC swap panel.
const hubSwapTransport = {
  quote: ({ inputMint, outputMint, amount, slippageBps }) =>
    getQuote(inputMint, outputMint, amount, slippageBps),
  swapTransaction: async (quote, userPublicKey) =>
    (await getSwapTx(quote, userPublicKey)).swapTransaction,
};
const CLUSTERS = ["devnet", "mainnet-beta", "localnet"];
const envCluster = import.meta.env.VITE_HUB_CLUSTER ?? "devnet";
export const HUB_CONFIG = {
  rpcUrl: import.meta.env.VITE_HUB_RPC_URL ?? "https://api.devnet.solana.com",
  // Defaults to the address baked into the vendored IDL (devnet deploy).
  programId: import.meta.env.VITE_HUB_PROGRAM_ID || undefined,
  cluster: CLUSTERS.includes(envCluster) ? envCluster : "devnet",
};
// "/devnet" sandbox — always devnet regardless of VITE_HUB_CLUSTER, so it
// keeps working as a risk-free QA environment even after HUB_CONFIG above
// flips to mainnet-beta at launch. Separate RPC/program-id env vars so the
// two mounts never share config once mainnet is live.
export const HUB_DEVNET_CONFIG = {
  rpcUrl: import.meta.env.VITE_HUB_DEVNET_RPC_URL ?? "https://api.devnet.solana.com",
  programId: import.meta.env.VITE_HUB_DEVNET_PROGRAM_ID || undefined,
  cluster: "devnet",
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
        <div className="flex flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1
              className="cursor-help text-sm font-bold uppercase tracking-widest text-green-400 sm:text-base"
              title="H.U.B. — Headquarters for Unhinged Brokers"
            >
              &gt; $HUB :: TREASURY DASHBOARD &amp; YIELD TRACKER
              <span className="ml-1 inline-block animate-blink text-green-500">▋</span>
            </h1>
            <EnvBadge />
          </div>
          <p className="text-[10px] uppercase tracking-widest text-green-500/50">
            the big green button of OTC Desks.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {/* Relative (no leading slash) — resolves under /hub or /devnet alike. */}
          <NavLink to="" end className={navCls}>
            [DASHBOARD]
          </NavLink>
          <NavLink to="treasury" className={navCls}>
            [TREASURY]
          </NavLink>
          <NavLink to="tokenomics" className={navCls}>
            [TOKENOMICS]
          </NavLink>
          <NavLink to="mechanics" className={navCls}>
            [MECHANICS]
          </NavLink>
          <NavLink to="deployments" className={navCls}>
            [DEPLOYMENTS]
          </NavLink>
          <Link
            to="/"
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

// otchub's fixed top/bottom terminal bars + page footer — reads `cluster` from HubProvider, so
// it must render inside the provider (mirrors hubconnect/web's standalone shell AppShell).
function HubShell({ wallet }) {
  const { cluster } = useHub();
  const statusText = `${cluster.toUpperCase().replace(/-/g, "_")}_LINK_ACTIVE`;
  return (
    <div className="min-h-screen max-w-[100vw] overflow-x-hidden bg-black pt-[34px] pb-[34px] font-mono text-green-400">
      <TerminalTopBar label="HUB_TERMINAL" statusText={statusText} />
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6 xl:max-w-[1500px]">
        <HubHeader />
        <main className="mt-3">
          <HubRoutes walletAddress={wallet} />
        </main>
        <Footer />
      </div>
      <TerminalBottomBar>$HUB :: COMMUNITY_TOOLING :: NOT AFFILIATED WITH OTC DESKS</TerminalBottomBar>
    </div>
  );
}

// devnet: force the "/devnet" sandbox config regardless of VITE_HUB_CLUSTER
// (see HUB_DEVNET_CONFIG above) — same component tree, mounted a second time
// at a different route in App.jsx.
export default function Hub({ devnet = false }) {
  // Follow the wallet connected on "/" (same tab or another) without a second connect UI.
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

  const config = devnet ? HUB_DEVNET_CONFIG : HUB_CONFIG;

  return (
    <HubProvider
      rpcUrl={config.rpcUrl}
      programId={config.programId}
      cluster={config.cluster}
      queryClient={queryClientInstance}
      resolveSigner={getSignerForAddress}
      swapTransport={hubSwapTransport}
    >
      <HubShell wallet={wallet} />
    </HubProvider>
  );
}
