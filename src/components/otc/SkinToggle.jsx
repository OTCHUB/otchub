import React, { useState } from "react";
import { Sparkles } from "lucide-react";
import { getStoredSkin, toggleSkin } from "@/lib/theme";

// Header skin switch: RETRO (DOS terminal, default) ↔ MODERN (Iridescent
// Terminal). Independent of the dark/light theme toggle — the skin swaps
// the whole palette via the html.skin-modern class (see index.css).
export default function SkinToggle() {
  const [skin, setSkin] = useState(getStoredSkin());
  return (
    <button
      onClick={() => setSkin(toggleSkin())}
      className="inline-flex items-center gap-1 border border-green-500/50 px-2 py-1 text-green-400 hover:bg-green-500/10 sm:py-1.5"
      title={`Switch to the ${skin === "retro" ? "Iridescent Terminal (modern)" : "retro DOS terminal"} skin`}
    >
      <Sparkles className="h-3.5 w-3.5" />
      <span className="text-[12px] sm:text-[13px]">[{skin === "retro" ? "MODERN" : "RETRO"}]</span>
    </button>
  );
}