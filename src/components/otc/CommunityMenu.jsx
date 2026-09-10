// CommunityMenu — the header's hamburger navigation: hover on desktop,
// tap-toggle on mobile. Protocol apps + community tool sites. Modular:
// add entries to LINKS. Terminal aesthetic matches the header links.
// The open panel is portaled to <body> and placed from the button's live
// rect — panel windows (overflow-hidden glass in the MODERN skin, stacking
// contexts anywhere) can never clip or cover it.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Eye, Globe, Menu, MessagesSquare, Send, Users, Zap } from "lucide-react";

const LINKS = [
  {
    id: "otc-app",
    label: "OTC app · otcdesks.cash",
    hint: "official protocol app",
    href: "https://otcdesks.cash",
    icon: ExternalLink,
  },
  {
    id: "ru-fomo-web",
    label: "RU_FOMO alpha terminal",
    hint: "live FOMO tape + safety gate",
    href: "https://fomo.otchub.dev",
    icon: Zap,
  },
  {
    id: "x-chat",
    label: "OTC Community (X Chat)",
    hint: "holders group chat",
    href: "https://x.com/i/chat/group_join/g2094534355506860481/nX3pHq1n00",
    icon: MessagesSquare,
  },
  {
    id: "x-group",
    label: "OTC Community (X Group)",
    hint: "official X community",
    href: "https://x.com/i/communities/1985888823188840712",
    icon: Users,
  },
  {
    id: "telegram",
    label: "OTC Community (Telegram)",
    hint: "official OTC telegram group",
    href: "https://t.me/otcdesksofficial",
    icon: Send,
  },
  {
    id: "ru-fomo",
    label: "RU_FOMO Console",
    hint: "telegram bot + mini app",
    href: "https://t.me/otchubSol_bot",
    icon: Send,
    badge: "NEW",
  },
  {
    id: "observer",
    label: "OTC Observer",
    hint: "community desk charts + holder stats",
    href: "https://otcdesks.observer/",
    icon: Eye,
  },
  {
    id: "ath-otc",
    label: "All Things OTC",
    hint: "community OTC resource site",
    href: "https://all-things-otc.replit.app/",
    icon: Globe,
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
          className="z-50 w-72 max-w-[calc(100vw-1.5rem)] border border-green-500/50 bg-black font-mono shadow-[0_0_24px_rgba(34,197,94,0.15)] backdrop-blur-md"
        >
          <div className="border-b border-green-500/20 px-3 py-1.5 text-[11px] uppercase tracking-widest text-green-500/50">
            Navigation
          </div>
          {LINKS.map((l) => (
            <a
              key={l.id}
              role="menuitem"
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 border-b border-green-500/10 px-3 py-2 text-[13px] text-green-400 last:border-b-0 hover:bg-green-500/10"
            >
              <l.icon className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">
                {l.label} ↗
                <span className="block text-[11px] text-green-500/50">{l.hint}</span>
              </span>
              {l.badge && (
                <span className="border border-green-500/60 px-1 py-px text-[11px] font-bold uppercase tracking-widest text-green-300 animate-pulse">
                  {l.badge}
                </span>
              )}
            </a>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}