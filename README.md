<div align="center">

# 🟢 OTC Hub

**Community analytics dashboard, claim client and swap panel for the OTC Desks
protocol (otcdesks.cash) on Solana.**
React + Vite frontend on Cloudflare Pages · Base44 backend (entities/functions/auth) ·
Cloudflare Worker relay · operator-run RU_FOMO signal bot.

[![website](https://img.shields.io/badge/website-otchub.dev-14f195)](https://otchub.dev)
[![hub app](https://img.shields.io/badge/HUB%20app-otchub.dev%2Fhub-14f195)](https://otchub.dev/hub)
[![x](https://img.shields.io/badge/-@otchubdev-000000?logo=x&logoColor=white)](https://x.com/otchubdev)
[![dexscreener](https://img.shields.io/badge/DexScreener-%24HUB-14f195)](https://dexscreener.com/solana/4L45QjLmaKkqtyXgpR28fqcgWaF7cVZnHcDRCCwfy8TH)

**Community tooling — not affiliated with, endorsed by, or maintained by the
OTC Desks / OTCDesks Protocol team.**

</div>

Base44 app repository: use it to run and edit the app locally against the Base44 backend
(entities, functions, auth). **Official deployment is Cloudflare Pages, not Base44 hosting** —
every push to `origin main` triggers [`deploy.yml`](.github/workflows/deploy.yml), which builds
the app and deploys it straight to Cloudflare Pages at [otchub.dev](https://otchub.dev). No
manual Base44 "Publish" step is required for the live site.

## Links

| | |
|---|---|
| 🌐 Website | [otchub.dev](https://otchub.dev) |
| 📊 $HUB Protocol Dashboard (feature-flagged) | [otchub.dev/hub](https://otchub.dev/hub) |
| 🐦 X / Twitter | [@otchubdev](https://x.com/otchubdev) |
| 💬 Telegram (community bot) | [t.me/otchubSol_bot](https://t.me/otchubSol_bot) |
| 📈 DexScreener ($HUB) | [dexscreener.com/solana/4L45…fy8TH](https://dexscreener.com/solana/4L45QjLmaKkqtyXgpR28fqcgWaF7cVZnHcDRCCwfy8TH) |
| 🧩 Companion protocol repo | [OTCHUB/hubconnect](https://github.com/OTCHUB/hubconnect) |
| 🔒 Wallet/security review notes | [`docs/wallet-domain-review.md`](docs/wallet-domain-review.md) |

## What is OTC Hub?

**OTCDesks Protocol** (otcdesks.cash) runs OTC desk NFTs and a token launcher on Solana.
OTC Hub is a read-mostly community dashboard over that protocol: market/liquidity charts,
an NFT holdings gallery, treasury/pot metrics, a launcher-ecosystem feed with risk
enrichment, an in-app Jupiter swap panel, and (behind a feature flag) a claim client and
treasury dashboard for the companion **$HUB** yield protocol (see
[OTCHUB/hubconnect](https://github.com/OTCHUB/hubconnect) for the on-chain program).

The app never holds keys. Every wallet interaction — a claim, a swap, an activation — is
built client-side, pre-simulated (`sigVerify: false`) against our own RPC, and only then
handed to the connected wallet for the user's own signature via `solana:signTransaction`.
See [`docs/wallet-domain-review.md`](docs/wallet-domain-review.md) for the full security
posture and wallet-review submissions.

## Local Development

### Prerequisites

1. Clone the repository using the project's Git URL.
2. Navigate to the project directory.
3. Install dependencies: `npm install`.
4. Install the Base44 CLI: `npm install -g base44@latest`.
5. Install [Deno](https://docs.deno.com/runtime/getting_started/installation/) — the local Base44 backend runs on it.

Run `base44 --help` (or see the [CLI reference](https://docs.base44.com/developers/references/cli/commands/introduction)) for the full command surface.

### Run Locally

Three commands, from the project root:

```bash
base44 login   # one-time per machine
base44 link    # one-time per clone
base44 dev     # local backend + frontend together
```

Open the frontend URL that `base44 dev` prints (typically `http://localhost:5173`).

Notes:

- **Every fresh clone needs `base44 link`.** It writes `base44/.app.jsonc` (the app-id pointer), which is deliberately gitignored. Your app id is in the Builder URL (`app.base44.com/apps/<id>/...`); `base44 link --help` shows the non-interactive flags.
- **`base44 dev` runs the frontend for you** (via `site.serveCommand` in this repo's `base44/config.jsonc`) — never run `npm run dev` yourself: alone it serves a UI with no backend behind it (`[base44] Proxy not enabled`, every `/api` call fails), and alongside `base44 dev` the second Vite silently takes the next port and you end up looking at the wrong one.
- **The app must be published at least once for the UI to load under `base44 dev`.** The frontend boots by fetching app settings from the hosted app; before the first publish that fails and every page redirects to login. The local API works regardless.
- Entities, functions, and auth run locally — entity data is **in-memory only**, wiped when `base44 dev` restarts. Everything else (Core integrations, OAuth login) is forwarded to your deployed app. Full breakdown: [Local development overview](https://docs.base44.com/developers/backend/overview/local-dev/local-development-overview).

### Frontend Only, Hosted Backend

To work on just the frontend against your app's live hosted backend:

```bash
base44 dev --remote
```

⚠️ In this mode writes go to your app's **production data** — plain `base44 dev` keeps everything local.

### Deploying Your Changes

Push to `origin main` and you're done — [`deploy.yml`](.github/workflows/deploy.yml) builds
the app and deploys `dist/` to Cloudflare Pages (`otchub.dev`) automatically. This is the
**official deployment path**; there is no manual publish step for the live site.

Never run `base44 deploy` or `wrangler pages deploy` from a local machine for production —
either bypasses the CI-built environment (secrets baked in via `.env.production.local`, see
`deploy.yml`) and can ship a build that silently diverges from what's in git.

This repo still syncs to Base44 through git for the **backend** (entities, functions, auth,
local `base44 dev`) — opening the Base44 dashboard and clicking Publish only affects Base44's
own hosted preview domain (`otchubdev.base44.app`), not the production site.

### Checks

```bash
npm run lint        # eslint
npm run typecheck   # tsc (jsconfig.json, checkJs)
node --test tests/*.test.mjs   # offline unit/regression tests
npm run build        # vite build (production bundle)
```

Run the relevant checks above before finishing a change; the `tests/` suite covers the
launcher analytics/backend, RU_FOMO API, and swap-amount logic offline (no live RPC/wallet
required). Hosted RLS, live transactions, and wallet-connect flows still need a manual pass
against `base44 dev` or the deployed app.

## Architecture

```
src/                 React (Vite) frontend
  api/               Base44 SDK client (base44Client.js)
  components/otc/    OTC desk analytics UI, wallet portfolio, claim panel
  lib/                otcClaim.js (claim tx build/pack/simulate/execute), walletSigner.js,
                      hubFlag.js (feature flag), marketplace.js (Magic Eden listings)
  hub/, hub-sdk/     $HUB dashboard UI + read-only SDK, vendored from hubconnect (feature-flagged)
  pages/, hooks/, utils/, types/
base44/              Base44 app config, entities, backend functions (getDeskListings,
                     getHubCirculatingSupply, otcWebhook, ...), workflows, mcp
workers/
  solana-relay/       Cloudflare Worker: tx simulation/broadcast relay
  hub-standalone/     standalone $HUB deployment target
services/
  ru-fomo-bot/        operator-run RU_FOMO signal/trading bot process (separate from the published app)
docs/                specs (hub-protocol-spec.md, hubconnect-spec.md, ui-design-spec.md),
                     RU_FOMO contract/rollout, launcher live-data/risk notes,
                     wallet-domain-review.md (wallet/security submissions)
tests/               node:test offline suites — launcher, RU_FOMO API/bot, swap amounts
public/, dist/       static assets, icons/favicons, well-known files (security.txt, solana.txt)
```

The `hub/` and `hub-sdk/` directories are vendored copies of `hubconnect/web/src/hub` and
`hubconnect/sdk` (see [Companion protocol repo](#links)) — re-copy both whenever `hubconnect`
changes; they are not built from a shared package.

## Features

### $HUB Protocol Dashboard (feature-flagged, off by default)

The $HUB protocol dashboard (treasury, burn, pot, per-tier yield) is vendored into this repo
but **disabled until the token launches on mainnet**: `otchub.dev` shows only mainnet content.
`src/lib/hubFlag.js` reads `VITE_HUB_ENABLED`; while off, `/` is the OTC_DESK analytics
dashboard, `/otc` redirects to `/`, unknown paths 404, and the hub module is not bundled.

Set `VITE_HUB_ENABLED=true` (Base44 env vars, then republish) to switch it on. When enabled,
the domain root (`/`, plus `/treasury`, `/deployments`, `/desk/:asset`) becomes the $HUB
dashboard, the OTC_DESK analytics move to `/otc`, and `/hub/*` links from the former
standalone shell redirect. Launch checklist: also set `VITE_HUB_CLUSTER=mainnet-beta`,
`VITE_HUB_PROGRAM_ID`, `VITE_HUB_RPC_URL`, and re-copy `src/hub*` from `hubconnect`
(swap panel lands there). `/treasury` already carries the `[ VERIFICATION INFO ]` card
(CA copy, program id, BurnState burn proof, live supply / circulating / burn %, Metaplex
metadata + socials as indexers read them) for Dexscreener / CoinGecko listing.

Live mainnet $HUB pair: [dexscreener.com/solana/4L45QjLmaKkqtyXgpR28fqcgWaF7cVZnHcDRCCwfy8TH](https://dexscreener.com/solana/4L45QjLmaKkqtyXgpR28fqcgWaF7cVZnHcDRCCwfy8TH).

- `src/hub/` — UI module vendored from `hubconnect/web/src/hub` (TypeScript; Vite compiles it as-is).
- `src/hub-sdk/` — read-only SDK + IDL vendored from `hubconnect/sdk`, aliased as `@hub-sdk`
  (`vite.config.js`, `jsconfig.json`). Decodes accounts with `@anchor-lang/core` 1.2.0 to match
  the program's Anchor 1.2.0 / Agave toolchain. Re-copy both directories when `hubconnect` changes.
- Env (all optional, read at build time; `.env*` is gitignored so hosted builds use the defaults):
  `VITE_HUB_RPC_URL` (default `https://api.devnet.solana.com`; put the Helius devnet URL in
  `.env.production.local` for local production builds — the key ships in the bundle),
  `VITE_HUB_CLUSTER` (`devnet` | `mainnet-beta` | `localnet`, default `devnet`),
  `VITE_HUB_PROGRAM_ID` (default: the address baked into `src/hub-sdk/idl/hub.json`,
  devnet `5tCDEazUAkRjrkasup1uWcYo3t1C2ht76LmQva5rewQv`).
- Spec: `src/docs/hubconnect-spec.md` (mirror of `hubconnect/docs/hubconnect-spec.md`).


### Public Analytics and RU_FOMO

- [API contracts and security boundaries](docs/ru-fomo-implementation-contract.md)
- [Rollout checklist and secret placement](docs/ru-fomo-rollout.md)
- [Operator-run SOL bot configuration and limitations](services/ru-fomo-bot/README.md)

Public metrics, protected signals/reports, and the API Agent panel are implemented.
Signals and live trading default off. The bot is a separate operator process;
publishing the app does not start it. Never put wallet keys in Base44 or Vite.

Run offline regressions with `node --test tests/*.test.mjs`, then lint and build.
Hosted RLS and live transaction compatibility need separate operator validation.

### Launcher analytics and in-app swaps

The analytics feed polls `getLauncherLive` every 30 seconds while visible. Filter
by GRADUATED, BONDING or ABOUT_TO_GRADUATE; use ALL plus search to find any launch,
including those whose status has not been checked. Rank by volume, momentum or
market cap. Unknown metrics stay last. Existing public metrics keep their
five-minute cache.

Select a token name or TRADE to open its SOL pair in the in-app Jupiter panel.
The panel verifies mint decimals and token program on-chain, supports buy/sell,
and retains OTC as the default/reset pair. A launch's presence does **not** mean
Jupiter has a route; liquidity, token extensions and route coverage can prevent
execution. Balances cover the standard ATA only. No bot or live trade is started
by these UI changes; each swap requires the user's wallet approval.

Click a token logo (or its placeholder) to inspect its original image, available
Twitter/Telegram/website links, live-feed stats and source-reported **Stonk payout**
settings. This opens a separate mobile-friendly dialog; it does not change the
swap token, and stays usable while swap selection is locked. Details follow the
latest row by mint even when rankings change. Missing assets/rewards are labeled
unavailable. Payout mints, baskets and raw `rewardCycle` come from the launch feed;
cycle units, allocation weights, eligibility and payment timing are not verified.
Socials can fall back to existing DEX probes (at most 150 candidate tokens), never
to unrelated quote-token metadata. No additional per-token requests are made.

Each row also carries best-effort **risk enrichment** from public RugCheck GET
reports: a local DANGER/WARNING/NONE/UNKNOWN level, bounded risk factors, gross
top-15 token-account concentration (flagged strictly above 35%), and deployer
reputation with explicit provenance (user-curated ETF/pumpcat reference incidents
plus fresh rugged-report matches; negatives override positives). Enrichment is
bounded to 12 starts per rolling 30 seconds with at most 2 in flight, a shared
2500 ms stage deadline, and a five-minute cache. Timeouts, rate limits and
upstream failures degrade rows to explicit unknown/stale states and can never
block, delay or empty the feed. No report implies safety; unchecked rows are not
safe rows.

See [live-feed semantics, progress calculation and coverage](docs/launcher-live-data.md)
and [risk evidence, limits and reputation provenance](docs/launcher-risk.md).
Publish `getLauncherLive` with the frontend through the existing Base44 dashboard
workflow. It reuses the existing server-side Helius configuration. Follow with
hosted checks for status freshness, wallet selection and route availability;
the offline tests do not replace those checks.

## Security

- **No key custody.** The app never touches private keys, seed phrases, or signatures.
  Every transaction (claim, swap, activate) is built client-side, pre-simulated
  (`sigVerify: false`) against our own RPC, and signed in the wallet itself via
  `solana:signTransaction` (never `signAndSendTransaction` on the primary path).
- **Disclosure**: `https://otchub.dev/.well-known/security.txt` (RFC 9116) carries the
  responsible-disclosure contact.
- **Domain association**: `https://otchub.dev/.well-known/solana.txt` (sRFC-35) currently
  declares `solana-address=denyall` — this domain claims no Solana mint/program/address
  ahead of the $HUB mainnet launch.
- **Wallet/security warnings**: known false-positive wallet-simulation warnings, submission
  templates for Phantom/Solflare/Backpack/Jupiter, and root-cause analysis are tracked in
  [`docs/wallet-domain-review.md`](docs/wallet-domain-review.md). Do not add named-contact
  email drafts or personal contact details to that file — it mirrors to the public
  `OTCHUB/otchub` org repo; keep those in an untracked `*.local.md` file instead.
- **Operator bot**: `services/ru-fomo-bot` is a separate operator-run process; publishing the
  app never starts it, and wallet keys must never be placed in Base44 or Vite env vars. See
  [`docs/ru-fomo-implementation-contract.md`](docs/ru-fomo-implementation-contract.md) for
  API/security boundaries.

## Repositories

Two GitHub homes, one codebase — mirrors the [`hubconnect`](https://github.com/OTCHUB/hubconnect)
pattern: development happens in the `nodecattel` account, and only reviewed commits are
mirrored to the public `OTCHUB` organisation, which is what the Google Form / Blowfish /
wallet-review submissions above point reviewers at.

| Remote | Repository | Visibility | Watched by |
|---|---|---|---|
| `origin` | `nodecattel/otchub` | private | Cloudflare Pages (`deploy.yml`, official deploy), Base44 (git sync, backend only) |
| `production` | `OTCHUB/otchub` | public | wallet/security reviewers, community |

```bash
git remote -v                     # origin → nodecattel/otchub, production → OTCHUB/otchub
git remote add production https://github.com/OTCHUB/otchub.git   # once, on a fresh clone
git push origin main               # triggers the official Cloudflare Pages deploy + Base44 backend sync
git push production main           # mirrors the reviewed commit to the public org repo
```

Because `production` is public, review a commit's diff before mirroring it there —
personal contact details, named-support-thread drafts, and other internal-only notes
belong in gitignored `*.local` / `*.local.md` files, never in tracked docs.

## Docs & Support

- [MASTER_PROMPT.md](docs/MASTER_PROMPT.md) — project/agent operating notes
- [hub-protocol-spec.md](docs/hub-protocol-spec.md), [hubconnect-spec.md](docs/hubconnect-spec.md) — $HUB protocol spec mirrors
- [ui-design-spec.md](docs/ui-design-spec.md) — design system reference
- [launcher-live-data.md](docs/launcher-live-data.md), [launcher-risk.md](docs/launcher-risk.md) — launcher feed semantics and risk enrichment
- [ru-fomo-implementation-contract.md](docs/ru-fomo-implementation-contract.md), [ru-fomo-rollout.md](docs/ru-fomo-rollout.md) — RU_FOMO API/security boundaries and rollout
- [wallet-domain-review.md](docs/wallet-domain-review.md) — wallet/security warning submissions and status
- [services/ru-fomo-bot/README.md](services/ru-fomo-bot/README.md) — operator bot configuration and limitations

Base44 platform docs:

- [GitHub integration](https://docs.base44.com/developers/app-code/local-development/github)
- [Local development overview](https://docs.base44.com/developers/backend/overview/local-dev/local-development-overview)
- [Support](https://app.base44.com/support)
