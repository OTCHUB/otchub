import React, { useEffect, useRef, useState } from "react";
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
import SwapCard from "@/components/otc/SwapCard";

const DEFAULT_TOKEN = { mint: OTC_MINT, symbol: "OTC" };
const SOL_FEE_RESERVE = 10_000_000n; // 0.01 SOL, not a guarantee of the final fee/rent.

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
  const mcap = isOtc ? latest?.token_market_cap : token?.mcap;
  const ch1h = isOtc ? latest?.token_price_change_1h : null;
  const ch24h = isOtc ? latest?.token_price_change_24h : token?.change24h;
  const liq = isOtc ? latest?.token_liquidity_usd : token?.liquidity;
  const vol = isOtc ? latest?.token_volume_24h : token?.vol24;
  const metricsAt = snapshotTime(token?.metricsAt);

  // Pre-formatted labels for the mobile swap card (desktop keeps inline fmt).
  const quoteOutLabel = quote ? formatRawAmount(quote.outAmount, outputDecimals) : null;
  const minRecvLabel = quote ? formatRawAmount(quote.otherAmountThreshold, outputDecimals) : null;
  const priceImpactLabel = quote ? `${(Number(quote.priceImpactPct || 0) * 100).toFixed(3)}%` : null;
  const routeLabel = quote ? quote.routePlan?.map((r) => r.swapInfo?.label).join(" → ") || null : null;
  const solBalLabel = solBal != null ? formatRawAmount(solBal, 9) : null;
  const tokenBalLabel = tokenBal != null && tokenInfo ? formatRawAmount(tokenBal, tokenInfo.decimals) : null;
  const maxAvailable = !busy && (isBuy ? solBal > SOL_FEE_RESERVE : tokenBal > 0n);
  // Quick amount fractions (25% / 50% / MAX) of the pay-side balance; buy
  // keeps the 0.01 SOL fee/rent reserve out of the spendable amount.
  const onQuickAmount = (frac) => {
    if (busyRef.current || !tokenInfo) return;
    const avail = isBuy
      ? solBal != null && solBal > SOL_FEE_RESERVE ? solBal - SOL_FEE_RESERVE : null
      : tokenBal;
    if (avail == null || avail <= 0n) return;
    const rawAmt = frac >= 1 ? avail : (avail * BigInt(Math.round(frac * 100))) / 100n;
    changeAmount(formatRawAmount(rawAmt, isBuy ? 9 : tokenInfo.decimals));
  };

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
      // Mobile fallback (Phantom in-app browser bug): the wallet signs AND
      // sends in ONE approval. Passed to executeSwap only when the wallet
      // actually supports signAndSendTransaction, so wallets without it keep
      // the normal sign + relay-broadcast flow.
      const walletCanSignAndSend = !!getSignerForAddress(wallet)?.canSignAndSend;
      const signAndSend = walletCanSignAndSend
        ? (tx) => {
            checkContext();
            const signer = getSignerForAddress(wallet);
            if (!signer?.signAndSendRaw) throw new Error("Wallet cannot sign & send");
            return signer.signAndSendRaw(tx);
          }
        : null;
      const res = await executeSwap(built.swapTransaction, sign, log, wallet, phase, shouldContinue, walletCurrent, signAndSend);
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

  // One sleek Uniswap-style card for every screen size; SwapCard handles the
  // responsive sizing steps internally (trims to fit the phone fold).
  return (
    <SwapCard
      tokenLabel={tokenLabel}
      mint={mint}
      isOtc={isOtc}
      wallet={wallet}
      busy={busy}
      quoting={quoting}
      isBuy={isBuy}
      amount={amount}
      onChangeAmount={changeAmount}
      onFlip={() => switchMode(isBuy ? "SELL" : "BUY")}
      solBalLabel={solBalLabel}
      tokenBalLabel={tokenBalLabel}
      maxAvailable={maxAvailable}
      onQuickAmount={onQuickAmount}
      amountUsd={amountUsd}
      quoteOut={quoteOutLabel}
      quoteUsd={outUsd}
      minRecvLabel={minRecvLabel}
      priceImpactLabel={priceImpactLabel}
      routeLabel={routeLabel}
      inputError={inputError}
      err={err}
      logs={logs}
      slippageBps={slippageBps}
      customSlip={customSlip}
      onSlippagePreset={(bps) => {
        if (busyRef.current) return;
        invalidate();
        setSlippageBps(bps);
        setCustomSlip("");
      }}
      onCustomSlippage={(v) => {
        if (busyRef.current) return;
        invalidate();
        setCustomSlip(v);
      }}
      onSwap={doSwap}
      onResetToken={onResetToken}
      onGoConnect={onGoConnect}
      latest={latest}
      history={history}
      unit={priceUnit}
      onToggleUnit={() => setPriceUnit((u) => (u === "USD" ? "SOL" : "USD"))}
      stats={{ mcap, ch1h, ch24h, liq, vol }}
      metricsAt={metricsAt}
      txPhase={txPhase || "prep"}
      txDetail={busy ? activeSwapDetail.current : undefined}
      balError={currentBalances?.tokenError || currentBalances?.solError || null}
      onRetryBalances={() => { if (!busyRef.current) loadBalance(lifetime.current); }}
      metadataError={metadataError}
      onRetryMetadata={() => { if (!busyRef.current) loadMetadata(); }}
    />
  );
}