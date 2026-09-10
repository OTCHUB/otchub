# OTC_HUB UI Design Spec — DEFAULT Terminal Theme

Handover document for cross-repo consistency (otchub ecosystem and future frontends).
Source of truth is this workspace; replicate the architecture, tokens and rules below.

**Defaults (as of 2026-09-10):** there is **one design language** — the
**DEFAULT terminal theme** (green-phosphor DOS/CRT aesthetic). It is NOT a skin:
no skin toggle exists, no skin classes exist, and no second design language is
ever rendered. If a new skin is added later it must slot in beside this one and
this document stays the definition of "default".

- Every visitor starts in **dark** (green-on-black). **Light** ("phosphor paper",
  ink-green-on-pale-mint) is opt-in via the header toggle; both persist in
  `localStorage` under `otc_theme`.
- Both modes render the **same JSX**. The theme is a pure CSS-variable remap
  (`light` class on `<html>`) — never separate components, never hex in JSX.

---

## 1. Architecture — one component tree, one theme, two palettes

- `light` class on `<html>` switches dark ↔ light. Nothing else changes.
- The toggle dispatches `THEME_CHANGE_EVENT` so JS-colored visuals (charts via
  `src/lib/chartTheme.js`) re-read tokens live. No page reload ever.
- A pre-paint script in `index.html` applies the stored theme before CSS/JS
  loads so light users never get a dark flash.

### Exact file locations (this workspace)

| Concern | File |
| --- | --- |
| All theme CSS variables + chrome rules (dark `:root` + `html.light` overrides) | `src/index.css` |
| CSS variable → Tailwind class mapping (`rgb(var(--c-green-500)/<alpha>)` etc.) | `tailwind.config.js` |
| Theme class, persistence, default, `THEME_CHANGE_EVENT` | `src/lib/theme.js` |
| Startup init (`initTheme()`) | `src/main.jsx` |
| Chart telemetry tokens + `useChartTheme()` hook + shared recharts styles | `src/lib/chartTheme.js` |
| Light/dark toggle (icon-only, Sun/Moon = mode it switches TO) | `src/components/otc/ThemeToggle.jsx` |
| Boot screen (first-session BIOS sequence, CRT overlay) | `src/components/otc/BootScreen.jsx` |
| Fixed top/bottom terminal bars | `src/components/otc/TerminalBars.jsx` |
| Collapsible panel window (the ONE frame per panel) | `src/components/otc/CollapsibleCard.jsx` |
| Dashboard composition (header layout, panel stack) | `src/pages/Home.jsx` |
| Portaled dropdown (pattern for all menus) | `src/components/otc/CommunityMenu.jsx` |
| Pager (table pagination control styling) | `src/components/otc/Pager.jsx` |
| Original design-token source specs (kept for reference) | `design/tokens.css`, `design/components.css`, `design/tailwind.theme.js`, `design/tokens.json` |
| Site logo (transparent PNG, header + favicon) | `https://media.base44.com/images/public/6a97c0a4fb3601dc274f8d83/7166bbd89_hub_mt.png` |

### Token system

Tailwind color utilities are **variable-driven** — component code uses classes
like `bg-black`, `text-green-400`, `border-emerald-500/30`, and `html.light`
remaps the underlying `--c-*` variables. Never hardcode hex in JSX; add new
colors as `--c-<family>-<step>` pairs in `:root` **and** the `html.light` block,
then map once in `tailwind.config.js`.

Chart colors are also tokens (`--chart-grid`, `--chart-primary`, `--chart-secondary`,
`--chart-tertiary`, `--chart-danger`, `--chart-pos`, `--chart-bar-fill/edge`,
`--chart-seg-a…d`, `--chart-tip-*`) read by `src/lib/chartTheme.js` — charts
never hardcode colors and re-read tokens on every theme change.

---

## 2. DEFAULT theme — voice and rules

Voice: **green-phosphor CRT terminal.** Mono type, square corners, ALL-CAPS
labels, bracket chrome, flat black stage, green hairlines. Dense, instrument-
like, mobile-first.

### Palette (dark — `:root`)

- Stage: pure black (`bg-black`, `--c-black: 0 0 0`). Panels are flat black with
  green hairline borders — no shadows, no gradients, no glass.
- Tailwind **green** scale for text/borders: `text-green-500/50`–`/70` muted,
  `text-green-400` body, `text-green-300` strong, `text-green-200` headlines.
- Semantic families: **emerald** = success/LIVE, **cyan** = info/active/progress,
  **amber** = warning, **red** = danger/loss, **fuchsia** = special highlight
  (official $HUB/★ marks), **slate** = secondary grays.
- Exact channel values replicate Tailwind's default palette and live in `:root`
  in `src/index.css`.

### Palette (light — `html.light`, "phosphor paper")

- Pale mint paper `rgb(236 243 236)` (`--c-black: 236 243 236`); ink-dark green
  text — the green scale inverts (200–400 go dark, 700–900 stay dark/lightened
  for contrast on paper).
- Every accent family (emerald/cyan/amber/red/fuchsia/slate) is darkened one or
  more steps for paper contrast; chart tokens switch to ink grid + deep accents
  (`--chart-primary #16A34A`, tip bg `#FFFFFF`).
- CRT overlays (`.boot-crt` scanlines/vignette) are dark-only: hidden in light.
- The light block is kept byte-identical with hubconnect/web's `index.css` —
  edit hubconnect first, then re-copy (comment in `src/index.css`).

### Typography

- **Monospace everywhere** (`font-mono`, `--font-mono`: system mono stack).
  No external webfonts are loaded; never add a font link for the default theme.
- Headlines (`font-display`) may use the pixel/display stack for hero wordmarks;
  body, labels, tables and HUD readouts are all mono.
- Mobile typography scale (below `sm`): every Tailwind text size steps down one
  notch via the media-query overrides in `src/index.css` — write normal
  Tailwind text classes; the scale handles small screens. 10–11px floors stay.
- **Labels typed in JSX are ALL-CAPS with wide tracking**
  (`uppercase tracking-widest`), typically `text-[10px]`–`text-[11px]` muted
  (`text-green-500/50`–`/70`).

### Geometry & chrome

- **Square corners everywhere** — `border-radius: 0`. No chamfers, no pills
  (exception: tiny status dots use `rounded-full`).
- **Bracket chrome**: buttons/links carry literal `[ LABEL ↗ ]`-style brackets
  and arrow glyphs (`↗`, `▴/▾`, `▸`). Section headers read `NAME · DETAIL`.
- Borders are 1px hairlines: `border-green-500/20` (calm) → `/30` (normal) →
  `/50` (strong) → `/60` (CTA). Accent tints like `bg-green-500/5`–`/10` mark
  hover/active zones; selected chips swap to their accent family
  (e.g. `border-cyan-400 text-cyan-300 bg-cyan-500/10`).
- Inputs: flat black wells (`bg-black border-green-500/30`), mono text 11px,
  green caret. Focus = border brightens; no glow shadows.
- Status indicators: blinking pulse dot (`animate-pulse rounded-full
  bg-emerald-400`) + ALL-CAPS text (`LIVE`, `CONNECTED · xxxx…xxxx`).
- Boot screen (first visit per session): full-screen CRT treatment — scanline
  overlay + vignette (`.boot-crt` divs in `BootScreen.jsx`), one printed line
  = one progress step.
- Fee-flow marching dashes (`.pot-flow-x/y`) are green when live, dim red
  (`.pot-flow-broken`) when a route is down.

### Component idioms (copy these patterns)

| Element | Pattern |
| --- | --- |
| Panel | `CollapsibleCard` — `[−]/[+]` header, ALL-CAPS title, `openSignal` counter to force-open from other panels, `locked` while a flow is busy |
| Page frame | Fixed `TerminalTopBar` + `TerminalBottomBar` bars, `max-w-7xl` center column, `px-3 py-4 sm:px-4 sm:py-6`, panels stacked with `mt-3`, `lg:grid-cols-*` splits |
| Header | Transparent logo image + ALL-CAPS wordmark + blinking `▋` cursor; single square action row (menu, X icon link `p-1.5 sm:p-2`, theme toggle, refresh) — all frames the same compact square size |
| Hero | Terminal window with badge chips, ALL-CAPS headline, full-length CA copy bar, bordered CTA buttons, live stat cards that click-through to their panel |
| Buttons | `border px-… py-1 text-[10px]–[12px] font-bold uppercase` + family color; primary CTAs get `bg-<accent>/10`–`/15` |
| Filter chips | Compact `border px-1.5 py-0.5 text-[10px] font-bold uppercase` toggles; selected = cyan border + tint, ranking = green |
| Data rows | Single-line dense rows, mono `text-[11px]–[12px]`, hairline dividers (`border-green-500/10`), wrap full-width metric lines instead of side-scrolling |
| Dialogs | `bg-black border-green-500/40`, mono, ALL-CAPS header + sentence body, max-w constrained, `90dvh` scroll |
| Numbers | Compact K/M/B suffixes, 2 decimals; SOL to 2–3 decimals; $OTC price 4 decimals; full CAs shown, never truncated (mobile uses `break-all`) |
| Dropdowns | Portaled to `<body>`, positioned from the button's live rect (`CommunityMenu.jsx`) — panels clip inline overflow |
| Disclaimers | "community tooling · not affiliated with otcdesks.cash" pattern on every page |

---

## 3. Responsive & motion rules

- Mobile-first; every panel must stay inside the viewport
  (`html, body { overflow-x: hidden; max-width: 100vw }`).
- Below `sm`: text scale steps down (see Typography); inputs are forced to
  `16px` (except `.compact-input` = 11px) to stop mobile auto-zoom.
- Motion is minimal and functional only: `animate-pulse` live dots, one-shot
  launcher flip/slide flashes (`.launcher-flip-up/down`), marching-dash flow
  routes, blink cursor. No entrance animations, no parallax, no transitions
  beyond short `hover:` color changes.

## 4. New-repo / new-page checklist

1. Copy `src/index.css` (tokens + both palette blocks) and `tailwind.config.js`
   verbatim; port `src/lib/theme.js` and `src/lib/chartTheme.js`; call
   `initTheme()` at entry (see `src/main.jsx`) and add the pre-paint theme
   script to `index.html`.
2. Use variable-driven Tailwind classes only; add tokens, never hex literals.
3. No webfonts — system mono stack; ALL-CAPS wide-tracked labels; square
   corners; flat black panels with green hairlines; brackets on button chrome.
4. Reuse the component idioms table above; panels are `CollapsibleCard`s in a
   single center column with `lg:` grid splits.
5. Both dark and light must always read correctly — check every new screen in
   light mode before shipping.