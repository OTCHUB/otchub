import { useEffect, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { Link, NavLink, useLocation } from "react-router-dom";
import {
  Check,
  Droplets,
  FlaskConical,
  Landmark,
  LayoutDashboard,
  Menu,
  PieChart,
  Rocket,
  Settings2,
  Sparkles,
  TerminalSquare,
} from "lucide-react";
import { HUB_ENABLED } from "@/lib/hubFlag";
import { useHub } from "../HubProvider";

type IconType = ComponentType<{ className?: string }>;

type SectionEntry = {
  id: string;
  label: string;
  hint: string;
  icon: IconType;
  /** Relative hub path — resolves under both /hub and /devnet. */
  to: string;
  end?: boolean;
};

/** The five hub sections, in reading order. The devnet faucet joins the list below when the
 *  connected cluster is devnet (same gate the header nav uses). */
const SECTIONS: SectionEntry[] = [
  { id: "dashboard", label: "Dashboard", hint: "rounds · wallet · flywheel", icon: LayoutDashboard, to: "", end: true },
  { id: "treasury", label: "Treasury", hint: "portfolio · payout history", icon: Landmark, to: "treasury" },
  { id: "tokenomics", label: "Tokenomics", hint: "supply · tiers · burns", icon: PieChart, to: "tokenomics" },
  { id: "mechanics", label: "Mechanics", hint: "how the protocol works", icon: Settings2, to: "mechanics" },
  { id: "deployments", label: "Deployments", hint: "program registry", icon: Rocket, to: "deployments" },
];

const GROUP_HEADER = "border-b border-green-500/10 bg-green-500/5 px-3 py-1 text-[10px] uppercase tracking-widest text-green-500/40";
const ITEM_BASE =
  "flex w-full items-center gap-2.5 border-b border-green-500/10 px-3 py-2 text-left text-[13px] text-green-400 last:border-b-0 hover:bg-green-500/10";

/**
 * Hamburger for the $HUB pages: everything it offers lives inside the hub protocol app —
 * hub sections as relative links (so they work identically under /hub and /devnet), the
 * mainnet/devnet environment switch, and a single link back to the OTC_HUB terminal.
 * Portaled to <body> and placed from the button's live rect, so glass panels with
 * overflow-hidden can never clip it (same pattern as the home CommunityMenu).
 */
export function HubNavMenu() {
  const { cluster } = useHub();
  const { pathname } = useLocation();
  const isDevnetMount = pathname.startsWith("/devnet");

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const sections =
    cluster === "devnet"
      ? [
          ...SECTIONS,
          { id: "drip", label: "Faucet", hint: "devnet starter kit", icon: Droplets, to: "drip" },
        ]
      : SECTIONS;

  const environments: { id: string; label: string; hint: string; icon: IconType; href: string; active: boolean }[] = [
    ...(HUB_ENABLED
      ? [
          {
            id: "mainnet",
            label: "Mainnet",
            hint: "live $HUB protocol",
            icon: Sparkles,
            href: "/hub",
            active: !isDevnetMount,
          },
        ]
      : []),
    {
      id: "devnet",
      label: "Devnet sandbox",
      hint: "QA cluster · always on",
      icon: FlaskConical,
      href: "/devnet",
      active: isDevnetMount,
    },
  ];

  // tap-outside closes (mobile tap-toggle path) — the portaled panel counts as inside.
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (wrapRef.current?.contains(e.target as Node) || panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  // Place the floating panel from the button's rect: anchored to the button's edge,
  // never bleeding off either side; re-anchored on resize.
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const place = () => {
      const r = btnRef.current!.getBoundingClientRect();
      const width = Math.min(288, window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
      setPos({ top: r.bottom + 4, left });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  const renderItemContent = (e: { label: string; hint: string; icon: IconType; active?: boolean }) => (
    <>
      <e.icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        {e.label}
        <span className="block text-[11px] text-green-500/50">{e.hint}</span>
      </span>
      {e.active ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-green-300" aria-label="current" />
      ) : (
        <span className="shrink-0 text-green-500/30">›</span>
      )}
    </>
  );

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!panelRef.current?.matches(":hover")) setOpen(false);
      }}
    >
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        title="$HUB navigation — sections · environments"
        className="inline-flex items-center justify-center border border-green-500/50 p-1.5 text-green-400 hover:bg-green-500/10 sm:p-2"
      >
        <Menu className="h-4 w-4" aria-hidden="true" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            aria-label="$HUB navigation"
            onMouseLeave={() => setOpen(false)}
            style={{ position: "fixed", top: pos.top, left: pos.left }}
            className="z-50 max-h-[80vh] w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto border border-green-500/50 bg-black font-mono shadow-[0_0_24px_rgba(34,197,94,0.15)] backdrop-blur-md"
          >
            <div className="border-b border-green-500/20 px-3 py-1.5 text-[11px] uppercase tracking-widest text-green-500/50">
              $HUB · Navigation
            </div>
            <div className={GROUP_HEADER}>Sections</div>
            {sections.map((e) => (
              <NavLink
                key={e.id}
                to={e.to}
                end={e.end}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `${ITEM_BASE} ${isActive ? "bg-green-500/10 text-green-200" : ""}`
                }
              >
                {renderItemContent(e)}
              </NavLink>
            ))}
            <div className={GROUP_HEADER}>Environments</div>
            {environments.map((e) => (
              <Link
                key={e.id}
                to={e.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={ITEM_BASE}
              >
                {renderItemContent(e)}
              </Link>
            ))}
            <div className={GROUP_HEADER}>App</div>
            <Link to="/" role="menuitem" onClick={() => setOpen(false)} className={ITEM_BASE}>
              {renderItemContent({ label: "OTC_HUB terminal", hint: "main dashboard", icon: TerminalSquare })}
            </Link>
          </div>,
          document.body,
        )}
    </div>
  );
}