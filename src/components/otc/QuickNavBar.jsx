import React from "react";
import { Rocket, Repeat, Scale, Wallet, Zap } from "lucide-react";

// Fixed bottom quick-nav: the dashboard's five primary destinations as
// one-tap anchors — wallet portfolio, OTC launcher feed, swap, arbitrage and
// the external RU_FOMO alpha terminal.
const ITEMS = [
  { id: "otc-wallet", label: "Wallet", icon: Wallet },
  { id: "otc-analytics", label: "Launches", icon: Rocket },
  { id: "otc-swap", label: "Swap", icon: Repeat },
  { id: "otc-arbitrage", label: "Arbitrage", icon: Scale },
  { href: "https://fomo.otchub.dev", label: "RU_FOMO", icon: Zap, external: true },
];

export default function QuickNavBar() {
  return (
    <nav
      className="term-bar fixed inset-x-0 bottom-0 z-40 border-t border-green-500/20 bg-black px-2 py-1.5 font-mono"
      aria-label="Dashboard quick navigation"
    >
      <div className="mx-auto flex max-w-3xl items-center justify-center gap-1">
        {ITEMS.map((it) => {
          const base =
            "flex min-h-[32px] flex-1 items-center justify-center gap-1.5 px-1 text-[10px] uppercase tracking-widest sm:flex-none sm:px-3";
          return it.external ? (
            <a
              key={it.label}
              href={it.href}
              target="_blank"
              rel="noopener noreferrer"
              title="RU_FOMO — alpha terminal"
              className={`${base} whitespace-nowrap text-amber-400 hover:text-amber-300`}
            >
              <it.icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="whitespace-nowrap">{it.label}</span>
            </a>
          ) : (
            <a key={it.id} href={`#${it.id}`} title={it.label} className={`${base} text-green-500/70 hover:text-green-300`}>
              <it.icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="whitespace-nowrap">{it.label}</span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}