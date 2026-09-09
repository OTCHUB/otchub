/* ==================================================================
   Iridescent Terminal — Tailwind theme (design-framework reference)
   ------------------------------------------------------------------
   The live app keeps its CSS-variable-driven tailwind.config.js (RETRO
   default + html.skin-modern remap). This file is the MODERN token
   theme to merge into theme.extend as components adopt iris classes
   directly on the new framework. Values mirror design/tokens.css 1:1.
   Merge: Object.assign(tailwind.config.js theme.extend, this module)
   ================================================================== */

module.exports = {
  colors: {
    void: "#000000",
    hull: "#0B0E12",
    panel: "#12161C",
    inset: "#07090C",
    elevated: "#181E26",
    metal: {
      base: "#9AA3AE",
      edge: "#E8EEF4",
      line: "#2A313A",
    },
    text: {
      DEFAULT: "#E8EEF4",
      secondary: "#8A93A0",
      tertiary: "#5C6570",
    },
    iris: {
      cyan: "#5CE1FF",
      aqua: "#3DFFD2",
      violet: "#A78BFF",
      magenta: "#FF5CC8",
      gold: "#F0C14A",
      lime: "#7CFF6B",
    },
    chart: {
      grid: "#1B2430",
      up: "#5CE1FF",
      down: "#FF5CC8",
      wick: "#8A93A0",
      volume: "#A78BFF",
    },
  },
  fontFamily: {
    ui: ["Inter Tight", "IBM Plex Sans", "ui-sans-serif", "system-ui", "sans-serif"],
    hud: ["Press Start 2P", "IBM Plex Mono", "ui-monospace", "monospace"],
    mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
  },
  fontSize: {
    micro: ["10px", { lineHeight: "1.2" }],
    caption: ["12px", { lineHeight: "1.3" }],
    label: ["13px", { lineHeight: "1.3" }],
    body: ["14px", { lineHeight: "1.45" }],
    title: ["20px", { lineHeight: "1.25" }],
    display: ["40px", { lineHeight: "1.1", letterSpacing: "0.08em" }],
  },
  borderRadius: {
    sm: "8px",
    frame: "12px",
    panel: "14px",
  },
  boxShadow: {
    device: "0 18px 50px rgba(0,0,0,0.55)",
    focus: "0 0 0 1px #5CE1FF, 0 0 16px rgba(92,225,255,0.35)",
  },
  backgroundImage: {
    iris: "linear-gradient(135deg, #5CE1FF 0%, #A78BFF 40%, #FF5CC8 70%, #F0C14A 100%)",
    "iris-soft":
      "linear-gradient(135deg, rgba(92,225,255,.35), rgba(167,139,255,.28), rgba(255,92,200,.22))",
  },
  transitionTimingFunction: {
    terminal: "cubic-bezier(0.16, 1, 0.3, 1)",
  },
  transitionDuration: {
    iris: "16000ms",
  },
  keyframes: {
    "iris-drift": {
      "0%": { backgroundPosition: "0% 50%" },
      "100%": { backgroundPosition: "200% 50%" },
    },
  },
  animation: {
    // Slow gradient drift — fast rainbow = cheap (12–20s loop only).
    "iris-drift": "iris-drift 16s linear infinite",
  },
};