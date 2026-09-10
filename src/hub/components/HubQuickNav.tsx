import type { ComponentType } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  BookOpen,
  Coins,
  Database,
  Flame,
  Gift,
  Home,
  Landmark,
  Layers,
  Package,
  PieChart,
  Repeat,
  Rocket,
  Search,
  Vault,
  Wallet,
} from "lucide-react";

// Page-aware quick actions for the $HUB shell — the same fixed bottom bar the
// OTC dashboard uses (QuickNavBar), but the items re-resolve per route so every
// tap maps to the CURRENT page's own content: anchors jump to that page's
// panels, cross-links hop between the hub's sub-pages. Mounted once in
// HubShell, it serves /hub and /devnet alike (mount prefix is detected from
// the URL, never hardcoded).

type IconC = ComponentType<{ className?: string }>;
type QuickAction =
  | { kind: "anchor"; id: string; label: string; icon: IconC }
  | { kind: "link"; to: string; label: string; icon: IconC };

const anchor = (id: string, label: string, icon: IconC): QuickAction => ({
  kind: "anchor",
  id,
  label,
  icon,
});
const link = (to: string, label: string, icon: IconC): QuickAction => ({
  kind: "link",
  to,
  label,
  icon,
});

function pageItems(mount: string, rel: string): QuickAction[] {
  const home = link(mount, "Dashboard", Home);
  if (rel === "/") {
    return [
      anchor("hub-wallet", "Wallet panel", Wallet),
      anchor("hub-yield", "Yield table", Coins),
      anchor("hub-desk-lookup", "Desk lookup", Search),
      link(`${mount}/treasury`, "Treasury", Landmark),
      link(`${mount}/tokenomics`, "Tokenomics", PieChart),
    ];
  }
  if (rel === "/treasury") {
    return [
      anchor("hub-vault", "$OTC yield vault", Vault),
      anchor("hub-flywheel", "Creator fee flywheel", Repeat),
      anchor("hub-supply", "$HUB supply", PieChart),
      home,
    ];
  }
  if (rel === "/tokenomics") {
    return [
      anchor("hub-tokenomics", "Allocation plan", PieChart),
      anchor("hub-airdrop", "Airdrop", Gift),
      link(`${mount}/treasury`, "Treasury", Landmark),
      home,
    ];
  }
  if (rel === "/mechanics") {
    return [
      anchor("hub-mech-activate", "Activate your desk", Rocket),
      anchor("hub-mech-rewards", "Daily rewards", Coins),
      anchor("hub-mech-treasury", "Treasury-boosted yield", Landmark),
      anchor("hub-mech-burn", "Buyback, burn & liquidity", Flame),
      home,
    ];
  }
  if (rel === "/deployments") {
    return [
      anchor("hub-registry", "Program registry", Layers),
      anchor("hub-accounts", "Live program accounts", Database),
      anchor("hub-deps", "Dependencies", Package),
      home,
    ];
  }
  // desk/:asset and anything else — cross-page hops.
  return [
    link(`${mount}/treasury`, "Treasury", Landmark),
    link(`${mount}/tokenomics`, "Tokenomics", PieChart),
    link(`${mount}/mechanics`, "Mechanics", BookOpen),
    home,
  ];
}

export default function HubQuickNav() {
  const { pathname } = useLocation();
  const mount = pathname.startsWith("/devnet") ? "/devnet" : "/hub";
  const rel = (pathname.slice(mount.length) || "/").replace(/\/+$/, "") || "/";
  const items = pageItems(mount, rel);

  return (
    <nav
      className="term-bar fixed inset-x-0 bottom-0 z-40 border-t border-green-500/20 bg-black px-2 py-1.5 font-mono"
      aria-label="Hub quick navigation"
    >
      <div className="mx-auto flex max-w-3xl items-center justify-center gap-1">
        {items.map((it) => {
          const base =
            "flex min-h-[32px] flex-1 items-center justify-center px-1 text-green-500/70 hover:text-green-300 sm:flex-none sm:px-3";
          if (it.kind === "anchor") {
            return (
              <a
                key={it.id}
                href={`#${it.id}`}
                title={it.label}
                aria-label={it.label}
                className={base}
              >
                <it.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              </a>
            );
          }
          return (
            <Link key={it.to} to={it.to} title={it.label} aria-label={it.label} className={base}>
              <it.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}