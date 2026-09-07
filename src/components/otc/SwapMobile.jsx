import React, { useState } from "react";
import { ArrowDown, Check, Copy, ExternalLink, Settings } from "lucide-react";
import PriceCandles from "@/components/otc/PriceCandles";
import { fmtUsd } from "@/lib/format";

// Uniswap-style simple swap card for phones: big pay/receive cards, a flip
// arrow between them, tappable slippage pills and one full-width action
// button. Everything essential fits one screen; the full terminal panel
// (stats grid, notes, help, recent swaps) stays on desktop (sm+).
// All state lives in the parent swap panel — this is presentation only.
const SLIP_PRESETS = [
  { label: "0.5%", bps: 50 },
  { label: "1%", bps: 100 },
  { label: "3%", bps: 300 },
];

export default function SwapMobile({
  tokenLabel,
  mint,
  isOtc,
  wallet,
  busy,
  quoting,
  isBuy,
  amount,
  onChangeAmount,
  onFlip,
  solBalLabel,
  tokenBalLabel,
  maxAvailable,
  onMax,
  amountUsd,
  quoteOut,
  quoteUsd,
  minRecvLabel,
  priceImpactLabel,
  routeLabel,
  inputError,
  err,
  logs,
  slippageBps,
  customSlip,
  onSlippagePreset,
  onCustomSlippage,
  onSwap,
  onResetToken,
  onConnected,
  onGoConnect,
  latest,
  history,
  unit,
  onToggleUnit,
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const payToken = isBuy ? "SOL" : tokenLabel;
  const recvToken = isBuy ? tokenLabel : "SOL";

  const copyCa = async () => {
    try {
      await navigator.clipboard.writeText(mint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* Clipboard permission may be denied. */
    }
  };

  const action = !wallet
    ? { label: "CONNECT WALLET", onClick: onGoConnect, disabled: false, tone: "border-cyan-400/60 bg-cyan-400/10 text-cyan-300" }
    : busy
    ? { label: "SWAPPING…", onClick: undefined, disabled: true, tone: "border-emerald-500/60 bg-emerald-500/10 text-emerald-300" }
    : inputError
    ? { label: inputError, onClick: undefined, disabled: true, tone: "border-green-500/30 text-green-500/50" }
    : {
        label: `SWAP ${payToken} → ${recvToken}`,
        onClick: onSwap,
        disabled: false,
        tone: "border-emerald-500/60 bg-emerald-500/10 text-emerald-300",
      };

  return (
    <div className="flex flex-col gap-3 border border-green-500/30 bg-black p-3">
      {/* Header: title + token tools */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[13px] font-bold uppercase tracking-widest text-green-400">
            SWAP
          </div>
          <button
            type="button"
            onClick={copyCa}
            className="flex items-center gap-1 font-mono text-[11px] text-green-500/50"
            title={mint}
          >
            {tokenLabel} · {mint.slice(0, 4)}…{mint.slice(-4)}
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!isOtc && onResetToken && (
            <button
              type="button"
              onClick={onResetToken}
              disabled={busy}
              className="rounded-full border border-green-500/30 px-3 py-1.5 font-mono text-[11px] text-green-500/60 disabled:opacity-30"
            >
              RESET
            </button>
          )}
          <a
            href={`https://dexscreener.com/solana/${encodeURIComponent(mint)}`}
            target="_blank"
            rel="noreferrer"
            aria-label="Open on DexScreener"
            className="rounded-full border border-green-500/30 p-2 text-green-500/60"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
          <button
            type="button"
            onClick={() => setSettingsOpen((o) => !o)}
            aria-label="Slippage settings"
            aria-expanded={settingsOpen}
            className={`rounded-full border p-2 ${
              settingsOpen ? "border-emerald-400 text-emerald-300" : "border-green-500/30 text-green-500/60"
            }`}
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Slippage settings (Uniswap-style pills) */}
      {settingsOpen && (
        <div className="rounded-2xl border border-green-500/20 p-3">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-widest text-green-500/50">
            SLIPPAGE TOLERANCE
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {SLIP_PRESETS.map((s) => (
              <button
                key={s.bps}
                type="button"
                onClick={() => onSlippagePreset(s.bps)}
                disabled={busy}
                className={`rounded-full border px-3.5 py-1.5 font-mono text-[13px] disabled:opacity-30 ${
                  slippageBps === s.bps && !customSlip
                    ? "border-emerald-400 bg-emerald-500/15 text-emerald-300"
                    : "border-green-500/30 text-green-500/60"
                }`}
              >
                {s.label}
              </button>
            ))}
            <input
              type="text"
              inputMode="decimal"
              value={customSlip}
              onChange={(e) => onCustomSlippage(e.target.value)}
              placeholder="custom %"
              aria-label="Custom slippage percent"
              className={`w-24 rounded-full border bg-black px-3 py-1.5 font-mono text-[13px] outline-none ${
                customSlip ? "border-cyan-400/60 text-cyan-300" : "border-green-500/30 text-green-500/60"
              }`}
            />
          </div>
        </div>
      )}

      {/* You pay */}
      <div className="rounded-2xl border border-green-500/20 bg-green-500/5 p-3">
        <div className="flex items-center justify-between font-mono text-[12px] text-green-500/50">
          <span>YOU PAY</span>
          <span className="flex items-center gap-1.5">
            BAL {payToken === "SOL" ? solBalLabel ?? "…" : tokenBalLabel ?? "…"}
            {maxAvailable && (
              <button
                type="button"
                onClick={onMax}
                className="rounded-full border border-cyan-400/50 px-2.5 py-0.5 font-mono text-[11px] text-cyan-300"
              >
                MAX
              </button>
            )}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            aria-label="Swap amount"
            value={amount}
            onChange={(e) => onChangeAmount(e.target.value)}
            disabled={busy}
            placeholder="0.0"
            className="min-w-0 flex-1 bg-transparent font-mono text-2xl font-semibold text-green-200 outline-none placeholder:text-green-500/25 disabled:opacity-50"
          />
          <span className="shrink-0 font-mono text-lg font-bold text-green-300">{payToken}</span>
        </div>
        <div className="mt-1 font-mono text-[12px] text-green-500/50">
          ≈ {amountUsd != null ? fmtUsd(amountUsd) : "—"}
        </div>
      </div>

      {/* Flip direction */}
      <div className="relative -my-4 z-10 flex justify-center">
        <button
          type="button"
          onClick={onFlip}
          disabled={busy}
          aria-label="Switch swap direction"
          className="rounded-xl border border-green-500/40 bg-black p-2.5 text-green-400 transition-transform active:rotate-180 disabled:opacity-40"
        >
          <ArrowDown className="h-5 w-5" />
        </button>
      </div>

      {/* You receive */}
      <div className="rounded-2xl border border-green-500/20 bg-green-500/5 p-3">
        <div className="flex items-center justify-between font-mono text-[12px] text-green-500/50">
          <span>YOU RECEIVE</span>
          <span>BAL {recvToken === "SOL" ? solBalLabel ?? "…" : tokenBalLabel ?? "…"}</span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="min-w-0 break-all font-mono text-2xl font-semibold text-green-200">
            {quoteOut ?? (quoting ? "…" : "0.0")}
          </span>
          <span className="shrink-0 font-mono text-lg font-bold text-green-300">{recvToken}</span>
        </div>
        <div className="mt-1 font-mono text-[12px] text-green-500/50">
          ≈ {quoteUsd != null ? fmtUsd(quoteUsd) : quoting ? "finding route…" : "—"}
        </div>
      </div>

      {/* Quote details */}
      {(quoteOut || inputError || err) && (
        <div className="space-y-1 rounded-2xl border border-green-500/10 bg-green-500/5 px-3 py-2 font-mono text-[12px] text-green-500/60">
          {quoteOut && (
            <div>
              MIN_RECV <span className="text-green-300">{minRecvLabel} {recvToken}</span>
            </div>
          )}
          {quoteOut && (
            <div>
              PRICE_IMPACT{" "}
              <span className={parseFloat(priceImpactLabel) > 1 ? "text-amber-400" : "text-green-300"}>
                {priceImpactLabel}%
              </span>
            </div>
          )}
          {quoteOut && routeLabel && (
            <div className="truncate">
              ROUTE <span className="text-green-300">{routeLabel}</span>
            </div>
          )}
          {(inputError || err) && <div className="text-amber-400">{inputError || err}</div>}
        </div>
      )}

      {/* Action */}
      <button
        type="button"
        onClick={action.onClick}
        disabled={action.disabled}
        className={`w-full rounded-2xl border py-4 font-mono text-[15px] font-bold tracking-wide transition-transform active:scale-[0.99] disabled:opacity-50 ${action.tone}`}
      >
        {action.label}
      </button>

      {!wallet && (
        <div className="text-center font-mono text-[12px] text-green-500/50">
          CONNECT A WALLET TO ENABLE SWAP :: ALSO UNLOCKS PORTFOLIO + BULK CLAIM
        </div>
      )}

      {/* Swap run log (only visible during/after a swap) */}
      {logs?.length > 0 && (
        <div className="max-h-32 space-y-0.5 overflow-y-auto rounded-2xl border border-green-500/20 p-2 font-mono text-[11px]">
          {logs.map((l, i) => (
            <div
              key={i}
              className={`break-all ${
                l.type === "ok" ? "text-emerald-400" : l.type === "err" ? "text-red-400" : "text-green-500/60"
              }`}
            >
              {l.msg}
              {l.sig && (
                <a href={`https://solscan.io/tx/${l.sig}`} target="_blank" rel="noreferrer" className="ml-1 underline">
                  [SCAN]
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Interactive candles below the essentials */}
      {isOtc && <PriceCandles latest={latest} history={history} unit={unit} onToggleUnit={onToggleUnit} />}
    </div>
  );
}