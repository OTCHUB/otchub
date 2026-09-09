// App-wide terminal theme: dark (green-on-black) by default, light
// (dark-green-on-paper) opt-in. The class lives on <html>; Tailwind color
// utilities are CSS-variable driven (see index.css / tailwind.config.js), so
// toggling the class swaps the whole palette with no component changes.
const KEY = "otc_theme";
const SKIN_KEY = "otc_skin";

// Dispatched on every theme/skin change so JS-colored visuals (chart
// telemetry via src/lib/chartTheme.js) re-read their CSS tokens live.
export const THEME_CHANGE_EVENT = "otc-theme-change";

// MODERN is the default skin for new visitors; "retro" is opt-in.
export function getStoredSkin() {
  try {
    return window.localStorage.getItem(SKIN_KEY) === "retro" ? "retro" : "modern";
  } catch {
    return "modern";
  }
}

export function applySkin(skin) {
  document.documentElement.classList.toggle("skin-modern", skin === "modern");
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export function toggleSkin() {
  const next = getStoredSkin() === "modern" ? "retro" : "modern";
  applySkin(next);
  try {
    window.localStorage.setItem(SKIN_KEY, next);
  } catch {
    /* storage unavailable — skin lasts for this session only */
  }
  return next;
}

export function getStoredTheme() {
  try {
    return window.localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme) {
  document.documentElement.classList.toggle("light", theme === "light");
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

// Run once at startup (main.jsx) so the classes exist before first paint.
export function initTheme() {
  applyTheme(getStoredTheme());
  applySkin(getStoredSkin());
}

export function toggleTheme() {
  const next = getStoredTheme() === "light" ? "dark" : "light";
  applyTheme(next);
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    /* storage unavailable — theme lasts for this session only */
  }
  return next;
}