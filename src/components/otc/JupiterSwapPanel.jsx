import React, { useState } from "react";
import { Check, Copy } from "lucide-react";
import {
  SOL_MINT,
  OTC_MINT,
  OTC_DECIMALS,
  getQuote,
  getSwapTx,
  executeSwap,
} from "@/lib/jupiterSwap";
import { getSignerForAddress } from "@/lib/walletSigner";

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

export default function JupiterSwapPanel({ wallet }) {
  const [amount, setAmount] = useState("0.1");
  const [slippageBps, setSlippageBps] = useState(100);
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState([]);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState(null);

  const log = (l) => setLogs((prev) => [...prev, { ...l, t: Date.now() }]);

  const fetchQuote = async () => {
    const sol = parseFloat(amount);
    if (!sol || sol <= 0) {
      setErr("Enter a SOL amount");
      setQuote(null);
      return;
    }
    setErr(null);
    setQuoting(true);
    setQuote(null);
    try {
      const lamports = Math.round(sol * LAMPORTS_PER_SOL);
      const q = await getQuote(lamports, slippageBps);
      setQuote(q);
    } catch (e) {
      setErr(e.message);
    } finally {
      setQuoting(false);
    }
  };

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
    const sol = parseFloat(amount);
    if (!sol || sol <= 0) {
      setErr("Enter a SOL amount");
      return;
    }
    setBusy(true);
    setLogs([]);
    try {
      log({ type: "info", msg: `Quoting ${sol} SOL -> $OTC...` });
      const lamports = Math.round(sol * LAMPORTS_PER_SOL);
      const q = await getQuote(lamports, slippageBps);
      setQuote(q);
      log({ type: "info", msg: `Building swap tx for ${wallet.slice(0, 6)}...${wallet.slice(-4)}...` });
      const built = await getSwapTx(q, wallet);
      const res = await executeSwap(built.swapTransaction, signer.signTransactionRaw, log, wallet);
      if (res.ok) log({ type: "ok", msg: "SWAP COMPLETE" });
    } catch (e) {
      log({ type: "err", msg: `SWAP_ABORT: ${e.message}` });
      setErr(e.message);
    } finally {
      setBusy(false);
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
          SWAP :: SOL → $OTC
        </span>
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

      {!wallet ? (
        <div className="mt-3 border border-amber-500/30 bg-amber-500/5 px-2 py-2 text-center font-mono text-[11px] text-amber-400/80">
          CONNECT WALLET ABOVE TO SWAP
        </div>
      ) : (
        <>
          {/* Amount input */}
          <div className="mt-3 border border-green-500/20 p-2">
            <label className="font-mono text-[9px] uppercase tracking-widest text-green-500/50">
              YOU PAY (SOL)
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setQuote(null);
                }}
                disabled={busy}
                className="w-full border border-green-500/30 bg-black px-2 py-1.5 font-mono text-sm text-green-300 outline-none focus:border-emerald-500/60 disabled:opacity-40"
                placeholder="0.0"
              />
              <span className="font-mono text-[10px] text-green-500/60">SOL</span>
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
                      setQuote(null);
                    }}
                    disabled={busy}
                    className={`border px-1.5 py-0.5 font-mono text-[9px] disabled:opacity-30 ${
                      slippageBps === s.bps
                        ? "border-emerald-500/60 text-emerald-400"
                        : "border-green-500/30 text-green-500/60 hover:border-emerald-500/40"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Quote */}
          <div className="mt-2 border border-green-500/20 p-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-widest text-green-500/50">
                YOU RECEIVE ($OTC)
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
              {quote ? fmtOtc(quote.outAmount) : "—"}{" "}
              <span className="text-[9px] font-normal text-green-500/50">$OTC</span>
            </div>
            {quote && (
              <div className="mt-1 space-y-0.5 font-mono text-[9px] text-green-500/60">
                <div>MIN_RECV {fmtOtc(quote.otherAmountThreshold)} $OTC</div>
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
            className="mt-3 w-full border border-emerald-500/60 py-2 font-mono text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-30"
          >
            {busy ? "SWAPPING..." : "[SWAP SOL → $OTC]"}
          </button>
          <p className="mt-1.5 text-[9px] leading-snug text-green-500/40">
            Tx is simulated first; a failing sim aborts before signing (no fee
            spent). Signs with your connected wallet.
          </p>

          {err && (
            <div className="mt-2 border border-amber-500/40 bg-amber-500/5 px-2 py-1 font-mono text-[10px] text-amber-400">
              ERR: {err}
            </div>
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
    </div>
  );
}