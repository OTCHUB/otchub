import React from "react";
import { Rocket, Repeat, Scale, Wallet } from "lucide-react";
import RuFomoIcon from "@/components/otc/RuFomoIcon";

// Fixed bottom quick-nav: the dashboard's five primary destinations as
// one-tap anchors — wallet panel, OTC launcher feed, swap, arbitrage and
// the external RU_FOMO alpha terminal. The wallet button is wired to the
// page's wallet action so it EXPANDS the wallet card and scrolls to it,
// instead of a bare hash jump.
export default function QuickNavBar({ onWallet }) {
  const ITEMS = [
    { label: "Wallet", icon: Wallet, onClick: onWallet },
    { id: "otc-analytics", label: "Launches", icon: Rocket },
    { id: "otc-swap", label: "Swap", icon: Repeat },
    { id: "otc-arbitrage", label: "Arbitrage", icon: Scale },
    { href: "https://fomo.otchub.dev", label: "RU_FOMO", icon: RuFomoIcon, external: true },
  ];

  return (
    <nav
      className="term-bar fixed inset-x-0 bottom-0 z-40 border-t border-green-500/20 bg-black px-2 py-1.5 font-mono"
      aria-label="Dashboard quick navigation"
    >
      <div className="mx-auto flex max-w-3xl items-center justify-center gap-1">
        {ITEMS.map((it) => {
          const base =
            "flex min-h-[32px] flex-1 items-center justify-center px-1 sm:flex-none sm:px-3";
          if (it.onClick) {
            return (
              <button
                key={it.label}
                type="button"
                title="Wallet — open the wallet panel"
                aria-label="Wallet — open the wallet panel"
                onClick={it.onClick}
                className={`${base} text-green-500/70 hover:text-green-300`}
              >
                <it.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              </button>
            );
          }
          return it.external ? (
            <a
              key={it.label}
              href={it.href}
              target="_blank"
              rel="noopener noreferrer"
              title="RU_FOMO — alpha terminal"
              className={`${base} text-amber-400 hover:text-amber-300`}
            >
              <it.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            </a>
          ) : (
            <a key={it.id} href={`#${it.id}`} title={it.label} className={`${base} text-green-500/70 hover:text-green-300`}>
              <it.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            </a>
          );
        })}
      </div>
    </nav>
  );
}