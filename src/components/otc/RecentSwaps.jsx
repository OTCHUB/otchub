import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { fmtUsd } from "@/lib/format";

// Recent $OTC swaps, decoded on-chain from the last transactions on the
// OTC/SOL pair (see the getRecentOtcSwaps backend function). Polled every
// 30s; each row links to Solscan. Price falls back to the live market price
// when a swap's own SOL leg can't be decoded.
const POLL_MS = 30000;

const short = (w) => (w ? `${w.slice(0, 4)}…${w.slice(-4)}` : "—");

function ago(tsSec) {
  if (!tsSec) return "—";
  const mins = Math.max(0, Math.round((Date.now() / 1000 - tsSec) / 60));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

const fmtUsd2 = (v) =>
  v == null || !Number.isFinite(v)
    ? "—"
    : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function RecentSwaps({ latest, unit = "SOL" }) {
  const [swaps, setSwaps] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      setLoading(true);
      try {
        const res = await base44.functions.invoke("getRecentOtcSwaps", {});
        const payload = res?.data || {};
        if (!cancelled && payload.swaps) setSwaps(payload.swaps);
      } catch {
        /* keep previous feed */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const list = swaps || [];
  const livePriceSol = latest?.token_price_sol ?? null;
  const solPriceUsd = latest?.sol_price_usd ?? null;
  const otcPriceUsd = latest?.token_price_usd ?? null;

  return (
    <div className="mt-3 border border-green-500/20">
      <div className="flex items-center justify-between border-b border-green-500/20 px-2 py-1">
        <span className="text-[9px] uppercase tracking-widest text-green-500/50">
          RECENT_SWAPS :: LIVE ON-CHAIN (DEXSCREENER PAIR)
        </span>
        <span className="flex items-center gap-1.5 text-[9px] text-emerald-400/70">
          {loading && <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />}
          {list.length ? `${list.length} TX` : "LOADING…"}
        </span>
      </div>

      {/* Header row — DexScreener-style columns */}
      <div className="grid grid-cols-[46px_1fr_1fr_1.4fr] gap-x-2 border-b border-green-500/10 px-2 py-1 text-[8px] uppercase tracking-widest text-green-500/40">
        <span>SIDE</span>
        <span className="text-right">USD</span>
        <span className="text-right">PRICE ({unit})</span>
        <span className="text-right">WALLET</span>
      </div>

      <div className="max-h-56 overflow-y-auto">
        {list.length ? (
          list.map((s) => {
            const priceSol = s.price_sol ?? livePriceSol;
            // Column price follows the swap panel's shared USD/SOL unit toggle.
            const price =
              unit === "USD"
                ? priceSol != null && solPriceUsd != null
                  ? priceSol * solPriceUsd
                  : null
                : priceSol;
            const buy = s.side === "BUY";
            // Trade value in USD: prefer the decoded SOL leg × SOL spot,
            // fall back to the $OTC leg × $OTC spot.
            const usd =
              s.sol_amount != null && solPriceUsd != null
                ? s.sol_amount * solPriceUsd
                : s.otc_amount != null && otcPriceUsd != null
                ? s.otc_amount * otcPriceUsd
                : null;
            return (
              <a
                key={s.sig}
                href={`https://solscan.io/tx/${s.sig}`}
                target="_blank"
                rel="noreferrer"
                title={ago(s.time) !== "—" ? `${ago(s.time)} ago · ${s.sig}` : s.sig}
                className="grid grid-cols-[46px_1fr_1fr_1.4fr] items-center gap-x-2 border-b border-green-500/10 px-2 py-1.5 font-mono text-[9px] last:border-0 hover:bg-green-500/5"
              >
                <span
                  className={`border px-1 text-center font-bold ${
                    buy
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                      : "border-red-500/40 bg-red-500/10 text-red-400"
                  }`}
                >
                  {s.side}
                </span>
                <span className="truncate text-right text-amber-300">{fmtUsd2(usd)}</span>
                <span className="text-right text-cyan-300">
                  {price == null
                    ? "—"
                    : unit === "USD"
                    ? fmtUsd(price, 5)
                    : `${Number(price).toFixed(7)} ◎`}
                </span>
                <span className="truncate text-right text-green-500/50" title={s.wallet}>
                  {short(s.wallet)}
                </span>
              </a>
            );
          })
        ) : (
          <div className="px-2 py-3 text-center font-mono text-[9px] text-green-500/40">
            {loading ? "DECODING ON-CHAIN SWAPS…" : "NO_RECENT_SWAPS"}
          </div>
        )}
      </div>
    </div>
  );
}