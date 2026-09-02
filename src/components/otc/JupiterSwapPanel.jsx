import React, { useEffect, useState } from "react";
import { Check, Copy, Zap } from "lucide-react";
import {
  SOL_MINT,
  OTC_MINT,
  OTC_DECIMALS,
  getQuote,
  getSwapTx,
  executeSwap,
  fetchOtcBalance,
  fetchSolBalance,
} from "@/lib/jupiterSwap";
import { getSignerForAddress } from "@/lib/walletSigner";
import { fetchTokenPricesUsd } from "@/lib/stockPrices";
import { fmtUsd, fmtCompact, fmtPct } from "@/lib/format";
import HelpNote from "@/components/otc/HelpNote";
import TxStatusOverlay from "@/components/otc/TxStatusOverlay";
import RecentSwaps from "@/components/otc/RecentSwaps";
import PriceCandles from "@/components/otc/PriceCandles";

const LAMPORTS_PER_SOL = 1e9;
const SLIPPAGE_OPTIONS = [
  { label: "0.5%", bps: 50 },
  { label: "1%", bps: 100 },
  { label: "3%", bps: 300 },
];

function fmtOtc(raw) {
  if (raw == null) return "—";
  const v = Number(raw) / Math.pow(10, OTC_DECIMALS);
  return v.toLocaleString(undefined, { maximumFractionDigits: OTC_DECIMALS });
}

function fmtLamports(raw) {
  if (raw == null) return "—";
  const v = Number(raw) / LAMPORTS_PER_SOL;
  return v.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

// Two-way $OTC trading via Jupiter: BUY = SOL -> $OTC, SELL = $OTC -> SOL.
// Same reliability model as before: every swap tx is simulated before the
// wallet is asked to sign, so a failing sim aborts with no fee spent.
export default function JupiterSwapPanel({ wallet, latest, history, onGoConnect }) {
  const [mode, setMode] = useState("BUY"); // "BUY" | "SELL"
  const [amount, setAmount] = useState("0.1");
  const [slippageBps, setSlippageBps] = useState(100);
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState([]);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState(null);
  const [otcBal, setOtcBal] = useState(null);
  const [solBal, setSolBal] = useState(null);
  const [customSlip, setCustomSlip] = useState(""); // custom slippage % (overrides presets)
  const [prices, setPrices] = useState({}); // mint -> USD spot (SOL + $OTC)
  const [priceUnit, setPriceUnit] = useState("USD"); // shared USD/SOL toggle for candles + trades feed
  const [txPhase, setTxPhase] = useState(null); // live swap phase for the status overlay

  const log = (l) => setLogs((prev) => [...prev, { ...l, t: Date.now() }]);

  // USD spot prices for SOL and $OTC so users can estimate trade size in USD.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = await fetchTokenPricesUsd([SOL_MINT, OTC_MINT]);
      if (!cancelled) setPrices(p);
    })();
    return () => {
      cancelled = true;
    };
  }, [OTC_MINT]);

  const loadBalance = async (w) => {
    const [bal, sol] = await Promise.all([fetchOtcBalance(w), fetchSolBalance(w)]);
    setOtcBal(bal);
    setSolBal(sol);
    return bal;
  };

  useEffect(() => {
    if (wallet) loadBalance(wallet);
    else {
      setOtcBal(null);
      setSolBal(null);
    }
  }, [wallet]);

  const isBuy = mode === "BUY";
  const solUsd = prices?.[SOL_MINT] ?? null;
  const otcUsd = prices?.[OTC_MINT] ?? null;
  // USD value of the entered amount, the quoted output, and the balance
  // (null = spot price not loaded yet).
  const amountUsd = (() => {
    const v = parseFloat(amount);
    if (!v || v <= 0) return null;
    const px = isBuy ? solUsd : otcUsd;
    return px != null ? v * px : null;
  })();
  const outUsd = (() => {
    if (!quote) return null;
    const px = isBuy ? otcUsd : solUsd;
    if (px == null) return null;
    return isBuy
      ? (Number(quote.outAmount) / 10 ** OTC_DECIMALS) * px
      : (Number(quote.outAmount) / LAMPORTS_PER_SOL) * px;
  })();
  const balUsd = otcBal != null && otcUsd != null ? otcBal * otcUsd : null;

  // Market stats strip — all from DexScreener's live pair data: market cap,
  // 1h / 24h price change, liquidity, and 24h volume.
  const mcap = latest?.token_market_cap ?? null;
  const ch1h = latest?.token_price_change_1h ?? null;
  const ch24h = latest?.token_price_change_24h ?? null;
  const liq = latest?.token_liquidity_usd ?? null;
  const vol = latest?.token_volume_24h ?? null;

  // Raw integer amount for the quote (lamports for BUY, base units for SELL).
  const rawAmount = () => {
    const v = parseFloat(amount);
    if (!v || v <= 0) return null;
    return isBuy
      ? Math.round(v * LAMPORTS_PER_SOL)
      : Math.round(v * Math.pow(10, OTC_DECIMALS));
  };

  const switchMode = (m) => {
    setMode(m);
    setQuote(null);
    setErr(null);
    setAmount(m === "BUY" ? "0.1" : otcBal ? String(Math.floor(otcBal * 1000) / 1000) : "");
  };

  const fetchQuote = async () => {
    const raw = rawAmount();
    if (!raw) {
      setErr(isBuy ? "Enter a SOL amount" : "Enter an $OTC amount");
      setQuote(null);
      return;
    }
    setErr(null);
    setQuoting(true);
    setQuote(null);
    try {
      const [inputMint, outputMint] = isBuy
        ? [SOL_MINT, OTC_MINT]
        : [OTC_MINT, SOL_MINT];
      const q = await getQuote(inputMint, outputMint, raw, slippageBps);
      setQuote(q);
    } catch (e) {
      setErr(e.message);
    } finally {
      setQuoting(false);
    }
  };

  // Auto-quote: debounce 500ms after the amount/mode/slippage changes so the
  // trade size updates live without pressing [QUOTE] (manual button kept).
  useEffect(() => {
    if (!wallet || busy) return;
    const raw = rawAmount();
    if (!raw) return;
    const t = setTimeout(() => {
      fetchQuote();
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, mode, slippageBps, wallet]);

  const doSwap = async () => {
    setErr(null);
    if (!wallet) {
      setErr("Connect a wallet first");
      return;
    }
    const signer = getSignerForAddress(wallet);
    if (!signer) {
      setErr("Connect this wallet (above) to sign");
      return;
    }
    const raw = rawAmount();
    if (!raw) {
      setErr(isBuy ? "Enter a SOL amount" : "Enter an $OTC amount");
      return;
    }
    if (!isBuy && otcBal != null && parseFloat(amount) > otcBal) {
      setErr(`$OTC balance too low (${otcBal.toLocaleString()})`);
      return;
    }
    setBusy(true);
    setLogs([]);
    setTxPhase("quote");
    try {
      const [inputMint, outputMint] = isBuy
        ? [SOL_MINT, OTC_MINT]
        : [OTC_MINT, SOL_MINT];
      const payLabel = isBuy ? `${amount} SOL` : `${amount} $OTC`;
      const recvLabel = isBuy ? "$OTC" : "SOL";
      log({ type: "info", msg: `Quoting ${payLabel} -> ${recvLabel}...` });
      const q = await getQuote(inputMint, outputMint, raw, slippageBps);
      setQuote(q);
      log({ type: "info", msg: `Building swap tx for ${wallet.slice(0, 6)}...${wallet.slice(-4)}...` });
      setTxPhase("build");
      const built = await getSwapTx(q, wallet);
      const res = await executeSwap(built.swapTransaction, signer.signTransactionRaw, log, wallet, setTxPhase);
      if (res.ok) {
        log({ type: "ok", msg: "SWAP COMPLETE" });
        // refresh the on-chain $OTC balance once the swap confirms
        setTimeout(() => wallet && loadBalance(wallet), 3000);
      }
    } catch (e) {
      log({ type: "err", msg: `SWAP_ABORT: ${e.message}` });
      setErr(e.message);
    } finally {
      setBusy(false);
      setTxPhase(null);
    }
  };

  const copyCa = async () => {
    try {
      await navigator.clipboard.writeText(OTC_MINT);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch (e) {
      /* ignore */
    }
  };

  return (
    <div className="border border-green-500/30 bg-black p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-widest text-green-500/70">
          SWAP :: {isBuy ? "SOL → $OTC" : "$OTC → SOL"}
        </span>
        <a
          href="https://dexscreener.com/solana/da4pm4xsdy4m9v4cgakkbvh1pw1ysctqqa5nekghukpt"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 border border-cyan-400/40 bg-cyan-400/5 px-2 py-1 font-mono text-[10px] text-cyan-300 hover:border-cyan-300/60"
          title="Live $OTC price chart & pair data on DexScreener"
        >
          [DEXSCREENER ↗]
        </a>
        <a
          href="https://jup.ag"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 border border-amber-400/40 bg-amber-400/5 px-2 py-1 font-mono text-[10px] text-amber-300 hover:border-amber-300/60"
          title="Routing & liquidity by the Jupiter aggregator"
        >
          <Zap className="h-3 w-3" />
          POWERED BY JUPITER
        </a>
        <button
          onClick={copyCa}
          className="inline-flex items-center gap-1 border border-green-500/40 px-2 py-1 font-mono text-[10px] text-green-300 hover:bg-green-500/10"
          title="Copy OTC contract address"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          {copied ? "COPIED" : "COPY CA"}
        </button>
      </div>

      <div className="mt-2 break-all border border-green-500/20 bg-black px-2 py-1.5 font-mono text-[11px] text-emerald-400">
        $OTC :: <span className="text-green-300">{OTC_MINT}</span>
      </div>

      {/* Market stats: mcap + 1h/24h change + liquidity + volume */}
      <div className="mt-2 grid grid-cols-3 gap-1 sm:grid-cols-5">
        <div className="border border-green-500/20 px-2 py-1 font-mono text-[10px]">
          <div className="text-[8px] uppercase tracking-widest text-green-500/50">MKT_CAP</div>
          <div className="text-emerald-300">
            {mcap != null ? `$${fmtCompact(mcap)}` : "—"}
          </div>
        </div>
        <div className="border border-green-500/20 px-2 py-1 font-mono text-[10px]">
          <div className="text-[8px] uppercase tracking-widest text-green-500/50">1H</div>
          <div className={ch1h == null ? "text-green-500/40" : ch1h >= 0 ? "text-emerald-400" : "text-red-400"}>
            {ch1h != null ? `${ch1h >= 0 ? "▲" : "▼"} ${fmtPct(Math.abs(ch1h))}` : "—"}
          </div>
        </div>
        <div className="border border-green-500/20 px-2 py-1 font-mono text-[10px]">
          <div className="text-[8px] uppercase tracking-widest text-green-500/50">24H</div>
          <div className={ch24h == null ? "text-green-500/40" : ch24h >= 0 ? "text-emerald-400" : "text-red-400"}>
            {ch24h != null ? `${ch24h >= 0 ? "▲" : "▼"} ${fmtPct(Math.abs(ch24h))}` : "—"}
          </div>
        </div>
        <div className="border border-green-500/20 px-2 py-1 font-mono text-[10px]">
          <div className="text-[8px] uppercase tracking-widest text-green-500/50">LIQ</div>
          <div className="text-cyan-300">
            {liq != null ? `$${fmtCompact(liq)}` : "—"}
          </div>
        </div>
        <div className="border border-green-500/20 px-2 py-1 font-mono text-[10px]">
          <div className="text-[8px] uppercase tracking-widest text-green-500/50">VOL_24H</div>
          <div className="text-cyan-300">
            {vol != null ? `$${fmtCompact(vol)}` : "—"}
          </div>
        </div>
      </div>

      {/* Mini price candles (bootstrap from snapshot history) */}
      <PriceCandles
        latest={latest}
        history={history}
        unit={priceUnit}
        onToggleUnit={() => setPriceUnit((u) => (u === "USD" ? "SOL" : "USD"))}
      />

      {/* Direction toggle */}
      <div className="mt-2 flex gap-1">
        <button
          onClick={() => switchMode("BUY")}
          disabled={busy}
          className={`flex-1 border py-1 font-mono text-[10px] font-bold disabled:opacity-30 ${
            isBuy
              ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
              : "border-green-500/30 text-green-500/60 hover:border-emerald-500/40"
          }`}
        >
          [BUY $OTC]
        </button>
        <button
          onClick={() => switchMode("SELL")}
          disabled={busy}
          className={`flex-1 border py-1 font-mono text-[10px] font-bold disabled:opacity-30 ${
            !isBuy
              ? "border-cyan-400/60 bg-cyan-500/10 text-cyan-300"
              : "border-green-500/30 text-green-500/60 hover:border-cyan-400/40"
          }`}
        >
          [SELL $OTC]
        </button>
      </div>

      {!wallet ? (
        <button
          onClick={() => onGoConnect?.()}
          className="mt-3 w-full border border-amber-500/50 bg-amber-500/5 px-2 py-2 text-center font-mono text-[11px] font-bold text-amber-300 hover:border-amber-400 hover:bg-amber-500/10"
          title="Open the wallet connect panel"
        >
          [▲ CONNECT WALLET — GO TO WALLET PANEL]
        </button>
      ) : (
        <>
          {/* Balance rows: native SOL + $OTC, both with live USD equivalents */}
          <div className="mt-2 grid grid-cols-2 gap-1">
            <div className="flex items-center justify-between border border-green-500/20 px-2 py-1 font-mono text-[10px]">
              <span className="text-green-500/50">SOL_BAL</span>
              <span className="text-emerald-300">
                {solBal == null ? "READING…" : solBal.toFixed(4)}
                {solBal != null && solUsd != null && (
                  <span className="ml-1 text-green-500/50">≈ {fmtUsd(solBal * solUsd)}</span>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between border border-green-500/20 px-2 py-1 font-mono text-[10px]">
              <span className="text-green-500/50">$OTC_BAL</span>
              <span className="text-emerald-300">
                {otcBal == null ? "READING…" : otcBal.toLocaleString(undefined, { maximumFractionDigits: OTC_DECIMALS })}
                {balUsd != null && <span className="ml-1 text-green-500/50">≈ {fmtUsd(balUsd)}</span>}
              </span>
            </div>
          </div>

          {/* Amount input */}
          <div className="mt-2 border border-green-500/20 p-2">
            <div className="flex items-center justify-between">
              <label className="font-mono text-[9px] uppercase tracking-widest text-green-500/50">
                YOU PAY ({isBuy ? "SOL" : "$OTC"})
              </label>
              {!isBuy && otcBal > 0 && (
                <button
                  onClick={() => {
                    setAmount(String(otcBal));
                    setQuote(null);
                  }}
                  disabled={busy}
                  className="border border-cyan-400/40 px-1.5 py-0.5 font-mono text-[9px] text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-30"
                >
                  [MAX]
                </button>
              )}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min="0"
                step={isBuy ? "0.01" : "1"}
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setQuote(null);
                }}
                disabled={busy}
                className="w-full border border-green-500/30 bg-black px-2 py-1.5 font-mono text-sm text-green-300 outline-none focus:border-emerald-500/60 disabled:opacity-40"
                placeholder="0.0"
              />
              <span className="font-mono text-[10px] text-green-500/60">
                {isBuy ? "SOL" : "$OTC"}
              </span>
            </div>
            <div className="mt-1 text-right font-mono text-[10px] text-cyan-400/80">
              ≈ {amountUsd != null ? fmtUsd(amountUsd) : "—"}
            </div>

            <div className="mt-2 flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-widest text-green-500/50">
                SLIPPAGE
              </span>
              <div className="flex gap-1">
                {SLIPPAGE_OPTIONS.map((s) => (
                  <button
                    key={s.bps}
                    onClick={() => {
                      setSlippageBps(s.bps);
                      setCustomSlip("");
                      setQuote(null);
                    }}
                    disabled={busy}
                    className={`border px-1.5 py-0.5 font-mono text-[9px] disabled:opacity-30 ${
                      slippageBps === s.bps && !customSlip
                        ? "border-emerald-500/60 text-emerald-400"
                        : "border-green-500/30 text-green-500/60 hover:border-emerald-500/40"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  placeholder="cust %"
                  value={customSlip}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCustomSlip(v);
                    const pct = parseFloat(v);
                    if (pct > 0) setSlippageBps(Math.round(pct * 100));
                    setQuote(null);
                  }}
                  disabled={busy}
                  title="Custom slippage in %"
                  className={`w-16 border bg-black px-1.5 py-0.5 font-mono text-[9px] outline-none disabled:opacity-30 ${
                    customSlip
                      ? "border-cyan-400/60 text-cyan-300"
                      : "border-green-500/30 text-green-500/60 focus:border-cyan-400/60"
                  }`}
                />
              </div>
            </div>
          </div>

          {/* Quote */}
          <div className="mt-2 border border-green-500/20 p-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-widest text-green-500/50">
                YOU RECEIVE ({isBuy ? "$OTC" : "SOL"})
              </span>
              <button
                onClick={fetchQuote}
                disabled={quoting || busy}
                className="border border-green-500/40 px-2 py-0.5 font-mono text-[9px] text-green-300 hover:bg-green-500/10 disabled:opacity-30"
              >
                {quoting ? "QUOTING..." : "[QUOTE]"}
              </button>
            </div>
            <div className="mt-1 font-mono text-sm font-bold text-emerald-400">
              {quote
                ? isBuy
                  ? fmtOtc(quote.outAmount)
                  : fmtLamports(quote.outAmount)
                : "—"}{" "}
              <span className="text-[9px] font-normal text-green-500/50">
                {isBuy ? "$OTC" : "SOL"}
              </span>
            </div>
            {quote && (
              <div className="mt-0.5 font-mono text-[10px] text-cyan-400/80">
                ≈ {outUsd != null ? fmtUsd(outUsd) : "—"}
              </div>
            )}
            {quote && (
              <div className="mt-1 space-y-0.5 font-mono text-[9px] text-green-500/60">
                <div>
                  MIN_RECV {isBuy ? fmtOtc(quote.otherAmountThreshold) : fmtLamports(quote.otherAmountThreshold)}{" "}
                  {isBuy ? "$OTC" : "SOL"}
                </div>
                <div>PRICE_IMPACT {(Number(quote.priceImpactPct || 0) * 100).toFixed(3)}%</div>
                <div className="text-green-500/40">
                  ROUTE {quote.routePlan?.map((r) => r.swapInfo?.label).join(" → ") || "—"}
                </div>
              </div>
            )}
          </div>

          {/* Swap action */}
          <button
            onClick={doSwap}
            disabled={busy || !wallet}
            className={`mt-3 w-full border py-2 font-mono text-[11px] font-bold hover:bg-emerald-500/10 disabled:opacity-30 ${
              isBuy
                ? "border-emerald-500/60 text-emerald-300"
                : "border-cyan-400/60 text-cyan-300"
            }`}
          >
            {busy
              ? "SWAPPING..."
              : isBuy
              ? "[SWAP SOL → $OTC]"
              : "[SWAP $OTC → SOL]"}
          </button>
          <HelpNote label="[?] SWAP SAFETY">
            Tx is simulated first; a failing sim aborts before signing (no fee spent). Signs with
            your connected wallet. Claims and buys both land in the same $OTC token account shown
            above.
          </HelpNote>

          {err && (
            <div className="mt-2 border border-amber-500/40 bg-amber-500/5 px-2 py-1 font-mono text-[10px] text-amber-400">
              ERR: {err}
            </div>
          )}

          {busy && (
            <TxStatusOverlay
              phase={txPhase || "prep"}
              detail={isBuy ? "SOL → $OTC" : "$OTC → SOL"}
            />
          )}

          {/* Log */}
          {logs.length > 0 && (
            <div className="mt-2 max-h-40 overflow-y-auto border border-green-500/20 bg-black p-2">
              {logs.map((l, i) => (
                <div
                  key={i}
                  className={`font-mono text-[9px] leading-snug ${
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
      )}

      {/* Recent on-chain swaps feed (public — shown even without a wallet) */}
      <RecentSwaps latest={latest} unit={priceUnit} />
    </div>
  );
}