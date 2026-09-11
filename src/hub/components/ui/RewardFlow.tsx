import { BasketIcon, DropletIcon } from "./Icons";
import { MIM_BASKET, StockIcon } from "./StockIcon";

/**
 * Animated M.I.M payout flow — the stock reward icons stream from the HUB Pot
 * to activated desks on a seamless marquee lane (`.hub-reward-flow` in
 * src/index.css: transform-only loop, GPU compositable, paused for
 * reduced-motion users). `compact` renders just the lane (HubIntro's hero);
 * the full variant adds the pot → desks nodes and a caption (M.I.M ETF panel).
 */

function Lane({ compact = false }: { compact?: boolean }) {
  // Two copies inside the animated row → the -50% loop wraps seamlessly.
  const chips = [...MIM_BASKET, ...MIM_BASKET];
  return (
    <div
      className={`relative overflow-hidden border-y border-green-500/20 bg-green-500/5 py-1.5 [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]`}
    >
      <div className="hub-reward-flow flex w-max">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex items-center gap-3 pr-3">
            {chips.map((s, i) => (
              <span
                key={`${copy}-${i}`}
                className="inline-flex shrink-0 items-center gap-1.5 border border-green-500/25 bg-black/30 px-1.5 py-0.5"
              >
                <StockIcon symbol={s} className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
                <span className="text-[10px] font-bold uppercase tracking-widest text-green-300">
                  {s}
                </span>
                <span aria-hidden className="text-green-500/40">
                  →
                </span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function RewardFlow({
  compact = false,
  className = "",
}: {
  compact?: boolean;
  className?: string;
}) {
  if (compact) {
    return (
      <div className={className}>
        <Lane compact />
      </div>
    );
  }
  return (
    <div className={`border border-green-500/20 bg-green-500/5 p-2 ${className}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <div className="flex shrink-0 items-center gap-1.5 border border-emerald-500/40 bg-emerald-500/10 px-2 py-1">
          <DropletIcon className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">
              hub pot
            </div>
            <div className="text-[9px] text-green-700">round revenue pools here</div>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <Lane />
        </div>
        <div className="flex shrink-0 items-center gap-1.5 border border-cyan-500/40 bg-cyan-500/10 px-2 py-1">
          <BasketIcon className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest text-cyan-300">
              activated desks
            </div>
            <div className="text-[9px] text-green-700">claim pro-rata by tier</div>
          </div>
        </div>
      </div>
      <div className="mt-1.5 text-center text-[9px] uppercase tracking-widest text-green-700">
        every round · the tier-weighted basket streams from pot to desks
      </div>
    </div>
  );
}