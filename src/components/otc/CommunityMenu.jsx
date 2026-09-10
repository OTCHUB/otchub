// CommunityMenu — the header's hamburger navigation: hover on desktop,
// tap-toggle on mobile. Protocol apps + community tool sites. Modular:
// add entries to LINKS. Terminal aesthetic matches the header links.
// The open panel is portaled to <body> and placed from the button's live
// rect — panel windows (overflow-hidden glass in the MODERN skin, stacking
// contexts anywhere) can never clip or cover it.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { ExternalLink, Eye, Globe, Menu, MessagesSquare, Send, Sparkles, Users, Zap } from "lucide-react";
import { HUB_ENABLED } from "@/lib/hubFlag";

// $HUB protocol dashboard lives at otchub.dev/hub — an in-SPA route, so it
// navigates via react-router (spa: true) instead of a full page load. The
// mainnet entry stays dark in the menu until launch, same gate as the route
// itself in App.jsx (hubGated: true below). The devnet sandbox at
// otchub.dev/devnet is ungated in App.jsx for direct-URL QA, but is
// intentionally left out of this menu until its program logic is verified.
//
// Grouped into three sections, ordered so the two ecosystems stay visually
// separate as each grows independently, with social/chat kept apart from
// the tools themselves:
//   1. OTC_HUB Ecosystem  — the $HUB protocol dashboard + its own tooling
//   2. OTC Desks Ecosystem — the separate otcdesks.cash app + its community tools
//   3. Join Community      — chat/social channels (not a "tool")
const GROUPS = [
  { id: "otc-hub", label: "OTC_HUB Ecosystem" },
  { id: "otc-desks", label: "OTC Desks Ecosystem" },
  { id: "join-community", label: "Join Community" },
];

const LINKS = [
  {
    id: "hub",
    group: "otc-hub",
    label: "$HUB Protocol Dashboard",
    hint: "treasury · yield tracker · tokenomics",
    href: "/hub",
    icon: Sparkles,
    spa: true,
    hubGated: true,
  },
  {
    id: "ru-fomo-web",
    group: "otc-hub",
    label: "RU_FOMO alpha terminal",
    hint: "live FOMO tape + safety gate",
    // Same origin now (otchub.dev/fomo, Workers Route — see rufomo/wrangler.toml),
    // so the connected wallet (otc_wallet_address) carries over automatically.
    // Still a full navigation (separate Worker/bundle, not an SPA route) but
    // stays in the same tab since it never leaves the domain.
    href: "/fomo",
    icon: Zap,
    samesite: true,
  },
  {
    id: "ru-fomo",
    group: "otc-hub",
    label: "RU_FOMO Console",
    hint: "telegram bot + mini app",
    href: "https://t.me/otchubSol_bot",
    icon: Send,
    badge: "NEW",
  },
  {
    id: "otc-app",
    group: "otc-desks",
    label: "OTC app · otcdesks.cash",
    hint: "official protocol app",
    href: "https://otcdesks.cash",
    icon: ExternalLink,
  },
  {
    id: "observer",
    group: "otc-desks",
    label: "OTC Observer",
    hint: "community desk charts + holder stats",
    href: "https://otcdesks.observer/",
    icon: Eye,
  },
  {
    id: "ath-otc",
    group: "otc-desks",
    label: "All Things OTC",
    hint: "community OTC resource site",
    href: "https://all-things-otc.replit.app/",
    icon: Globe,
  },
  {
    id: "x-chat",
    group: "join-community",
    label: "OTC Community (X Chat)",
    hint: "holders group chat",
    href: "https://x.com/i/chat/group_join/g2094534355506860481/nX3pHq1n00",
    icon: MessagesSquare,
  },
  {
    id: "x-group",
    group: "join-community",
    label: "OTC Community (X Group)",
    hint: "official X community",
    href: "https://x.com/i/communities/1985888823188840712",
    icon: Users,
  },
  {
    id: "telegram",
    group: "join-community",
    label: "OTC Community (Telegram)",
    hint: "official OTC telegram group",
    href: "https://t.me/otcdesksofficial",
    icon: Send,
  },
];

export default function CommunityMenu() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const wrapRef = useRef(null);
  const btnRef = useRef(null);
  const panelRef = useRef(null);

  // tap-outside closes (mobile tap-toggle path) — the portaled panel counts
  // as inside, so navigating the menu never closes it.
  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (wrapRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  // Place the floating panel from the button's rect: anchored right on >=sm,
  // left on wrapped/mobile rows — never bleeds off either edge; width caps at
  // viewport. Re-anchored on resize.
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const place = () => {
      const r = btnRef.current.getBoundingClientRect();
      const width = Math.min(288, window.innerWidth - 16);
      const left = window.innerWidth >= 640
        ? Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8))
        : Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      setPos({ top: r.bottom + 4, left });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => { if (!panelRef.current?.matches(":hover")) setOpen(false); }}
    >
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        title="Navigation — protocol apps + community tools"
        className="inline-flex items-center justify-center border border-green-500/50 p-1.5 text-green-400 hover:bg-green-500/10 sm:p-2"
      >
        <Menu className="h-4 w-4" aria-hidden="true" />
      </button>
      {open && pos && createPortal(
        <div
          ref={panelRef}
          role="menu"
          aria-label="OTC navigation links"
          onMouseLeave={() => setOpen(false)}
          style={{ position: "fixed", top: pos.top, left: pos.left }}
          className="z-50 max-h-[80vh] w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto border border-green-500/50 bg-black font-mono shadow-[0_0_24px_rgba(34,197,94,0.15)] backdrop-blur-md"
        >
          <div className="border-b border-green-500/20 px-3 py-1.5 text-[11px] uppercase tracking-widest text-green-500/50">
            Navigation
          </div>
          {GROUPS.map((g) => {
            const items = LINKS.filter((l) => l.group === g.id && (!l.hubGated || HUB_ENABLED));
            if (items.length === 0) return null;
            return (
              <div key={g.id}>
                <div className="border-b border-green-500/10 bg-green-500/5 px-3 py-1 text-[10px] uppercase tracking-widest text-green-500/40">
                  {g.label}
                </div>
                {items.map((l) => {
                  const itemCls =
                    "flex items-center gap-2 border-b border-green-500/10 px-3 py-2 text-[13px] text-green-400 last:border-b-0 hover:bg-green-500/10";
                  const content = (
                    <>
                      <l.icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="flex-1">
                        {l.label} {!l.spa && !l.samesite && "↗"}
                        <span className="block text-[11px] text-green-500/50">{l.hint}</span>
                      </span>
                      {l.badge && (
                        <span className="border border-green-500/60 px-1 py-px text-[11px] font-bold uppercase tracking-widest text-green-300 animate-pulse">
                          {l.badge}
                        </span>
                      )}
                    </>
                  );
                  // /hub is an in-SPA route (react-router Link, no reload); /fomo is
                  // same-origin but a different app/Worker (full nav, same tab);
                  // everything else is a genuine external site (new tab).
                  if (l.spa) {
                    return (
                      <Link key={l.id} role="menuitem" to={l.href} onClick={() => setOpen(false)} className={itemCls}>
                        {content}
                      </Link>
                    );
                  }
                  return (
                    <a
                      key={l.id}
                      role="menuitem"
                      href={l.href}
                      target={l.samesite ? undefined : "_blank"}
                      rel={l.samesite ? undefined : "noopener noreferrer"}
                      onClick={() => setOpen(false)}
                      className={itemCls}
                    >
                      {content}
                    </a>
                  );
                })}
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}