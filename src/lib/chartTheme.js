import { useEffect, useState } from "react";
import { THEME_CHANGE_EVENT } from "@/lib/theme";

// Chart telemetry tokens: single source for every JS-colored chart value.
// The CSS variables live in index.css (:root dark / html.light values), so
// the dark/light theme restyles all charts by swapping tokens — no chart
// code changes.
const TOKENS = {
  grid: "--chart-grid",
  axis: "--chart-axis",
  tick: "--chart-tick",
  primary: "--chart-primary",
  secondary: "--chart-secondary",
  tertiary: "--chart-tertiary",
  danger: "--chart-danger",
  pos: "--chart-pos",
  barFill: "--chart-bar-fill",
  barEdge: "--chart-bar-edge",
  segA: "--chart-seg-a",
  segB: "--chart-seg-b",
  segC: "--chart-seg-c",
  segD: "--chart-seg-d",
  tipBg: "--chart-tip-bg",
  tipBorder: "--chart-tip-border",
  tipLabel: "--chart-tip-label",
  tipText: "--chart-tip-text",
  tipRadius: "--chart-tip-radius",
};

function readChartTheme() {
  const styles = getComputedStyle(document.documentElement);
  const t = {};
  for (const [key, cssVar] of Object.entries(TOKENS)) {
    t[key] = styles.getPropertyValue(cssVar).trim();
  }
  return t;
}

// Reads the live chart tokens and re-reads them whenever the theme
// changes (theme.js dispatches THEME_CHANGE_EVENT on every toggle).
export function useChartTheme() {
  const [theme, setTheme] = useState(readChartTheme);
  useEffect(() => {
    const onChange = () => setTheme(readChartTheme());
    window.addEventListener(THEME_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  }, []);
  return theme;
}

// Shared recharts styles — one series = one iris color, tooltips as panels.
export const tipStyle = (T) => ({
  background: T.tipBg,
  border: `1px solid ${T.tipBorder}`,
  borderRadius: T.tipRadius,
  fontFamily: "var(--font-mono)",
  fontSize: 13,
  color: T.tipText,
});
export const labelStyle = (T) => ({ color: T.tipLabel });
export const itemStyle = (T) => ({ color: T.tipText });
export const legendStyle = (T) => ({ fontSize: 12, fontFamily: "var(--font-mono)", color: T.tick });