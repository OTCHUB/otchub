# Base44 Project

Use this repository to run and edit the app locally, then publish changes back through Base44.

Any change pushed to the repo will also be reflected in the Base44 Builder.

## Prerequisites

1. Clone the repository using the project's Git URL.
2. Navigate to the project directory.
3. Install dependencies: `npm install`.
4. Install the Base44 CLI: `npm install -g base44@latest`.
5. Install [Deno](https://docs.deno.com/runtime/getting_started/installation/) — the local Base44 backend runs on it.

Run `base44 --help` (or see the [CLI reference](https://docs.base44.com/developers/references/cli/commands/introduction)) for the full command surface.

## Run Locally

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

## Frontend Only, Hosted Backend

To work on just the frontend against your app's live hosted backend:

```bash
base44 dev --remote
```

⚠️ In this mode writes go to your app's **production data** — plain `base44 dev` keeps everything local.

## Publish Your Changes

After pushing your changes to git, open the Base44 dashboard and publish the app:

```bash
base44 dashboard open
```

This repo syncs to Base44 through git, so publish from the dashboard rather than `base44 deploy` — a CLI deploy ships your local tree directly, bypassing the sync, and the deployed state silently diverges from the repo.

## Public Analytics and RU_FOMO

- [API contracts and security boundaries](docs/ru-fomo-implementation-contract.md)
- [Rollout checklist and secret placement](docs/ru-fomo-rollout.md)
- [Operator-run SOL bot configuration and limitations](services/ru-fomo-bot/README.md)

Public metrics, protected signals/reports, and the API Agent panel are implemented.
Signals and live trading default off. The bot is a separate operator process;
publishing the app does not start it. Never put wallet keys in Base44 or Vite.

Run offline regressions with `node --test tests/*.test.mjs`, then lint and build.
Hosted RLS and live transaction compatibility need separate operator validation.

## Launcher analytics and in-app swaps

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

See [live-feed semantics, progress calculation and coverage](docs/launcher-live-data.md).
Publish `getLauncherLive` with the frontend through the existing Base44 dashboard
workflow. It reuses the existing server-side Helius configuration. Follow with
hosted checks for status freshness, wallet selection and route availability;
the offline tests do not replace those checks.

## Docs & Support

GitHub integration: [https://docs.base44.com/developers/app-code/local-development/github](https://docs.base44.com/developers/app-code/local-development/github)

Local development: [https://docs.base44.com/developers/backend/overview/local-dev/local-development-overview](https://docs.base44.com/developers/backend/overview/local-dev/local-development-overview)

Support: [https://app.base44.com/support](https://app.base44.com/support)
