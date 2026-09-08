import React from "react";

// Mirrors the $HUB standalone shell's footer (hubconnect/web/src/Footer.tsx) — same copy
// pattern, credits, and link styling — so the $HUB page inside otchub closes out the same way
// every other otchub eco site does.
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
        <a
          href="https://fomo.otchub.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-green-400"
        >
          fomo.otchub.dev ↗
        </a>
      </div>
    </footer>
  );
}
