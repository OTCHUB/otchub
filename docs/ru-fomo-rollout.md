# RU_FOMO rollout checklist

## What is implemented

| Hosted route under `/functions/` | Access | Purpose |
| --- | --- | --- |
| `getPublicMetrics` | Public GET/POST | `sort=change24h`, `vol24`, or `mcap`; limit 1–60, default 15 |
| `getPublicMetrics?view=meta` | Public GET | Catalog, examples and JSON schemas |
| `ruFomoSignals` | Bearer GET/POST | Poll, or `action=logs` to read caller-reported outcomes |
| `ruFomoReport` | Bearer POST | Append sanitized execution outcome for an issued signal |

Metrics reuse the launcher's 300-second cache and 1,800-second stale-on-error
fallback, per-isolate. Source timestamps are preserved; unknown metrics sort last
with stable ties. Rankings cover the top-60-volume cohort, not the whole market.
Signals are never emitted from stale, future or expired source snapshots.
The momentum strategy uses 24h change, not measured statistical volatility.

Public reads have a 120/minute aggregate per-isolate limit. Protected reads/writes
use 60/minute per credential per isolate (shared only when co-located). Neither is
a global quota: provision edge throttling, including invalid credentials, before
public rollout. Responses are HTTP no-store; the source cache lives server-side.
Logs support limit 1–100 and either an exclusive epoch-ms `before` or opaque
`cursor`; take the next cursor from `X-Next-Cursor`. Reports can be duplicated if
an HTTP acknowledgement is lost. They are claims, not independently verified fills.

## Secret and configuration placement

| Location | Variable | Purpose |
| --- | --- | --- |
| Base44 runtime secret store | `RU_FOMO_API_KEY_SHA256` | Hex SHA-256 of a high-entropy operator API key |
| Base44 runtime configuration | `RU_FOMO_SIGNALS_ENABLED` | Default off; only `true` enables signal issuance |
| Base44 runtime configuration | `RU_FOMO_MIN_VOLUME_USD` | Default 100000 |
| Base44 runtime configuration | `RU_FOMO_MIN_CHANGE_PCT` / `RU_FOMO_MAX_CHANGE_PCT` | Defaults 10 / 100 |
| Base44 runtime configuration | `RU_FOMO_MIN_LIQUIDITY_USD` | Default 25000 |
| Operator environment/vault injection only | `RU_FOMO_API_KEY` | Plain bearer sent over HTTPS only to the approved API origin |
| Operator environment/vault injection only | `RU_FOMO_SECRET_KEY_JSON` | Wallet key: JSON array of 64 bytes; live mode only |
| Operator environment/vault injection only | `RU_FOMO_RPC_URL` | Trusted HTTPS mainnet RPC; never log credential-bearing URLs |

`RU_FOMO_SECRET_KEY_JSON` is this implementation's equivalent of the roadmap's
example `SOLANA_PRIVATE_KEY`. There is no `SOLANA_PRIVATE_KEY` alias. Do not
provision either wallet variable in Base44, the frontend, or Git. The operator
signer is the only component that reads the key. PumpPortal receives public
trade intent; RPC receives signed transactions, never private keys.

Generate the API credential with a cryptographic random generator in the operator
vault (at least 32 random bytes). Store it in the operator environment, compute
the SHA-256 over its exact UTF-8 bytes (no trailing newline) within that trusted
environment, and provision only the hash in Base44. Never print or paste secrets
into shell arguments, tickets or chat. Key rotation stops the bot until both
sides are updated; this MVP supports one shared operator credential, not tenants.

## Staged activation — not performed by implementation

1. Keep signals disabled and the bot stopped. Publish the Git-synced app through
   the Base44 dashboard, including both private entities, functions and frontend.
   Follow the root README; do not bypass this repository's Git publish workflow.
2. Verify the published app ID/base URL configuration. Check public metrics and
   metadata return JSON (not an HTML SPA fallback), and use the panel's manual
   public check. Gated endpoints are deliberately never probed by the frontend.
3. Verify hosted bearer auth: missing/wrong keys fail, valid key with disabled
   signals returns `enabled:false`, and every protected response is no-store.
   Verify the hosting layer overwrites Base44 internal context headers. The SDK
   gets only that host context, not the operator bearer as a user token.
4. In a controlled test deployment, verify anonymous AND ordinary authenticated
   direct entity reads/writes are denied, including generated entity MCP tools.
   With the authorized backend, verify issued-signal persistence, report creation
   and cursor pagination. Unit RLS assertions do not prove hosted enforcement.
5. After authorizing signal/log data writes, enable the strategy and run the bot
   in default dry-run with only the base URL, allowed origin, and API credential.
   Observe persisted `dry_run` reports. No wallet/RPC/PumpPortal requests occur;
   dry-run is not transaction simulation or evidence a live buy would pass.
6. Review the [bot configuration](../services/ru-fomo-bot/README.md), supported
   transaction variant, budgets, slippage, reserve, mint allowlist and recovery
   procedures. Independently validate current PumpPortal compatibility. The MVP
   supports only native-SOL Pump buys with pre-existing legacy token accounts;
   no sells, ATA creation, graduated pools, auto-funding or automatic pool fallback.
7. Only with separate explicit operator approval, a dedicated small wallet and
   complete live bounds should `RU_FOMO_LIVE=true` be provisioned on the operator
   host. Do not infer live safety from passing synthetic fixtures.

## Local verification and ongoing tests

Run `node --test tests/*.test.mjs`, `npm run lint`, `npm run build`, and
`npm run typecheck`. Tests use mocked APIs/RPC and generated ephemeral identities;
none broadcast or fund wallets. Keep adding adversarial tests when supporting
new Pump instruction layouts. Never relax a rejection simply to get a fill.

The existing repository has unrelated typecheck failures; integration must not
add new diagnostics. A build without app ID configuration is only a compilation
check, not a deployable hosted build. Hosted RLS and current live Pump variants
remain rollout checks, not completed runtime verification.

Preserve the operator journal outside Git/cloud sync. It contains no private key
but governs replay prevention, budget accounting and uncertain submissions.
Never delete/reset it to clear a blocked transaction. Shutdown stops new signing
but lets journaled submissions finish; unknown signatures require reconciliation.