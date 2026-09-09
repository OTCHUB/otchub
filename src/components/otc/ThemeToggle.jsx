import React, { useState } from "react";
import { Sun, Moon } from "lucide-react";
import { getStoredTheme, toggleTheme } from "@/lib/theme";

// Header theme switch: dark terminal by default, light "phosphor paper" mode.
// Shows the mode it will switch TO, matching the header's [LABEL ↗] style.
export default function ThemeToggle() {
  const [theme, setTheme] = useState(getStoredTheme());
  return (
    <button
      onClick={() => setTheme(toggleTheme())}
      className="inline-flex items-center gap-1 whitespace-nowrap border border-green-500/50 px-2 py-1 text-green-400 hover:bg-green-500/10 sm:px-2.5 sm:py-1.5"
      title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
    >
      {theme === "light" ? (
        <Moon className="h-3.5 w-3.5" />
      ) : (
        <Sun className="h-3.5 w-3.5" />
      )}
      <span className="text-[12px] sm:text-[13px]">[{theme === "light" ? "DARK" : "LIGHT"}]</span>
    </button>
  );
}