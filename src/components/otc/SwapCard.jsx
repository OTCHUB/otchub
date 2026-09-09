import React, { useState } from "react";
import { ArrowDown, Check, Copy, ExternalLink, Settings, Zap } from "lucide-react";
import PriceCandles from "@/components/otc/PriceCandles";
import RecentSwaps from "@/components/otc/RecentSwaps";
import TxStatusOverlay from "@/components/otc/TxStatusOverlay";
import HelpNote from "@/components/otc/HelpNote";
import { fmtUsd, fmtCompact, fmtPct } from "@/lib/format";

// Uniswap-style swap card for ALL screen sizes: stacked YOU PAY / YOU RECEIVE
// cards, flip arrow, quick amounts, slippage settings, quote details and one
// full-width action button — rendered in the terminal aesthetic (sharp
// corners, mono fonts, green-on-black). Spacing and type step up on sm+ for
// desktop sleekness; on phones the card trims down to fit the fold. All state
// lives in the parent swap panel — this is presentation only.
const SLIP_PRESETS = [
  { label: "0.5%", bps: 50 },
  { label: "1%", bps: 100 },
  { label: "3%", bps: 300 },
];
const QUICK_AMOUNTS = [
  ["25%", 0.25],
  ["50%", 0.5],
  ["MAX", 1],
];

export default function SwapCard({
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
  onQuickAmount,
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
  onGoConnect,
  latest,
  history,
  unit,
  onToggleUnit,
  stats,
  metricsAt,
  txPhase,
  txDetail,
  balError,
  onRetryBalances,
  metadataError,
  onRetryMetadata,
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
    ? { label: "[ CONNECT WALLET ]", onClick: onGoConnect, disabled: false, tone: "border-emerald-500/60 bg-emerald-500/10 text-emerald-300" }
    : busy
    ? { label: "[ SWAPPING… ]", onClick: undefined, disabled: true, tone: "border-emerald-500/60 bg-emerald-500/10 text-emerald-300" }
    : inputError
    ? { label: inputError, onClick: undefined, disabled: true, tone: "border-green-500/30 text-green-500/50" }
    : {
        label: `[ SWAP ${payToken} → ${recvToken} ]`,
        onClick: onSwap,
        disabled: false,
        tone: "border-emerald-500/60 bg-emerald-500/10 text-emerald-300",
      };

  const change = (v) =>
    v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "▲" : "▼"} ${fmtPct(Math.abs(v))}`;
  const cells = [
    ["MKT_CAP", stats?.mcap != null ? `$${fmtCompact(stats.mcap)}` : "—", null, "text-emerald-300"],
    ...(isOtc
      ? [["1H", change(stats?.ch1h), stats?.ch1h, stats?.ch1h >= 0 ? "text-emerald-400" : "text-red-400"]]
      : []),
    ["24H", change(stats?.ch24h), stats?.ch24h, stats?.ch24h >= 0 ? "text-emerald-400" : "text-red-400"],
    ["LIQ", stats?.liq != null ? `$${fmtCompact(stats.liq)}` : "—", null, "text-cyan-300"],
    ["VOL_24H", stats?.vol != null ? `$${fmtCompact(stats.vol)}` : "—", null, "text-cyan-300"],
  ];

  return (
    <div className="mx-auto min-w-0 w-full max-w-md flex-col overflow-hidden gap-2 border border-green-500/30 bg-black p-2.5 sm:mx-0 sm:max-w-none sm:gap-2.5 sm:p-4 flex">
      {/* Header: title + token tools */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[12px] font-bold uppercase tracking-widest text-green-400 sm:text-[13px]">
            SWAP :: {isBuy ? `SOL → ${tokenLabel}` : `${tokenLabel} → SOL`}
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
        <div className="flex shrink-0 items-center gap-1">
          {!isOtc && onResetToken && (
            <button
              type="button"
              onClick={onResetToken}
              disabled={busy}
              className="border border-green-500/40 px-1.5 py-1 font-mono text-[11px] text-green-500/60 hover:bg-green-500/10 disabled:opacity-30"
            >
              [RESET]
            </button>
          )}
          <a
            href={`https://dexscreener.com/solana/${encodeURIComponent(mint)}`}
            target="_blank"
            rel="noreferrer"
            aria-label="Open on DexScreener"
            className="border border-green-500/40 p-1.5 text-green-500/60 hover:bg-green-500/10"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
          <a
            href="https://jup.ag"
            target="_blank"
            rel="noreferrer"
            title="Routing & liquidity by the Jupiter aggregator"
            className="hidden items-center gap-1 border border-amber-400/40 bg-amber-400/5 px-1.5 py-1 font-mono text-[11px] text-amber-300 hover:border-amber-300/60 sm:inline-flex"
          >
            <Zap className="h-3 w-3" />
            JUPITER
          </a>
          <button
            type="button"
            onClick={() => setSettingsOpen((o) => !o)}
            aria-label="Slippage settings"
            aria-expanded={settingsOpen}
            className={`flex items-center gap-1 border px-1.5 py-1 font-mono text-[11px] ${
              settingsOpen
                ? "border-emerald-500/60 text-emerald-300"
                : "border-green-500/40 text-green-500/60 hover:bg-green-500/10"
            }`}
          >
            <Settings className="h-3.5 w-3.5" />
            SLIP {customSlip ? `${customSlip}%` : SLIP_PRESETS.find((s) => s.bps === slippageBps)?.label ?? `${slippageBps / 100}%`}
          </button>
        </div>
      </div>

      {/* Selected-token snapshot freshness (non-OTC tokens only) */}
      {!isOtc && (
        <div className="font-mono text-[10px] text-green-500/50">
          SNAPSHOT {metricsAt ? `${metricsAt} · NOT LIVE / MAY BE STALE` : "FRESHNESS UNKNOWN"}
        </div>
      )}
      {metadataError && (
        <div className="font-mono text-[10px] text-amber-400">
          MINT_ERR: {metadataError}{" "}
          <button type="button" onClick={onRetryMetadata} className="underline">
            [RETRY]
          </button>
        </div>
      )}

      {/* Market stats: one-line wrap on phones, bordered grid on sm+ */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-green-500/60 sm:hidden">
        {cells.map(([k, v, , cls]) => (
          <span key={k}>
            {k} <span className={cls}>{v}</span>
          </span>
        ))}
      </div>
      <div className={`hidden gap-1 sm:grid ${isOtc ? "grid-cols-5" : "grid-cols-4"}`}>
        {cells.map(([k, v, , cls]) => (
          <div key={k} className="border border-green-500/20 px-1.5 py-1 font-mono text-[11px]">
            <div className="text-[10px] uppercase tracking-widest text-green-500/50">{k}</div>
            <div className={cls}>{v}</div>
          </div>
        ))}
      </div>

      {/* Slippage settings */}
      {settingsOpen && (
        <div className="border border-green-500/20 p-2">
          <div className="mb-1.5 font-mono text-[11px] uppercase tracking-widest text-green-500/50">
            SLIPPAGE TOLERANCE
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {SLIP_PRESETS.map((s) => (
              <button
                key={s.bps}
                type="button"
                onClick={() => onSlippagePreset(s.bps)}
                disabled={busy}
                className={`border px-2 py-1 font-mono text-[12px] disabled:opacity-30 ${
                  slippageBps === s.bps && !customSlip
                    ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                    : "border-green-500/30 text-green-500/60 hover:border-emerald-500/40"
                }`}
              >
                [{s.label}]
              </button>
            ))}
            <input
              type="text"
              inputMode="decimal"
              value={customSlip}
              onChange={(e) => onCustomSlippage(e.target.value)}
              placeholder="cust %"
              aria-label="Custom slippage percent"
              className={`w-20 border bg-black px-2 py-1 font-mono text-[12px] outline-none ${
                customSlip ? "border-cyan-400/60 text-cyan-300" : "border-green-500/30 text-green-500/60"
              }`}
            />
          </div>
        </div>
      )}

      {/* You pay */}
      <div className="border border-green-500/20 bg-green-500/5 p-2 sm:p-3">
        <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-green-500/50">
          <span className="truncate">
            YOU PAY · BAL {payToken === "SOL" ? solBalLabel ?? "…" : tokenBalLabel ?? "…"}
            {wallet && !busy && (
              <button
                type="button"
                onClick={onRetryBalances}
                className="ml-1 text-cyan-400/80 hover:text-cyan-300"
                title="Re-read SOL + token balances from chain"
              >
                [SYNC]
              </button>
            )}
            {balError && (
              <button
                type="button"
                onClick={onRetryBalances}
                className="ml-1 text-amber-400 underline"
                title={`Balance read failed: ${balError}`}
              >
                [RETRY]
              </button>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {QUICK_AMOUNTS.map(([label, frac]) => (
              <button
                key={label}
                type="button"
                onClick={() => onQuickAmount(frac)}
                disabled={busy || !maxAvailable}
                className="border border-cyan-400/50 px-1.5 py-0.5 font-mono text-[11px] text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-30"
              >
                [{label}]
              </button>
            ))}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            aria-label="Swap amount"
            value={amount}
            onChange={(e) => onChangeAmount(e.target.value)}
            disabled={busy}
            placeholder="0.0"
            className="min-w-0 flex-1 bg-transparent font-mono text-xl font-bold text-green-200 outline-none placeholder:text-green-500/25 disabled:opacity-50 sm:text-2xl"
          />
          <span className="shrink-0 font-mono text-[15px] font-bold text-green-300 sm:text-base">{payToken}</span>
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-green-500/50">
          ≈ {amountUsd != null ? fmtUsd(amountUsd) : "—"}
        </div>
      </div>

      {/* Flip direction */}
      <div className="relative -my-3 z-10 flex justify-center">
        <button
          type="button"
          onClick={onFlip}
          disabled={busy}
          aria-label="Switch swap direction"
          className="border border-green-500/50 bg-black p-1.5 text-green-400 transition-transform active:rotate-180 disabled:opacity-40"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      </div>

      {/* You receive */}
      <div className="border border-green-500/20 bg-green-500/5 p-2 sm:p-3">
        <div className="flex items-center justify-between font-mono text-[11px] text-green-500/50">
          <span>YOU RECEIVE</span>
          <span>BAL {recvToken === "SOL" ? solBalLabel ?? "…" : tokenBalLabel ?? "…"}</span>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="min-w-0 break-all font-mono text-xl font-bold text-green-200 sm:text-2xl">
            {quoteOut ?? (quoting ? "…" : "0.0")}
          </span>
          <span className="shrink-0 font-mono text-[15px] font-bold text-green-300 sm:text-base">{recvToken}</span>
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-green-500/50">
          ≈ {quoteUsd != null ? fmtUsd(quoteUsd) : quoting ? "finding route…" : "—"}
        </div>
      </div>

      {/* Quote details */}
      {(quoteOut || inputError || err) && (
        <div className="space-y-0.5 border border-green-500/10 bg-green-500/5 px-2 py-1.5 font-mono text-[11px] text-green-500/60">
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
        className={`w-full border py-3 font-mono text-[14px] font-bold tracking-wide disabled:opacity-50 sm:py-3.5 sm:text-[15px] ${action.tone}`}
      >
        {action.label}
      </button>

      {!wallet && (
        <div className="text-center font-mono text-[11px] text-green-500/50">
          CONNECT A WALLET TO ENABLE SWAP :: ALSO UNLOCKS PORTFOLIO + BULK CLAIM
        </div>
      )}

      {/* Swap run log (only visible during/after a swap) */}
      {logs?.length > 0 && (
        <div className="max-h-28 space-y-0.5 overflow-y-auto border border-green-500/20 p-2 font-mono text-[11px]">
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

      {busy && <TxStatusOverlay phase={txPhase} detail={txDetail} />}

      {/* Interactive candles + recent swaps feed below the essentials */}
      {isOtc && <PriceCandles latest={latest} history={history} unit={unit} onToggleUnit={onToggleUnit} />}
      {isOtc && <RecentSwaps latest={latest} unit={unit} />}

      <HelpNote label="[?] SWAP SAFETY">
        Tx is simulated first; a failing sim aborts before signing (no fee spent). Signs with your connected wallet.
        Balances cover only the standard associated token account. Token-2022 extensions (including fees or transfer
        restrictions) can affect availability and execution. Jupiter routes depend on liquidity; a quote is not a
        guarantee of execution.
      </HelpNote>
    </div>
  );
}