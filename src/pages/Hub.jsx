/// <reference types="vite/client" />
import React, { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { queryClientInstance } from "@/lib/query-client";
import { getQuote, getSwapTx } from "@/lib/jupiterSwap";
import { getSignerForAddress } from "@/lib/walletSigner";
import { silentReconnect } from "@/lib/solanaWallets";
import { HubNavMenu } from "@/hub/components/HubNavMenu";
import MascotLogo from "@/components/otc/MascotLogo";
import ThemeToggle from "@/components/otc/ThemeToggle";
import Footer from "@/components/otc/Footer";
import { TerminalTopBar } from "@/components/otc/TerminalBars";
import HubQuickNav from "@/hub/components/HubQuickNav";
import {
  EnvBadge,
  HubProvider,
  HubRoutes,
  rpcHost,
  useHub,
  useWallet,
  WalletProvider,
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
  `inline-flex items-center whitespace-nowrap border px-2 py-1 text-[11px] uppercase tracking-widest sm:px-2.5 sm:py-1.5 sm:text-[12px] ${
    isActive
      ? "border-green-400 bg-green-500/15 text-green-200"
      : "border-green-500/40 text-green-400/80 hover:bg-green-500/10 hover:text-green-300"
  }`;

// Same chrome as the OTC dashboard's header (pages/Home.jsx): mascot + wordmark +
// blink cursor left, icon actions right, section nav as bracketed links, and the
// cluster telemetry as a hairline strip — so hopping between "/" and "/hub" reads
// as one continuous terminal.
function HubHeader() {
  const { cluster, programId, connection } = useHub();
  return (
    <header className="term-window border border-green-500/30 bg-black p-2.5 sm:p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1
          className="flex min-w-0 cursor-help items-center gap-2"
          title="H.U.B. — Headquarters for Unhinged Brokers"
        >
          <span className="shrink-0 leading-none">
            <MascotLogo className="h-8 w-8 object-contain sm:h-9 sm:w-9" />
          </span>
          <span className="truncate text-base font-bold uppercase tracking-widest text-green-400 sm:text-lg">
            $HUB
          </span>
          <span className="hidden text-[10px] uppercase tracking-widest text-green-500/50 md:inline">
            treasury · yield tracker
          </span>
          <span className="inline-block animate-blink text-green-500">▋</span>
          <EnvBadge />
        </h1>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <Link
            to="/"
            className="inline-flex items-center whitespace-nowrap border border-emerald-500/50 px-2 py-1.5 text-[11px] font-bold uppercase tracking-widest text-emerald-400 hover:bg-emerald-500/10 sm:px-2.5 sm:text-[12px]"
            title="OTC_HUB analytics: $OTC price, desk arbitrage, pot revenue, claims"
          >
            OTC_HUB →
          </Link>
          <HubNavMenu />
          <ThemeToggle />
        </div>
      </div>
      <nav className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Hub sections">
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
        {cluster === "devnet" && (
          <NavLink to="drip" className={navCls}>
            [FAUCET]
          </NavLink>
        )}
      </nav>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 border-t border-green-500/20 pt-1.5 text-[10px] text-green-500/50">
        <span>cluster: {cluster}</span>
        <span className="truncate">rpc: {rpcHost(connection.rpcEndpoint)}</span>
        <span className="truncate">program: {programId.toBase58()}</span>
      </div>
    </header>
  );
}

// otchub's fixed top/bottom terminal bars + page footer — reads `cluster` from HubProvider, so
// it must render inside the provider (mirrors hubconnect/web's standalone shell AppShell).
// Also mirrors the host-connected `wallet` (otc_wallet_address, from "/") into the hub module's
// own WalletProvider context, so panels that read useWallet() directly (faucet, airdrop checker,
// mock-desk mint) stay in sync with whatever the rest of otchub treats as "your" wallet, exactly
// like every panel that still takes the walletAddress prop.
function HubShell({ wallet }) {
  const { cluster } = useHub();
  const hubWallet = useWallet();
  useEffect(() => {
    if (wallet && wallet !== hubWallet.address) hubWallet.connect(wallet);
    else if (!wallet && hubWallet.address) hubWallet.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-sync when the host wallet changes
  }, [wallet]);
  const statusText = `${cluster.toUpperCase().replace(/-/g, "_")}_LINK_ACTIVE`;
  return (
    <div className="min-h-screen max-w-[100vw] overflow-x-hidden bg-black pt-[34px] pb-[52px] font-mono text-green-400">
      <TerminalTopBar label="HUB_TERMINAL" statusText={statusText} />
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6 xl:max-w-[1500px]">
        <HubHeader />
        <main className="mt-3">
          <HubRoutes walletAddress={wallet} />
        </main>
        <Footer />
      </div>
      <HubQuickNav />
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

  // Landing directly on "/hub" (bookmark, refresh, shared link) never mounts
  // pages/Home.jsx, so its own silentReconnect-on-mount effect never runs and
  // walletSigner.js's module-level signer registry stays empty even though
  // `wallet` (mirrored from otc_wallet_address above) shows a connected
  // address. That desynced the resolveSigner(address) lookup every panel here
  // uses from the actually-registered signer, so CLAIM_ALL / activations fell
  // back to "read-only address — connect the wallet itself" despite the
  // header showing the wallet as connected. Re-run the same retry-on-mount
  // silent reconnect Home.jsx does so the signer gets registered regardless
  // of which route was loaded first.
  useEffect(() => {
    if (!wallet) return;
    const timers = [0, 500, 1500, 3000].map((d) => setTimeout(() => silentReconnect(wallet), d));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- retry burst keyed on the address itself
  }, [wallet]);

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
      <WalletProvider>
        <HubShell wallet={wallet} />
      </WalletProvider>
    </HubProvider>
  );
}