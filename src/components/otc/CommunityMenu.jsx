// CommunityMenu — "COMMUNITY" header dropdown: hover on desktop, tap-toggle
// on mobile (this header has no hamburger; the menu opens in place). Modular:
// add entries to LINKS. Terminal aesthetic matches the header links.
import { useEffect, useRef, useState } from "react";
import { MessagesSquare, Users, Send } from "lucide-react";

const LINKS = [
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
];

export default function CommunityMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // tap-outside closes (mobile tap-toggle path)
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        title="OTC community links + RU_FOMO console"
        className="inline-flex items-center gap-1 whitespace-nowrap border border-green-500/50 px-2 py-1 text-[10px] text-green-400 hover:bg-green-500/10 sm:px-2.5 sm:py-1.5 sm:text-[11px]"
      >
        [COMMUNITY {open ? "▴" : "▾"}]
      </button>
      {open && (
        /* anchor left on wrapped/mobile rows (opens toward free space),
           right on >=sm — never bleeds off either edge; width caps at viewport */
        <div className="absolute left-0 top-full z-50 mt-1 w-72 max-w-[calc(100vw-1.5rem)] border border-green-500/50 bg-[#0a0a0a] font-mono shadow-[0_0_24px_rgba(34,197,94,0.15)] sm:left-auto sm:right-0">
          <div className="border-b border-green-500/20 px-3 py-1.5 text-[9px] uppercase tracking-widest text-green-500/50">
            community ::
          </div>
          {LINKS.map((l) => (
            <a
              key={l.id}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 border-b border-green-500/10 px-3 py-2 text-[11px] text-green-400 last:border-b-0 hover:bg-green-500/10"
            >
              <l.icon className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">
                {l.label} ↗
                <span className="block text-[9px] text-green-500/50">{l.hint}</span>
              </span>
              {l.badge && (
                <span className="border border-green-500/60 px-1 py-px text-[9px] font-bold uppercase tracking-widest text-green-300 animate-pulse">
                  {l.badge}
                </span>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}