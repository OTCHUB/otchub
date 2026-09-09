import { Github, Globe, Send, Twitter } from "lucide-react";
import React from "react";

// Brand footer: socials, website, copyright — replaces the old data-source /
// affiliation disclaimer copy (the legal disclaimer lives on the About page).
const LINKS = [
  { id: "x", label: "X", hint: "OTC community on X", href: "https://x.com/i/communities/1985888823188840712", icon: Twitter },
  { id: "telegram", label: "Telegram", hint: "OTC community on Telegram", href: "https://t.me/otcdesksofficial", icon: Send },
  { id: "github", label: "GitHub", hint: "hubconnect source", href: "https://github.com/OTCHUB/hubconnect", icon: Github },
  { id: "web", label: "Website", hint: "otchub.dev", href: "https://otchub.dev", icon: Globe },
];

export default function FooterBranding() {
  return (
    <footer className="mt-4 flex flex-col items-center gap-2 text-center">
      <div className="flex flex-wrap items-center justify-center gap-2">
        {LINKS.map((l) => (
          <a
            key={l.id}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            title={l.hint}
            aria-label={l.label}
            className="inline-flex items-center gap-1.5 border border-green-500/40 px-2 py-1 text-[12px] text-green-400/70 hover:bg-green-500/10 hover:text-green-300"
          >
            <l.icon className="h-3.5 w-3.5" aria-hidden="true" />
            {l.id === "web" ? "otchub.dev ↗" : l.label}
          </a>
        ))}
      </div>
      <div className="text-[12px] uppercase tracking-widest text-green-500/40">
        © 2026 otchub.dev
      </div>
    </footer>
  );
}