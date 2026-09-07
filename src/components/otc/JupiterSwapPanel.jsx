import React, { useEffect, useRef, useState } from "react";
import { Check, Copy, Zap } from "lucide-react";
import {
  SOL_MINT,
  OTC_MINT,
  getTokenInfo,
  getQuote,
  getSwapTx,
  executeSwap,
  fetchTokenBalance,
  fetchSolBalanceRaw,
} from "@/lib/jupiterSwap";
import { formatRawAmount, parseAmountToRaw, parseSlippageBps } from "@/lib/swapAmounts";
import { getSignerForAddress } from "@/lib/walletSigner";
import { fetchTokenPricesUsd } from "@/lib/stockPrices";
import { fmtUsd, fmtCompact, fmtPct } from "@/lib/format";
import HelpNote from "@/components/otc/HelpNote";
import TxStatusOverlay from "@/components/otc/TxStatusOverlay";
import RecentSwaps from "@/components/otc/RecentSwaps";
import PriceCandles from "@/components/otc/PriceCandles";
import WalletConnect from "@/components/otc/WalletConnect";

const DEFAULT_TOKEN = { mint: OTC_MINT, symbol: "OTC" };
const SOL_FEE_RESERVE = 10_000_000n; // 0.01 SOL, not a guarantee of the final fee/rent.
const SLIPPAGE_OPTIONS = [
  { label: "0.5%", bps: 50 },
  { label: "1%", bps: 100 },
  { label: "3%", bps: 300 },
];

function snapshotTime(at) {
  const ms = typeof at === "number" ? at : Date.parse(at);
  return Number.isFinite(ms) && ms > 0 && ms <= 8640000000000000 ? new Date(ms).toISOString() : null;
}

// token: { mint, symbol, name?, mcap?, change24h?, vol24?, liquidity?, metricsAt? }.
// Home owns selection; never key/remount this panel while a wallet is signing.
export default function JupiterSwapPanel({ wallet, latest, history, onGoConnect, onConnected, token = DEFAULT_TOKEN, onBusyChange, onResetToken }) {
  const mint = token?.mint || OTC_MINT;
  const symbol = token?.symbol || (mint === OTC_MINT ? "OTC" : "TOKEN");
  const tokenLabel = `$${symbol.replace(/^\$/, "")}`;
  const isOtc = mint === OTC_MINT;
  const [mode, setMode] = useState("BUY"); // "BUY" | "SELL"
  const [amount, setAmount] = useState("0.1");
  const [formEpoch, setFormEpoch] = useState(0);
  const [slippageBps, setSlippageBps] = useState(100);
  const [quoteState, setQuote] = useState(null);
  const [quotingGeneration, setQuoting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [logState, setLogs] = useState([]);
  const [copied, setCopied] = useState(null);
  const [errorState, setError] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [balances, setBalances] = useState(null);
  const [customSlip, setCustomSlip] = useState(""); // custom slippage % (overrides presets)
  const [priceState, setPrices] = useState(null);
  const [priceUnit, setPriceUnit] = useState("USD"); // shared USD/SOL toggle for candles + trades feed
  const [txPhase, setTxPhase] = useState(null); // live swap phase for the status overlay
  const mounted = useRef(false);
  const lifetime = useRef(0);
  const busyRef = useRef(false);
  const activeSwapDetail = useRef(null);
  const quoteRequest = useRef(0);
  const metadataRequest = useRef(0);
  const balanceRequest = useRef(0);
  const timers = useRef(new Set());
  const context = useRef({ key: null, generation: 0, mint, mintEpoch: 0, wallet, walletEpoch: 0 });
  const key = JSON.stringify([mint, wallet || null, amount, mode, slippageBps, customSlip]);
  // Render-time invalidation hides old data before effects run, including A→B→A.
  if (context.current.key !== key) {
    context.current.key = key;
    context.current.generation++;
  }
  if (context.current.mint !== mint) {
    context.current.mint = mint;
    context.current.mintEpoch++;
  }
  if (context.current.wallet !== wallet) {
    context.current.wallet = wallet;
    context.current.walletEpoch++;
  }
  const { generation, mintEpoch, walletEpoch } = context.current;
  const formReady = formEpoch === mintEpoch;
  const tokenInfo = metadata?.epoch === mintEpoch ? metadata.info : null;
  const metadataError = metadata?.epoch === mintEpoch ? metadata.error : null;
  const quote = tokenInfo && quoteState?.generation === generation ? quoteState.data : null;
  const quoting = quotingGeneration === generation;
  const currentBalances = tokenInfo && balances?.mintEpoch === mintEpoch && balances?.walletEpoch === walletEpoch ? balances : null;
  const tokenBal = currentBalances?.token ?? null;
  const solBal = currentBalances?.sol ?? null;
  const prices = priceState?.epoch === mintEpoch ? priceState.data : {};
  const logs = logState.filter((entry) => entry.generation === generation);
  const err = errorState?.generation === generation ? errorState.message : null;
  const setErr = (message) => setError({ generation, message });
  const isCurrent = (life) => mounted.current && lifetime.current === life && context.current.generation === generation;
  const isBalanceCurrent = (life) => mounted.current && lifetime.current === life && context.current.mintEpoch === mintEpoch && context.current.walletEpoch === walletEpoch;
  const later = (fn, delay) => {
    const timer = setTimeout(() => { timers.current.delete(timer); fn(); }, delay);
    timers.current.add(timer);
    return timer;
  };

  // Pre-sign work dies on unmount. Already signed sends/confirmations continue.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      lifetime.current++;
      quoteRequest.current++;
      balanceRequest.current++;
      timers.current.forEach(clearTimeout);
      timers.current.clear();
    };
  }, []);

  // Reset only on an actual mint change, not refreshed token props or wallets.
  // formReady blocks old form actions until this reset has rendered.
  useEffect(() => {
    if (formEpoch === mintEpoch || context.current.mintEpoch !== mintEpoch) return;
    setMode("BUY");
    setAmount("0.1");
    setFormEpoch(mintEpoch);
  }, [mintEpoch, formEpoch]);

  // Mint metadata is public and independent of wallet/form state. Retries use
  // the same mint epoch and last-request-wins guard; never trust feed decimals.
  const loadMetadata = async () => {
    const life = lifetime.current;
    if (!mounted.current || context.current.mintEpoch !== mintEpoch) return;
    const request = ++metadataRequest.current;
    const current = () => mounted.current && lifetime.current === life && context.current.mintEpoch === mintEpoch && metadataRequest.current === request;
    setMetadata({ epoch: mintEpoch });
    try {
      const info = await getTokenInfo(mint);
      if (current()) setMetadata({ epoch: mintEpoch, info });
    } catch (error) {
      if (current()) setMetadata({ epoch: mintEpoch, error: error.message });
    }
  };

  useEffect(() => {
    loadMetadata();
    return () => { metadataRequest.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mint, mintEpoch]);

  useEffect(() => {
    if (!tokenInfo) return;
    let cancelled = false;
    const controller = new AbortController();
    const current = () => !cancelled && mounted.current && context.current.mintEpoch === mintEpoch;
    (async () => {
      try {
        const data = { ...await fetchTokenPricesUsd([SOL_MINT, mint]) };
        if (!current()) return;
        // The shared OTC spot cache may not contain an arbitrary selected mint.
        if (data[mint] == null) {
          try {
            const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, { signal: controller.signal });
            if (res.ok) {
              const body = await res.json();
              const pairs = (body.pairs || []).filter((p) => p.chainId === "solana" && p.baseToken?.address === mint && Number.isFinite(Number(p.priceUsd)) && Number(p.priceUsd) > 0);
              pairs.sort((a, b) => (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0));
              if (pairs[0]) data[mint] = Number(pairs[0].priceUsd);
            }
          } catch { /* Keep any known SOL price; the selected price stays unknown. */ }
        }
        if (current()) setPrices({ epoch: mintEpoch, data });
      } catch { /* Missing prices remain unknown; never substitute OTC prices. */ }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [mint, mintEpoch, tokenInfo]);

  const loadBalance = async (life) => {
    if (busyRef.current || !wallet || !tokenInfo || !isBalanceCurrent(life)) return;
    const request = ++balanceRequest.current;
    const [bal, sol] = await Promise.allSettled([fetchTokenBalance(wallet, tokenInfo), fetchSolBalanceRaw(wallet)]);
    if (busyRef.current || !isBalanceCurrent(life) || balanceRequest.current !== request) return;
    setBalances({
      mintEpoch,
      walletEpoch,
      token: bal.status === "fulfilled" ? bal.value : null,
      sol: sol.status === "fulfilled" ? sol.value : null,
      tokenError: bal.status === "rejected" ? bal.reason.message : null,
      solError: sol.status === "rejected" ? sol.reason.message : null,
    });
  };

  useEffect(() => {
    if (!busy) loadBalance(lifetime.current);
    return () => { balanceRequest.current++; };
    // Form edits reuse both in-flight reads and settled balances/errors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mintEpoch, walletEpoch, tokenInfo, busy]);

  const isBuy = mode === "BUY";
  const inputMint = isBuy ? SOL_MINT : mint;
  const outputMint = isBuy ? mint : SOL_MINT;
  const outputDecimals = isBuy ? tokenInfo?.decimals : 9;
  let raw = null, effectiveSlippage = slippageBps, inputError = null;
  try {
    if (!formReady) throw new Error("Resetting swap form…");
    if (customSlip !== "") effectiveSlippage = parseSlippageBps(customSlip);
    if (!tokenInfo) throw new Error(metadataError || "Verifying mint decimals…");
    if (mint === SOL_MINT) throw new Error("Choose a token other than SOL for a SOL pair");
    raw = parseAmountToRaw(amount, isBuy ? 9 : tokenInfo.decimals);
    if (raw === 0n) throw new Error("Enter an amount greater than zero");
  } catch (error) { inputError = error.message; }
  const validPrice = (value) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
  const solUsd = validPrice(prices?.[SOL_MINT]);
  const tokenUsd = validPrice(prices?.[mint]);
  const inputPrice = isBuy ? solUsd : tokenUsd;
  const outputPrice = isBuy ? tokenUsd : solUsd;
  const amountUsd = !inputError && inputPrice != null ? Number(amount) * inputPrice : null;
  const outUsd = quote && outputPrice != null ? Number(formatRawAmount(quote.outAmount, outputDecimals)) * outputPrice : null;
  const balUsd = tokenBal != null && tokenUsd != null ? Number(formatRawAmount(tokenBal, tokenInfo.decimals)) * tokenUsd : null;
  const mcap = isOtc ? latest?.token_market_cap : token?.mcap;
  const ch1h = isOtc ? latest?.token_price_change_1h : null;
  const ch24h = isOtc ? latest?.token_price_change_24h : token?.change24h;
  const liq = isOtc ? latest?.token_liquidity_usd : token?.liquidity;
  const vol = isOtc ? latest?.token_volume_24h : token?.vol24;
  const metricsAt = snapshotTime(token?.metricsAt);

  // Event-time invalidation closes the window before React's next render.
  const invalidate = () => {
    context.current.generation++;
    quoteRequest.current++;
    setQuote(null);
    setQuoting(null);
    setErr(null);
  };
  const changeAmount = (value) => {
    if (busyRef.current) return;
    invalidate();
    setAmount(value);
  };
  const switchMode = (m) => {
    if (busyRef.current) return;
    invalidate();
    setMode(m);
    setAmount(m === "BUY" ? "0.1" : tokenBal != null ? formatRawAmount(tokenBal, tokenInfo.decimals) : "");
  };

  const fetchQuote = async () => {
    const life = lifetime.current;
    if (!formReady || !isCurrent(life) || busyRef.current) return;
    const request = ++quoteRequest.current;
    if (inputError) { setErr(inputError); setQuote(null); return; }
    const current = () => isCurrent(life) && request === quoteRequest.current && !busyRef.current;
    setErr(null);
    setQuoting(generation);
    setQuote(null);
    try {
      const q = await getQuote(inputMint, outputMint, raw.toString(), effectiveSlippage);
      if (current()) setQuote({ generation, data: q });
    } catch (e) {
      if (current()) setErr(e.message);
    } finally {
      if (current()) setQuoting(null);
    }
  };

  // Quotes are public: verification/quotes work before connecting a wallet.
  useEffect(() => {
    if (busy || inputError) return;
    const t = setTimeout(fetchQuote, 500);
    return () => { clearTimeout(t); quoteRequest.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation, tokenInfo, busy, formReady]);

  const doSwap = async () => {
    const life = lifetime.current;
    if (!formReady || busyRef.current || !isCurrent(life)) return;
    setErr(null);
    if (!wallet) { setErr("Connect a wallet first"); return; }
    if (inputError) { setErr(inputError); return; }
    if (!getSignerForAddress(wallet)) { setErr("Connect this wallet (above) to sign"); return; }
    const inputBalance = isBuy ? solBal : tokenBal;
    if (inputBalance == null) { setErr("A verified input balance is required; wait or retry the balance read"); return; }
    if (raw > inputBalance) { setErr(`${isBuy ? "SOL" : tokenLabel} balance too low`); return; }
    // Lock synchronously before notifying Home or doing any async work.
    busyRef.current = true;
    activeSwapDetail.current = isBuy ? `SOL → ${tokenLabel}` : `${tokenLabel} → SOL`;
    quoteRequest.current++;
    balanceRequest.current++;
    setQuoting(null);
    setBusy(true);
    setLogs([]);
    setTxPhase("quote");
    const walletEpoch = context.current.walletEpoch;
    const walletCurrent = () => context.current.walletEpoch === walletEpoch && context.current.wallet === wallet && !!getSignerForAddress(wallet);
    const shouldContinue = () => isCurrent(life) && walletCurrent();
    const checkContext = () => { if (!shouldContinue()) throw new Error("Swap context changed; nothing signed"); };
    const log = (entry) => { if (isCurrent(life)) setLogs((prev) => [...prev, { ...entry, generation, t: Date.now() }]); };
    const phase = (value) => { if (isCurrent(life)) setTxPhase(value); };
    const notifyBusy = onBusyChange;
    try {
      notifyBusy?.(true);
      checkContext();
      log({ type: "info", msg: `Quoting ${amount} ${isBuy ? "SOL" : tokenLabel} -> ${isBuy ? tokenLabel : "SOL"}...` });
      const q = await getQuote(inputMint, outputMint, raw.toString(), effectiveSlippage);
      checkContext();
      setQuote({ generation, data: q });
      log({ type: "info", msg: `Building swap tx for ${wallet.slice(0, 6)}...${wallet.slice(-4)}...` });
      phase("build");
      const built = await getSwapTx(q, wallet);
      checkContext();
      const sign = (tx) => {
        checkContext();
        // walletSigner resolves a global wallet; re-resolve at the final boundary.
        return getSignerForAddress(wallet).signTransactionRaw(tx);
      };
      const res = await executeSwap(built.swapTransaction, sign, log, wallet, phase, shouldContinue, walletCurrent);
      if (res.ok) {
        log({ type: "ok", msg: "SWAP COMPLETE" });
        if (isCurrent(life)) later(() => loadBalance(life), 3000);
      } else if (isCurrent(life)) setErr(`Swap stopped: ${res.reason || "not sent"}`);
    } catch (e) {
      log({ type: "err", msg: `SWAP_ABORT: ${e.message}` });
      if (isCurrent(life)) setErr(e.message);
    } finally {
      busyRef.current = false;
      if (mounted.current) { setBusy(false); setTxPhase(null); }
      notifyBusy?.(false);
    }
  };

  const copyCa = async () => {
    const life = lifetime.current;
    try {
      await navigator.clipboard.writeText(mint);
      if (!isCurrent(life)) return;
      setCopied(generation);
      later(() => { if (isCurrent(life)) setCopied(null); }, 1400);
    } catch { /* ignore */ }
  };

  return (
    <div className="flex flex-col border border-green-500/30 bg-black p-3">
      <div className="order-1 flex flex-wrap items-center justify-between gap-2 sm:order-none">
        <span className="text-[12px] uppercase tracking-widest text-green-500/70">
          SWAP :: {isBuy ? `SOL → ${tokenLabel}` : `${tokenLabel} → SOL`}
        </span>
        <a
          href={`https://dexscreener.com/solana/${encodeURIComponent(mint)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 border border-cyan-400/40 bg-cyan-400/5 px-2 py-1 font-mono text-[12px] text-cyan-300 hover:border-cyan-300/60"
          title={`${tokenLabel} chart and available pair data on DexScreener`}
        >
          [DEXSCREENER ↗]
        </a>
        <a
          href="https://jup.ag"
          target="_blank"
          rel="noreferrer"
          className="hidden items-center gap-1 border border-amber-400/40 bg-amber-400/5 px-2 py-1 font-mono text-[12px] text-amber-300 hover:border-amber-300/60 sm:inline-flex"
          title="Routing & liquidity by the Jupiter aggregator"
        >
          <Zap className="h-3 w-3" />
          POWERED BY JUPITER
        </a>
        <button
          onClick={copyCa}
          className="inline-flex items-center gap-1 border border-green-500/40 px-2 py-1 font-mono text-[12px] text-green-300 hover:bg-green-500/10"
          title={`Copy ${tokenLabel} contract address`}
        >
          {copied === generation ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          {copied === generation ? "COPIED" : "COPY CA"}
        </button>
        {!isOtc && onResetToken && (
          <button disabled={busy} onClick={() => { if (!busyRef.current) { invalidate(); onResetToken(); } }}
            className="border border-green-500/40 px-2 py-1 font-mono text-[12px] text-green-300 disabled:opacity-30">
            [RESET TO $OTC]
          </button>
        )}
      </div>

      <div
        className="order-2 mt-2 truncate border border-green-500/20 bg-black px-2 py-1 font-mono text-[12px] text-emerald-400 sm:order-none"
        title={mint}
      >
        {tokenLabel}{token?.name ? ` · ${token.name}` : ""} :: <a href={`https://solscan.io/token/${encodeURIComponent(mint)}`} target="_blank" rel="noreferrer" className="text-green-300 underline"><span className="sm:hidden">{mint.slice(0, 4)}…{mint.slice(-4)}</span><span className="hidden sm:inline">{mint}</span></a>
      </div>
      {!isOtc && (
        <div className="order-3 mt-1 font-mono text-[11px] text-green-500/60 sm:order-none">
          SELECTED-TOKEN SNAPSHOT :: {metricsAt ? `AS OF ${metricsAt} · NOT LIVE / MAY BE STALE` : "FRESHNESS UNKNOWN"}
        </div>
      )}

      {/* Market stats: mcap + 1h/24h change + liquidity + volume */}
      <div className={`order-12 mt-2 grid grid-cols-2 gap-1 sm:order-none ${isOtc ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
        <div className="border border-green-500/20 px-1.5 py-0.5 font-mono text-[11px]">
          <div className="text-[10px] uppercase tracking-widest text-green-500/50">MKT_CAP</div>
          <div className="text-emerald-300">
            {mcap != null ? `$${fmtCompact(mcap)}` : "—"}
          </div>
        </div>
        {isOtc && <div className="border border-green-500/20 px-1.5 py-0.5 font-mono text-[11px]">
          <div className="text-[10px] uppercase tracking-widest text-green-500/50">1H</div>
          <div className={ch1h == null ? "text-green-500/40" : ch1h >= 0 ? "text-emerald-400" : "text-red-400"}>
            {ch1h != null ? `${ch1h >= 0 ? "▲" : "▼"} ${fmtPct(Math.abs(ch1h))}` : "—"}
          </div>
        </div>}
        <div className="border border-green-500/20 px-1.5 py-0.5 font-mono text-[11px]">
          <div className="text-[10px] uppercase tracking-widest text-green-500/50">24H</div>
          <div className={ch24h == null ? "text-green-500/40" : ch24h >= 0 ? "text-emerald-400" : "text-red-400"}>
            {ch24h != null ? `${ch24h >= 0 ? "▲" : "▼"} ${fmtPct(Math.abs(ch24h))}` : "—"}
          </div>
        </div>
        <div className="border border-green-500/20 px-1.5 py-0.5 font-mono text-[11px]">
          <div className="text-[10px] uppercase tracking-widest text-green-500/50">LIQ</div>
          <div className="text-cyan-300">
            {liq != null ? `$${fmtCompact(liq)}` : "—"}
          </div>
        </div>
        <div className="border border-green-500/20 px-1.5 py-0.5 font-mono text-[11px]">
          <div className="text-[10px] uppercase tracking-widest text-green-500/50">VOL_24H</div>
          <div className="text-cyan-300">
            {vol != null ? `$${fmtCompact(vol)}` : "—"}
          </div>
        </div>
      </div>

      {/* Mini price candles (bootstrap from snapshot history). On mobile the
          chart rides right under the token bar (order 3.5) instead of being
          buried below the swap button at the panel bottom — the fold cut the
          panel mid-way and the chart was unreachable without a long scroll. */}
      {isOtc && <div className="order-[3.5] sm:order-none">
        <PriceCandles
          latest={latest}
          history={history}
          unit={priceUnit}
          onToggleUnit={() => setPriceUnit((u) => (u === "USD" ? "SOL" : "USD"))}
        />
      </div>}

      {/* Direction toggle */}
      <div className="order-4 mt-2 flex gap-1 sm:order-none">
        <button
          onClick={() => switchMode("BUY")}
          disabled={busy}
          className={`flex-1 border py-2 font-mono text-[12px] font-bold disabled:opacity-30 sm:py-1 ${
            isBuy
              ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
              : "border-green-500/30 text-green-500/60 hover:border-emerald-500/40"
          }`}
        >
          [BUY {tokenLabel}]
        </button>
        <button
          onClick={() => switchMode("SELL")}
          disabled={busy}
          className={`flex-1 border py-2 font-mono text-[12px] font-bold disabled:opacity-30 sm:py-1 ${
            !isBuy
              ? "border-cyan-400/60 bg-cyan-500/10 text-cyan-300"
              : "border-green-500/30 text-green-500/60 hover:border-cyan-400/40"
          }`}
        >
          [SELL {tokenLabel}]
        </button>
      </div>

      {!wallet ? (
        <div className="order-5 mt-3 sm:order-none">
          <div className="mb-2 text-center font-mono text-[12px] text-green-500/50">
            CONNECT A WALLET TO ENABLE SWAP :: ALSO UNLOCKS PORTFOLIO + BULK CLAIM
          </div>
          {/* Inline connect: no jump needed — connect right here and the swap
              panel activates immediately (same wallet state as the app's
              wallet view, so bulk claim unlocks too). */}
          <WalletConnect onConnected={onConnected} />
          <button
            onClick={() => onGoConnect?.()}
            className="mt-2 w-full border border-amber-500/50 bg-amber-500/5 px-2 py-2 text-center font-mono text-[13px] font-bold text-amber-300 hover:border-amber-400 hover:bg-amber-500/10"
            title="Open the wallet panel (portfolio + bulk claim)"
          >
            [▲ GO TO WALLET PANEL :: PORTFOLIO + BULK CLAIM]
          </button>
        </div>
      ) : null}
        <>
          {/* Native SOL and standard ATA only, displayed without rounding. */}
          {wallet && <div className="order-6 mt-2 grid grid-cols-2 gap-1 sm:order-none">
            <div className="flex items-center justify-between border border-green-500/20 px-2 py-1 font-mono text-[12px]">
              <span className="text-green-500/50">SOL_BAL</span>
              <span className="min-w-0 break-all text-emerald-300">
                {solBal == null ? (currentBalances?.solError ? "UNAVAILABLE" : "READING…") : formatRawAmount(solBal, 9)}
                {solBal != null && solUsd != null && (
                  <span className="ml-1 text-green-500/50">≈ {fmtUsd(Number(formatRawAmount(solBal, 9)) * solUsd)}</span>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between border border-green-500/20 px-2 py-1 font-mono text-[12px]">
              <span className="text-green-500/50">{tokenLabel}_ATA_BAL</span>
              <span className="min-w-0 break-all text-emerald-300">
                {tokenBal == null ? (currentBalances?.tokenError ? "UNAVAILABLE" : "READING…") : formatRawAmount(tokenBal, tokenInfo.decimals)}
                {balUsd != null && <span className="ml-1 text-green-500/50">≈ {fmtUsd(balUsd)}</span>}
              </span>
            </div>
          </div>}
          {wallet && <div className="order-[14] mt-1 break-all font-mono text-[11px] text-green-500/60 sm:order-none">
            TOKEN BALANCE: STANDARD ATA ONLY (other token accounts excluded).
            {(currentBalances?.tokenError || currentBalances?.solError) && (
              <span className="text-amber-400"> Balance read failed: {currentBalances.tokenError || currentBalances.solError}</span>
            )}
            <button disabled={busy || !tokenInfo} onClick={() => { if (!busyRef.current) loadBalance(lifetime.current); }} className="ml-2 underline disabled:opacity-30">[RETRY BALANCES]</button>
          </div>}
          <div className="order-[15] mt-1 font-mono text-[11px] text-green-500/60 sm:order-none">
            {tokenInfo ? `ON-CHAIN DECIMALS: ${tokenInfo.decimals}` : metadataError || "VERIFYING MINT…"}
            {metadataError && <button disabled={busy} onClick={() => { if (!busyRef.current) loadMetadata(); }} className="ml-2 underline disabled:opacity-30">[RETRY MINT METADATA]</button>}
          </div>

          {/* Amount input */}
          <div className="order-7 mt-2 border border-green-500/20 p-2 sm:order-none">
            <div className="flex items-center justify-between">
              <label className="font-mono text-[11px] uppercase tracking-widest text-green-500/50">
                YOU PAY ({isBuy ? "SOL" : tokenLabel})
              </label>
              {(isBuy ? solBal > SOL_FEE_RESERVE : tokenBal > 0n) && (
                <button
                  onClick={() => {
                    changeAmount(isBuy ? formatRawAmount(solBal - SOL_FEE_RESERVE, 9) : formatRawAmount(tokenBal, tokenInfo.decimals));
                  }}
                  disabled={busy}
                  className="border border-cyan-400/40 px-2.5 py-1.5 font-mono text-[11px] text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-30 sm:px-1.5 sm:py-0.5"
                >
                  [MAX]
                </button>
              )}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                aria-label="Swap amount"
                value={amount}
                onChange={(e) => changeAmount(e.target.value)}
                disabled={busy}
                className="w-full min-w-0 flex-1 border border-green-500/30 bg-black px-2 py-1.5 font-mono text-sm text-green-300 outline-none focus:border-emerald-500/60 disabled:opacity-40"
                placeholder="0.0"
              />
              <span className="shrink-0 font-mono text-[12px] text-green-500/60">
                {isBuy ? "SOL" : tokenLabel}
              </span>
            </div>
            <div className="mt-1 text-right font-mono text-[12px] text-cyan-400/80">
              ≈ {amountUsd != null ? fmtUsd(amountUsd) : "—"}
            </div>
            {isBuy && <div className="font-mono text-[11px] text-green-500/50">SOL MAX leaves 0.01 SOL for fees/rent; actual requirements may be higher.</div>}
            {inputError && <div className="font-mono text-[12px] text-amber-400">{inputError}</div>}

            <div className="mt-2 flex flex-wrap items-center justify-between gap-y-1">
              <span className="font-mono text-[11px] uppercase tracking-widest text-green-500/50">
                SLIPPAGE
              </span>
              <div className="flex min-w-0 flex-wrap gap-1">
                {SLIPPAGE_OPTIONS.map((s) => (
                  <button
                    key={s.bps}
                    onClick={() => {
                      if (busyRef.current) return;
                      invalidate();
                      setSlippageBps(s.bps);
                      setCustomSlip("");
                    }}
                    disabled={busy}
                    className={`border px-2 py-1.5 font-mono text-[11px] disabled:opacity-30 sm:px-1.5 sm:py-0.5 ${
                      slippageBps === s.bps && !customSlip
                        ? "border-emerald-500/60 text-emerald-400"
                        : "border-green-500/30 text-green-500/60 hover:border-emerald-500/40"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="cust %"
                  value={customSlip}
                  onChange={(e) => {
                    if (busyRef.current) return;
                    invalidate();
                    setCustomSlip(e.target.value);
                  }}
                  disabled={busy}
                  title="Custom slippage in %"
                  className={`w-16 min-w-0 flex-1 border bg-black px-2 py-1.5 font-mono text-[11px] outline-none disabled:opacity-30 sm:px-1.5 sm:py-0.5 ${
                    customSlip
                      ? "border-cyan-400/60 text-cyan-300"
                      : "border-green-500/30 text-green-500/60 focus:border-cyan-400/60"
                  }`}
                />
              </div>
            </div>
          </div>

          {/* Quote */}
          <div className="order-8 mt-2 border border-green-500/20 p-2 sm:order-none">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-widest text-green-500/50">
                YOU RECEIVE ({isBuy ? tokenLabel : "SOL"})
              </span>
              <button
                onClick={fetchQuote}
                disabled={quoting || busy || !!inputError}
                className="border border-green-500/40 px-2.5 py-1.5 font-mono text-[11px] text-green-300 hover:bg-green-500/10 disabled:opacity-30 sm:px-2 sm:py-0.5"
              >
                {quoting ? "QUOTING..." : "[QUOTE]"}
              </button>
            </div>
            <div className="mt-1 break-all font-mono text-sm font-bold text-emerald-400">
              {quote ? formatRawAmount(quote.outAmount, outputDecimals) : "—"}{" "}
              <span className="text-[11px] font-normal text-green-500/50">
                {isBuy ? tokenLabel : "SOL"}
              </span>
            </div>
            {quote && (
              <div className="mt-0.5 font-mono text-[12px] text-cyan-400/80">
                ≈ {outUsd != null ? fmtUsd(outUsd) : "—"}
              </div>
            )}
            {quote && (
              <div className="mt-1 space-y-0.5 break-all font-mono text-[11px] text-green-500/60">
                <div>
                  MIN_RECV {formatRawAmount(quote.otherAmountThreshold, outputDecimals)}{" "}
                  {isBuy ? tokenLabel : "SOL"}
                </div>
                <div>PRICE_IMPACT {(Number(quote.priceImpactPct || 0) * 100).toFixed(3)}%</div>
                <div className="text-green-500/40">
                  ROUTE {quote.routePlan?.map((r) => r.swapInfo?.label).join(" → ") || "—"}
                </div>
              </div>
            )}
          </div>
          <div className="order-[16] mt-1 font-mono text-[11px] text-green-500/60 sm:order-none">
            Jupiter routes depend on liquidity, amount and token support. Some tokens have no route; a quote is not a guarantee of execution.
          </div>

          {/* Swap action */}
          <button
            onClick={doSwap}
            disabled={busy || !wallet || !!inputError || (isBuy ? solBal : tokenBal) == null}
            className={`order-9 mt-2 w-full border py-2.5 font-mono text-[13px] font-bold hover:bg-emerald-500/10 disabled:opacity-30 sm:order-none sm:py-1.5 ${
              isBuy
                ? "border-emerald-500/60 text-emerald-300"
                : "border-cyan-400/60 text-cyan-300"
            }`}
          >
            {busy
              ? "SWAPPING..."
              : isBuy
              ? `[SWAP SOL → ${tokenLabel}]`
              : `[SWAP ${tokenLabel} → SOL]`}
          </button>
          <div className="order-[17] sm:order-none">
            <HelpNote label="[?] SWAP SAFETY">
              Tx is simulated first; a failing sim aborts before signing (no fee spent). Signs with
              your connected wallet. Token balances above cover only the standard associated token account.
              Token-2022 extensions (including fees or transfer restrictions) can affect availability and execution.
            </HelpNote>
          </div>

          {err && (
            <div className="order-10 mt-2 border border-amber-500/40 bg-amber-500/5 px-2 py-1 font-mono text-[12px] text-amber-400 sm:order-none">
              ERR: {err}
            </div>
          )}

          {busy && (
            <TxStatusOverlay
              phase={txPhase || "prep"}
              detail={activeSwapDetail.current}
              onCancel={undefined}
            />
          )}

          {/* Log */}
          {logs.length > 0 && (
            <div className="order-11 mt-2 max-h-40 overflow-y-auto border border-green-500/20 bg-black p-2 sm:order-none">
              {logs.map((l, i) => (
                <div
                  key={i}
                  className={`break-all font-mono text-[11px] leading-snug ${
                    l.type === "ok"
                      ? "text-emerald-400"
                      : l.type === "err"
                      ? "text-red-400"
                      : l.type === "sim"
                      ? "text-cyan-400"
                      : "text-green-500/60"
                  }`}
                >
                  {l.msg}
                  {l.sig && (
                    <a
                      href={`https://solscan.io/tx/${l.sig}`}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-1 underline hover:text-emerald-300"
                    >
                      [SCAN]
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </>

      {/* Recent on-chain swaps feed (public — shown even without a wallet) */}
      {isOtc && <div className="order-[18] sm:order-none">
        <RecentSwaps latest={latest} unit={priceUnit} />
      </div>}
    </div>
  );
}