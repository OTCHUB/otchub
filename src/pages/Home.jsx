import React, { useEffect, useState, useCallback, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { fetchDashboardBody } from "@/lib/dashboardFeed";
import { RefreshCw } from "lucide-react";
import XIcon from "@/components/otc/XIcon";
import MascotLogo from "@/components/otc/MascotLogo";
import CommunityMenu from "@/components/otc/CommunityMenu";
import ThemeToggle from "@/components/otc/ThemeToggle";
import MetricsStrip from "@/components/otc/MetricsStrip";
import ArbitrageCard from "@/components/otc/ArbitrageCard";
import LauncherAnalytics from "@/components/otc/LauncherAnalytics";
import ProtocolPanel from "@/components/otc/ProtocolPanel";
import ArbitrageChart from "@/components/otc/ArbitrageChart";
import EarningsChart from "@/components/otc/EarningsChart";
import RoundsChart from "@/components/otc/RoundsChart";
import ByStockChart from "@/components/otc/ByStockChart";
import PotSourcesChart from "@/components/otc/PotSourcesChart";
import PerDeskTrendChart from "@/components/otc/PerDeskTrendChart";
import PotRoutingPanel from "@/components/otc/PotRoutingPanel";
import SupplyChart from "@/components/otc/SupplyChart";
import BuybacksPanel from "@/components/otc/BuybacksPanel";
import DesksTables from "@/components/otc/DesksTables";
import HoldingsGallery from "@/components/otc/HoldingsGallery";
import ListingsDepthChart from "@/components/otc/ListingsDepthChart";
import WalletConnect from "@/components/otc/WalletConnect";
import WalletPortfolio from "@/components/otc/WalletPortfolio";
import JupiterSwapPanel from "@/components/otc/JupiterSwapPanel";
import NftTradeCard from "@/components/otc/NftTradeCard";
// First-session boot screen, lazy-loaded: it never weighs down the initial
// bundle for returning (already-booted) visitors. The session-marker check
// is inlined so the BootScreen module stays fully lazy.
const BootScreen = React.lazy(() => import("@/components/otc/BootScreen"));
const hasSeenBoot = () => {
  try {
    return window.sessionStorage.getItem("otc_boot_seen") === "1";
  } catch {
    return false;
  }
};
import { TerminalTopBar } from "@/components/otc/TerminalBars";
import QuickNavBar from "@/components/otc/QuickNavBar";
import KeeperPanel from "@/components/otc/KeeperPanel";
import ContractsPanel from "@/components/otc/ContractsPanel";
import CollapsibleCard from "@/components/otc/CollapsibleCard";
import FooterBranding from "@/components/otc/FooterBranding";
import TerminalVisual from "@/components/otc/TerminalVisual";
import HubOfficialCa from "@/components/otc/HubOfficialCa";
import HeroLanding from "@/components/otc/HeroLanding";

import { useLiveOtcPrice } from "@/lib/useLiveOtcPrice";
import { silentReconnect } from "@/lib/solanaWallets";

// Persisted wallet: the connected address survives page reloads (restored on
// mount) and is only cleared when the user disconnects or connects a different
// wallet — a refresh never kicks them back to the connect screen.
const WALLET_STORAGE_KEY = "otc_wallet_address";

export default function Home() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [wallet, setWalletState] = useState(() => {
    try {
      return window.localStorage.getItem(WALLET_STORAGE_KEY) || null;
    } catch {
      return null;
    }
  });
  // Boot sequence plays ONCE per browser session — reloads skip it.
  const [bootDone, setBootDone] = useState(hasSeenBoot);
  const [walletOpenSignal, setWalletOpenSignal] = useState(0);
  // Hero stat shortcuts: bump the target panel's open signal and scroll to it.
  const [panelOpenSignal, setPanelOpenSignal] = useState({});
  const goPanel = useCallback((id) => {
    setPanelOpenSignal((m) => ({ ...m, [id]: (m[id] || 0) + 1 }));
    setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  }, []);
  const [selectedToken, setSelectedToken] = useState(null); // null keeps the default OTC/SOL pair
  const [swapOpenSignal, setSwapOpenSignal] = useState(0);
  const [swapBusy, setSwapBusy] = useState(false);
  const [portfolioRefreshSignal, setPortfolioRefreshSignal] = useState(0);
  const swapBusyRef = useRef(false);
  const onSwapBusyChange = useCallback((busy) => {
    swapBusyRef.current = busy;
    setSwapBusy(busy);
  }, []);
  const tradeLauncher = useCallback((token) => {
    if (swapBusyRef.current) return;
    setSelectedToken(token);
    setSwapOpenSignal((s) => s + 1);
  }, []);
  const resetSwapToken = useCallback(() => {
    if (!swapBusyRef.current) setSelectedToken(null);
  }, []);
  // Any confirmed wallet interaction (swap OR claim) changes on-chain
  // balances: bump one signal that BOTH the wallet panel and the swap panel
  // watch to re-read their balances live from chain.
  const onWalletActivity = useCallback(() => {
    setPortfolioRefreshSignal((s) => s + 1);
  }, []);
  const updateLauncherSnapshot = useCallback((snapshot) => {
    setSelectedToken((selected) => selected
      ? snapshot.ranked.find((row) => row.mint === selected.mint) || selected : null);
  }, []);
  useEffect(() => {
    if (!swapOpenSignal) return;
    const timer = setTimeout(() => document.getElementById("otc-swap")
      ?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    return () => clearTimeout(timer);
  }, [swapOpenSignal]);

  // setWallet persists (or clears) the connected address; null = disconnect.
  const setWallet = useCallback((addr) => {
    setWalletState(addr);
    try {
      if (addr) window.localStorage.setItem(WALLET_STORAGE_KEY, addr);
      else window.localStorage.removeItem(WALLET_STORAGE_KEY);
    } catch {
      /* storage unavailable — session-only connection */
    }
  }, []);

  // Reload restore: if the injected wallet is still authorized for this site,
  // silently re-register its signer so CLAIM/SWAP work immediately (no prompt
  // ever shown). Wallet extensions inject at slightly different times, so
  // retry briefly; the read-only portfolio shows regardless.
  useEffect(() => {
    if (!wallet) return;
    const timers = [0, 500, 1500, 3000].map((d) =>
      setTimeout(() => silentReconnect(wallet), d)
    );
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Jump the user straight to the wallet connect controls (e.g. from the
  // swap panel when no wallet is connected): expand the card, then scroll.
  const goWalletConnect = useCallback(() => {
    setWalletOpenSignal((s) => s + 1);
    setTimeout(() => {
      document
        .getElementById("otc-wallet")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }, []);

  const load = useCallback(async () => {
    try {
      // Direct Supabase read (zero Base44 entity reads); the getOtcDashboard
      // function only serves as the fallback inside dashboardFeed when the
      // Supabase mirror is unreachable.
      const body = await fetchDashboardBody();
      setData(body);
      setError(null);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh the dashboard view every 60s so listings/trends reflect
  // quick secondary-market buy-ups captured by the 5-min snapshot workflow,
  // without requiring a manual force-refresh.
  useEffect(() => {
    const id = setInterval(() => {
      load();
    }, 60000);
    return () => clearInterval(id);
  }, [load]);

  // Deep links (e.g. /#otc-arbitrage from RU_FOMO's get-access CTA): SPAs
  // render after the browser's native fragment scroll, so re-scroll once the
  // target section has mounted.
  useEffect(() => {
    if (!window.location.hash) return;
    const t = setTimeout(() => {
      document.querySelector(window.location.hash)?.scrollIntoView({ block: "start" });
    }, 1500);
    return () => clearTimeout(t);
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await base44.functions.invoke("fetchOtcData", { force: true });
      await load();
    } catch (e) {
      setError(e?.response?.data?.error || e.message || "Refresh failed (admin only)");
    } finally {
      setRefreshing(false);
    }
  };

  const snapshot = data?.latest;
  // Live DexScreener OTC + SOL price poll (every ~15s) merged over the stored
  // snapshot so the displayed price, SOL conversion, and arbitrage stay fresh
  // between the 5-minute backend ingests.
  const live = useLiveOtcPrice(snapshot);
  const latest = live && snapshot ? { ...snapshot, ...live } : snapshot;

  // Trailing 7-day average per-desk daily earning (SOL) — used to estimate a
  // connected wallet's daily earning from its owned (activated) desks.
  const perDeskItems = latest?.per_desk?.items || [];
  // Estimates come from CLOSED (completed) days only — the newest feed day
  // is today's in-progress working day with partial numbers.
  const todayKey = new Date().toISOString().slice(0, 10);
  const closedPd = perDeskItems.filter((d) => String(d.day || "") < todayKey);
  const sortedPd = [...closedPd].sort((a, b) =>
    String(b.day || "").localeCompare(String(a.day || ""))
  );
  const trailingPd = sortedPd.slice(0, 7).filter((d) => (d.per_desk_sol || 0) > 0);
  const perDesk7dSol = trailingPd.length
    ? trailingPd.reduce((a, d) => a + (d.per_desk_sol || 0), 0) / trailingPd.length
    : sortedPd[0]?.per_desk_sol ?? 0;
  // 24H window = the latest CLOSED daily row; shown next to the 7D trailing average.
  const perDesk24hSol = sortedPd[0]?.per_desk_sol ?? 0;

  // First visit this session: the boot sequence plays while the dashboard
  // fetch runs in parallel and reveals the app the moment data lands.
  if (!bootDone) {
    return (
      <React.Suspense fallback={null}>
        <BootScreen ready={!loading} onComplete={() => setBootDone(true)} />
      </React.Suspense>
    );
  }
  // Returning visitors see the app INSTANTLY: the dashboard renders right
  // away with a slim "syncing" banner in the header (panels show live "—"
  // placeholders) while the first snapshot resolves — no full-screen
  // spinner gate.

  return (
    <div className="skin-stage min-h-screen max-w-[100vw] overflow-x-hidden bg-black pt-[34px] pb-[52px] font-mono text-green-400">
      <TerminalTopBar label="OTC hub terminal" />
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6 xl:max-w-[1500px]">
        {/* Header */}
        <header className="term-window border border-green-500/30 bg-black p-2.5 sm:p-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 leading-none">
                <MascotLogo className="h-8 w-8 object-contain sm:h-9 sm:w-9" />
              </span>
              <span className="truncate text-base font-bold uppercase tracking-widest text-green-400 sm:text-lg">
                OTC_HUB
              </span>
              <span className="inline-block animate-pulse text-green-500">▋</span>
            </h1>
            {/* single-line actions: hamburger nav + X profile + theme/refresh */}
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <CommunityMenu />
              <a
                href="https://x.com/otchubdev"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center border border-green-500/50 p-1.5 text-green-400 hover:bg-green-500/10 sm:p-2"
                title="OTC_HUB on X (@otchubdev)"
                aria-label="OTC_HUB profile on X"
              >
                <XIcon className="h-4 w-4" />
              </a>
              <ThemeToggle />
              <button
                onClick={refresh}
                disabled={refreshing}
                className="inline-flex items-center justify-center border border-green-500/50 p-1.5 text-green-400 hover:bg-green-500/10 disabled:opacity-40 sm:p-2"
                title="Force a fresh data snapshot (admin)"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>
          {error && (
            <div className="mt-2 border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-[13px] text-amber-400">
            Error · {error}
            </div>
          )}
          {/* First snapshot still in flight (or auto-refresh running): slim
              inline sync indicator instead of a blocking full-screen gate. */}
          {!data && !error && (
            <div className="mt-2 flex items-center gap-2 border border-cyan-500/40 bg-cyan-500/5 px-2 py-1.5 text-[13px] text-cyan-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
              Syncing live data…
            </div>
          )}
          {/* Official $HUB CA banner — hidden until the real mint is set */}
          <HubOfficialCa />
        </header>

        {/* Hero landing — scroll straight into the analytics below */}
        <HeroLanding latest={latest} onGoPanel={goPanel} onConnectWallet={goWalletConnect} />

        {/* Wallet */}
        <div className="mt-3">
          {/* Auto-expand while a wallet is connected: the signal carries +1 for
              a connected wallet, so a persisted wallet opens the panel on
              mount and a fresh connect opens it immediately; disconnect
              returns to 0 and leaves the card as the user left it. */}
          <CollapsibleCard
            title="Wallet"
            id="otc-wallet"
            openSignal={walletOpenSignal + (wallet ? 1 : 0)}
            defaultOpen={false}
            right={
              <span
                className={`flex items-center gap-1.5 font-mono text-[11px] ${
                  wallet ? "text-emerald-400" : "text-green-500/40"
                }`}
              >
                {wallet ? (
                  <>
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                    {`CONNECTED · ${wallet.slice(0, 4)}…${wallet.slice(-4)}`}
                  </>
                ) : (
                  "NOT CONNECTED"
                )}
              </span>
            }
          >
            {wallet ? (
              <WalletPortfolio
                address={wallet}
                onClear={() => setWallet(null)}
                perDesk24hSol={perDesk24hSol}
                perDesk7dSol={perDesk7dSol}
                refreshSignal={portfolioRefreshSignal}
                onActivity={onWalletActivity}
              />
            ) : (
              <WalletConnect onConnected={setWallet} />
            )}
          </CollapsibleCard>
        </div>

        {/* Trade hub: two-way token swap + NFT desk trade routes — directly
            under the wallet panel so a connected wallet can swap right away */}
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2" id="otc-swap">
            <CollapsibleCard title={selectedToken ? `Trade · $${selectedToken.symbol || "token"}` : "Trade · $OTC token"}
              openSignal={swapOpenSignal + (panelOpenSignal["otc-swap"] || 0)} locked={swapBusy}>
              <JupiterSwapPanel
                wallet={wallet}
                latest={latest}
                history={data?.history}
                onGoConnect={goWalletConnect}
                onConnected={setWallet}
                token={selectedToken || undefined}
                onBusyChange={onSwapBusyChange}
                onResetToken={resetSwapToken}
                onSwapComplete={onWalletActivity}
                balanceRefreshSignal={portfolioRefreshSignal}
              />
            </CollapsibleCard>
          </div>
          <CollapsibleCard title="Trade · NFT desks" id="otc-nft-trade">
            <NftTradeCard />
          </CollapsibleCard>
        </div>

        {/* All 8 headline metrics in one dense ticker strip */}
        <MetricsStrip latest={latest} history={data?.history} />

        {/* Arbitrage + Protocol */}
        <div className="mt-3 grid items-stretch gap-3 lg:grid-cols-3">
          <div className="h-full lg:col-span-2">
            <CollapsibleCard title="Arbitrage" id="otc-arbitrage" openSignal={panelOpenSignal["otc-arbitrage"] || 0}>
              <ArbitrageCard latest={latest} holdings={data?.holdings} />
            </CollapsibleCard>
          </div>
          <CollapsibleCard title="Protocol" id="otc-protocol" openSignal={panelOpenSignal["otc-protocol"] || 0}>
            <ProtocolPanel latest={latest} />
          </CollapsibleCard>
        </div>

        {/* Live launch rankings select a mint in the shared SOL swap panel. */}
        <div className="mt-3">
          <CollapsibleCard title="OTC analytics" id="otc-analytics" right={null} openSignal={0}>
            <LauncherAnalytics onTrade={tradeLauncher} selectedMint={selectedToken?.mint}
              tradingDisabled={swapBusy} onSnapshot={updateLauncherSnapshot} />
          </CollapsibleCard>
        </div>

        {/* Supply vs desks minted + live terminal filler (desktop) */}
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <CollapsibleCard title="Supply vs desks">
              <SupplyChart history={data?.history} latest={latest} />
            </CollapsibleCard>
          </div>
          <div className="term-window hidden border border-green-500/30 bg-black lg:flex lg:flex-col">
            <div className="flex items-center justify-between border-b border-green-500/20 px-3 py-2 text-[12px] uppercase tracking-widest text-green-500/70">
              <span>Terminal · chain feed</span>
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                LIVE
              </span>
            </div>
            <div className="min-h-0 flex-1">
              <TerminalVisual variant="feed" />
            </div>
          </div>
        </div>

        {/* Listings: secondary-market desk inventory feeding the swap above */}
        <div className="mt-3">
          <CollapsibleCard title="Listings · NFT holdings" id="otc-listings">
            <ListingsDepthChart holdings={data?.holdings} />
            <div className="mt-3">
              <HoldingsGallery holdings={data?.holdings} byStock={latest?.by_stock?.items} floorSol={latest?.nft_floor_sol} />
            </div>
          </CollapsibleCard>
        </div>

        {/* Pot fee routing map: live source → vault → pot → desks flow */}
        <div className="mt-3">
          <CollapsibleCard title="Pot routing · live fee flow">
            <PotRoutingPanel latest={latest} />
          </CollapsibleCard>
        </div>

        {/* Charts */}
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <CollapsibleCard title="Arbitrage trend">
            <ArbitrageChart history={data?.history} />
          </CollapsibleCard>
          <CollapsibleCard title="Earnings">
            <EarningsChart latest={latest} history={data?.history} />
          </CollapsibleCard>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <CollapsibleCard title="Rounds">
            <RoundsChart latest={latest} />
          </CollapsibleCard>
          <CollapsibleCard title="Buybacks">
            <BuybacksPanel latest={latest} />
          </CollapsibleCard>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <CollapsibleCard title="Per-desk earn" id="otc-per-desk" openSignal={panelOpenSignal["otc-per-desk"] || 0}>
            <PerDeskTrendChart latest={latest} />
          </CollapsibleCard>
          <CollapsibleCard title="By stock">
            <ByStockChart latest={latest} />
          </CollapsibleCard>
        </div>

        {/* Desk pot revenue by source (stacked) */}
        <div className="mt-3">
          <CollapsibleCard title="Pot revenue · desk sources">
            <PotSourcesChart latest={latest} />
          </CollapsibleCard>
        </div>

        {/* Tables */}
        <div className="mt-3">
          <CollapsibleCard title="Desks · distribution">
            <DesksTables latest={latest} />
          </CollapsibleCard>
        </div>

        {/* On-chain map: every contract/account/mint/source the app is built on */}
        <div className="mt-3">
          <CollapsibleCard title="Contracts · map & agent connect" defaultOpen={false}>
            <ContractsPanel />
          </CollapsibleCard>
        </div>

        {/* Keeper: housekeeping panel — automated distribute crank details, kept last */}
        <div className="mt-3">
          <CollapsibleCard title="Keeper · auto-distribute" defaultOpen={false}>
            <KeeperPanel />
          </CollapsibleCard>
        </div>

        <FooterBranding />
      </div>
      <QuickNavBar onWallet={goWalletConnect} />
    </div>
  );
}