# OTC_HUB UI Design Spec — RETRO / MODERN Dual-Skin System

Handover document for cross-repo consistency (otchub / otcgub and future frontends).
Source of truth is this workspace; replicate the architecture, tokens and rules below.

**Defaults (as of 2026-09-10):** every visitor starts in **MODERN skin + DARK theme**.
RETRO and LIGHT are opt-in via the two header toggles; choices persist in `localStorage`.

---

## 1. Architecture — one component tree, two skins

Both skins render the **same JSX**. The skin is a pure CSS-variable remap plus a
few chrome rules — never separate components:

- `light` class on `<html>` → theme (light/dark), orthogonal to skin.
- `skin-modern` class on `<html>` → design language (RETRO terminal ↔ MODERN iridescent glass).
- Combinations: `retro|dark`, `retro|light`, `skin-modern` (dark), `skin-modern light`.
- Every toggle dispatches `THEME_CHANGE_EVENT` so JS-colored visuals (charts via
  `useChartTheme`) re-read tokens live. No page reload ever.

Cascade order in `src/index.css` (matters — later blocks win):
1. `:root` — RETRO dark palette + chart tokens (defaults)
2. `html.light` — RETRO light ("phosphor paper") overrides
3. `html.skin-modern` — MODERN dark ("Iridescent Terminal") full remap
4. `html.skin-modern.light` — MODERN light ("Pearlescent") overrides

### Exact file locations (this workspace)

| Concern | File |
| --- | --- |
| All skin/theme CSS variables + chrome rules | `src/index.css` |
| CSS variable → Tailwind class mapping (`rgb(var(--c-green-500)/<alpha>)` etc.) | `tailwind.config.js` |
| Theme/skin classes, persistence, defaults, `THEME_CHANGE_EVENT` | `src/lib/theme.js` |
| Startup init (`initTheme()` + `initModernSkinChrome()`) | `src/main.jsx` (lines 7–15) |
| MODERN chrome pass (strips `[LABEL]` brackets while modern skin active) | `src/lib/modernChrome.js` |
| Chart telemetry tokens + `useChartTheme()` hook + shared recharts styles | `src/lib/chartTheme.js` |
| Light/dark toggle (icon-only, Sun/Moon = mode it switches TO) | `src/components/otc/ThemeToggle.jsx` |
| Retro/modern toggle | `src/components/otc/SkinToggle.jsx` |
| Boot screen (skin-aware hero) | `src/components/otc/BootScreen.jsx` |
| Fixed top/bottom terminal bars | `src/components/otc/TerminalBars.jsx` |
| Collapsible panel window (the ONE glass frame per panel) | `src/components/otc/CollapsibleCard.jsx` |
| Dashboard composition (header layout, panel stack) | `src/pages/Home.jsx` |
| Portaled dropdown (pattern for all menus) | `src/components/otc/CommunityMenu.jsx` |
| Pager (table pagination control styling) | `src/components/otc/Pager.jsx` |
| Original design-token source specs (kept for reference) | `design/tokens.css`, `design/components.css`, `design/tailwind.theme.js`, `design/tokens.json` |
| Fonts (IBM Plex Mono = RETRO, Inter Tight = MODERN, Press Start 2P = retro display) | loaded in `index.html` (Google Fonts, lines 17–19) |
| Site logo (transparent PNG, header + favicon) | `https://media.base44.com/images/public/6a97c0a4fb3601dc274f8d83/7166bbd89_hub_mt.png` |

### Token system

Tailwind color utilities are **variable-driven** — component code uses classes like
`bg-black`, `text-green-400`, `border-emerald-500/30`, and each skin remaps the
underlying `--c-*` variables. Never hardcode hex in JSX; add new colors as
`--c-<family>-<step>` pairs in `:root` + every skin block, and map once in
`tailwind.config.js`.

Chart colors are also tokens (`--chart-grid`, `--chart-primary`, `--chart-seg-a…d`,
`--chart-tip-*`) read by `src/lib/chartTheme.js` — charts never hardcode colors.

---

## 2. MODERN skin — "Iridescent Terminal" (default, dark)

Voice: sci-fi instrument chassis. Void-black stage, frosted glass windows,
iridescent cyan/violet/magenta spectrum, fully sans-serif.

### Palette (dark — `html.skin-modern`)

| Role | Value |
| --- | --- |
| Page stage / void | `#000000` (aurora glows: cyan, violet, magenta radial gradients at low alpha) |
| Chassis panel (`--c-black`) | `rgb(18 22 28 / …)` — `#12161C` with alpha |
| Primary text / silver | `#E8EEF4` (green-200), body silver `#C9D2DC`–`#DBE4EE` |
| Iris cyan (primary accent, borders, focus) | `#5CE1FF` |
| Status lime (LIVE/success) | `#7CFF6B` |
| Aqua (secondary positive) | `#3DFFD2` |
| Gold (warnings) | `#F0C14A` |
| Magenta (danger — never generic red) | `#FF5CC8` |
| Violet (secondary accent) | `#A78BFF` |
| Pearlescent metal grays (slate scale) | `#9AA3AE` → `#1B2430` |

shadcn tokens follow the chassis: `--background 240 6% 0%`, `--card/--popover 217 22% 9%`,
`--border/--input 214 16% 20%`, `--primary/--ring 193 100% 68%`.

### Typography

- **Everything is Inter Tight** — `--font-heading/--font-body/--font-display/--font-mono`
  all remap to `"Inter Tight", ui-sans-serif, system-ui` (400/500/600/700 from Google Fonts).
  Zero monospace anywhere in MODERN, including HUD readouts and boot logs.
- **Sentence case** for labels: `html.skin-modern .uppercase { text-transform: none; }` —
  write labels sentence-cased in JSX; RETRO uppercases them via the class.
- Relaxed tracking: `.tracking-widest` → `0.04em` (wide `0.08em+` display spacing stays).
- HUD wordmarks: weight 700, letter-spacing `0.08em`.
- Uppercase is reserved for hero readouts and 10px status chips only.

### Geometry — "one chamfer per window"

- Collapsible window root (`.term-window`): **18px** radius, `overflow: hidden`.
- Every inline control (buttons, inputs, chips, badges, anchor-links, media frames): **8px**.
- Floating roots (dialogs, menus, tooltips): **14px**.
- **Never rounded-on-rounded**: inside a window, block containers lose their radius and
  backgrounds (`html.skin-modern :is(.term-window,[role=dialog]) :is(div,section,…)…`
  rules in `src/index.css`) so bordered sections read as hairline zones of ONE frosted
  sheet. Accent tints (`bg-emerald-500/5`-style) survive as soft zone glows.

### Glass surfaces

`.term-window` = frosted chassis glass: `rgb(18 22 28 / 0.55)` + `backdrop-filter:
blur(16px) saturate(1.5)` + iridescent ring shadow (`0 0 0 1px rgb(92 225 255/.22)`,
`0 0 0 2px rgb(167 139 255/.1)`, cyan bloom + deep drop). Fixed bars (`.term-bar`)
freeze into glass (`blur(14px) saturate(1.4)`).

### Chrome rules

- **No square brackets** on labels/chips — `src/lib/modernChrome.js` strips
  bracket-only text nodes (`[ TRADE ]` → `Trade`) while the modern skin is active and
  restores them for RETRO. Write new buttons sentence-cased without brackets.
- Inputs: recessed wells; focus = iris ring + cyan bloom
  (`border-color rgba(92,225,255,.6)`, `box-shadow 0 0 16px rgba(92,225,255,.35)`),
  caret `#5CE1FF`, selection `rgba(92,225,255,.28)`.
- Scrollbars: metal (`#2A313A` thumb on `#000` track, pill-shaped).
- Fee-flow marching dashes (`.pot-flow-x/y`): iris cyan; broken routes dim magenta.
- CRT scanlines/vignette (`.boot-crt`) are RETRO-only: `html.skin-modern .boot-crt { display: none; }`.

### MODERN light — "Pearlescent" (`html.skin-modern.light`)

Cool pale metal canvas `#E3E9EF` with soft iris glows; near-white frosted panels
(`--c-black: 245 248 251`); dark slate text `#1E2632`; iris spectrum darkened one step
for contrast: cyan `#0891B2`, aqua `#13 148 136` (`#0D9488`), gold `#B45309`, magenta
`#C026D3`, violet `#7C3AED`. Ring/bloom shadows and flow-dash colors get matching
darkened overrides (see the `html.skin-modern.light` block in `src/index.css`).

---

## 3. RETRO skin — DOS terminal (opt-in, dark is default)

Voice: green-phosphor CRT terminal. Mono type, square corners, ALL-CAPS, bracket chrome.

### Palette (dark — `:root`)

- Black `#000000` stage; Tailwind **green** scale for text/borders
  (`text-green-400` body, `text-green-300` strong, `text-green-500` accents);
  emerald = status, cyan = info, amber = warning, red = danger, fuchsia = highlight;
  slate = secondary grays. Exact channel values: `:root` in `src/index.css`.

### Typography & chrome

- **IBM Plex Mono** for UI/HUD (`--font-mono`), **Press Start 2P** for the pixel
  display wordmark (`--font-display`); both loaded in `index.html`.
- Labels typed in JSX are sentence case; RETRO shows them **ALL-CAPS**
  (`.uppercase` transform is untouched here) with wide tracking.
- Buttons/links carry literal **`[ LABEL ↗ ]`** bracket chrome (stripped automatically
  in MODERN by `modernChrome.js` — keep writing them bracketed for retro).
- Square corners everywhere (no chamfer); flat `bg-black` panels with green hairlines.
- Boot screen: full-screen CRT treatment — repeating scanline overlay + vignette
  (`.boot-crt` divs in `BootScreen.jsx`), ASCII banner header
  (`+---…` box, `OTC_ECOSYSTEM_TOOLING :: SOLANA TERMINAL / CREATED BY
  HUB_YIELD_OPTIMIZER_PROTOCOL`).

### RETRO light — "phosphor paper" (`html.light`)

Pale mint paper `rgb(236 243 236)`; ink-dark green text (green scale inverted: 200–400
go dark, 700–900 go light); emerald/cyan/amber/red/fuchsia each darkened for paper
contrast; chart tokens switch to ink grid + deep accents (`--chart-primary #16A34A`,
tip bg `#FFFFFF`). CRT overlays hidden (`html.light .boot-crt { display: none; }`).

---

## 4. Shared layout & interaction rules (both skins)

- **Responsive:** mobile-first; every panel must stay inside the viewport
  (`html,body { overflow-x: hidden; max-width: 100vw }`). Below `sm`, a typography
  scale steps every size down one notch (10–11px floors stay), and inputs are forced to
  `16px` (except `.compact-input` = 11px) to stop mobile auto-zoom — `src/index.css`.
- **Dropdowns are portaled to `<body>`** and positioned from the button's live rect
  (see `CommunityMenu.jsx`) — glass windows have `overflow: hidden` and will clip
  anything rendered inline.
- **Panels** are `CollapsibleCard` (`[−]/[+]` header, all open by default, `openSignal`
  counter to force-open from other panels, `locked` while a flow is busy).
- Header: transparent logo image + `OTC hub · OTC desk tools` title, blinking cursor,
  stackable action row (community menu, external links, theme toggle, skin toggle,
  refresh). Theme toggle is **icon-only**; community button reads `COMMUNITY ▾`.
- Boot screen tracks progress one printed line = one step; MODERN shows the sans hero
  (`OTC_HUB` + "OTC ecosystem tooling · created by Hub Yield Optimizer Protocol"),
  RETRO shows the ASCII banner.
- Wallet panel is collapsed by default with a single status line
  (`CONNECTED · xxxx…xxxx` / `NOT CONNECTED`); wallet address lookups use 11px.
- Disclaimers everywhere: "community tooling · not affiliated with otcdesks.cash".

## 5. New-repo checklist

1. Copy `src/index.css` (tokens + all four palette blocks) and `tailwind.config.js` verbatim.
2. Port `src/lib/theme.js` (defaults: **dark** theme, **modern** skin),
   `src/lib/modernChrome.js`, `src/lib/chartTheme.js`; call `initTheme()` +
   `initModernSkinChrome()` at entry (see `src/main.jsx`).
3. Load the three Google Fonts in `index.html` (IBM Plex Mono, Inter Tight, Press Start 2P).
4. Use variable-driven Tailwind classes only; add tokens, never hex literals.
5. Keep one chamfer per window in MODERN; brackets + ALL-CAPS in RETRO.