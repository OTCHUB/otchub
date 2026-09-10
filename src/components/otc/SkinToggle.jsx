import React, { useState } from "react";
import { Sparkles, Terminal } from "lucide-react";
import { getStoredSkin, toggleSkin } from "@/lib/theme";

// Header skin switch: retro terminal ↔ modern "iridescent HUD". Icon-only
// (no text label); it always shows the skin it will switch TO.
export default function SkinToggle() {
  const [skin, setSkin] = useState(getStoredSkin());
  return (
    <button
      onClick={() => setSkin(toggleSkin())}
      className="inline-flex items-center justify-center whitespace-nowrap border border-green-500/50 px-2 py-1 text-green-400 hover:bg-green-500/10 sm:px-2.5 sm:py-1.5"
      title={`Switch to ${skin === "modern" ? "retro terminal skin" : "modern skin"}`}
      aria-label={`Switch to ${skin === "modern" ? "retro" : "modern"} skin`}
    >
      {skin === "modern" ? (
        <Terminal className="h-3.5 w-3.5" />
      ) : (
        <Sparkles className="h-3.5 w-3.5" />
      )}
    </button>
  );
}