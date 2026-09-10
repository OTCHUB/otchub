import { Github } from "lucide-react";
import React from "react";

// Public repo backing the deployed $HUB program — same one scripts/verify-build.sh builds
// from, so this is the "verify the source yourself" link for anyone reading the footer.
const HUB_GITHUB_URL = "https://github.com/OTCHUB/hubconnect";

// Byte-identical with the $HUB standalone shell's footer (hubconnect/web/src/Footer.tsx) — same
// copy, order, and link styling — so the $HUB page reads the same everywhere $HUB is mounted
// (otchub.dev/hub, otchub.dev/devnet). RU_FOMO is same-origin now too (otchub.dev/fomo, a
// Cloudflare Workers Route — see rufomo/wrangler.toml), so it stays in the same tab.
export default function Footer() {
  return (
    <footer className="mt-4 space-y-1 text-center text-[10px] text-green-500/30">
      <div>$HUB · COMMUNITY_TOOLING · NOT AFFILIATED WITH OTC DESKS</div>
      <div>
        DATA: SOLANA RPC (ON-CHAIN READS) · ECOSYSTEM:{" "}
        <a
          href="https://otchub.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-green-400"
        >
          otchub.dev ↗
        </a>
        {" · "}
        <a href="/fomo" className="underline hover:text-green-400">
          otchub.dev/fomo
        </a>
        {" · "}
        <a
          href={HUB_GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 underline hover:text-green-400"
        >
          <Github className="h-3 w-3" aria-hidden="true" />
          source ↗
        </a>
      </div>
      <div>© 2026 otchub.dev</div>
    </footer>
  );
}