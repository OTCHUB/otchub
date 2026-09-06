# RU_FOMO MVP integration contract

This is the implementation boundary for the public API, protected signals,
operator-run bot and dashboard. No component activates live trading by default.

## Routes

Hosted base: `https://<app-domain>/functions/` (same origin on the dashboard).

- `getPublicMetrics`: GET query or POST JSON `{sort, limit}`. Sort values:
  `change24h` (default), `vol24`, `mcap`; limit 1–60 (default 15).
  `view=meta` returns the public API catalog, rate policy, schemas and examples.
- `ruFomoSignals`: GET/POST poll, or `action=logs` to read execution reports.
- `ruFomoReport`: POST sanitized execution report.

Public metrics reuse getLauncherAnalytics's exact 300-second freshness,
1,800-second stale-on-error fallback and in-isolate single-flight. Stable
descending sorts put every unknown/non-finite metric last. Scope is the same
top-60-volume cohort, not every launch. Do not imply a five-minute cache is
a globally enforced rate limit. Limits: public 120/minute per isolate,
protected 60/minute per credential per isolate; production needs an edge quota.
Return Retry-After and rate headers on 429. Protected responses are no-store.

Public metrics response: `{schemaVersion:1, at, stale, cache, scope,
sort, limit, total, data:[{mint,symbol,name,vol24,mcap,change24h}]}`.
`at` is the source snapshot time in epoch milliseconds, never request time.
HTTP error responses are `{error:{code,message}}`; never raw provider errors.

## Authentication and strategy

Use `Authorization: Bearer <operator API key>` over HTTPS. Base44 stores only
`RU_FOMO_API_KEY_SHA256` (hex SHA-256 of a high-entropy key), not a wallet key.
Hash incoming credentials and compare safely. Missing config fails closed.
Reject query-string credentials. Private entities deny direct public/client
access; backend service-role writes occur only after endpoint authorization.

`RU_FOMO_SIGNALS_ENABLED` defaults to false. Thresholds are server/operator
configuration, never supplied by untrusted request parameters:
`RU_FOMO_MIN_VOLUME_USD` (100000), `RU_FOMO_MIN_CHANGE_PCT` (10),
`RU_FOMO_MAX_CHANGE_PCT` (100), `RU_FOMO_MIN_LIQUIDITY_USD` (25000).
Invalid thresholds fail closed. Stale or expired data never produces signals.
24h price change is a momentum proxy, not measured statistical volatility.

Poll response: `{schemaVersion:1, namespace:"RU_FOMO", at, stale:false,
enabled, signals:[]}`. Each signal has `{id,mint,action:"buy",baseAsset:"SOL",
createdAt,expiresAt,reason:"volume_and_momentum",metrics:{volume24hUsd,
marketCapUsd,change24hPct,liquidityUsd}}`.
Signal ID format: `RU_FOMO:<five-minute epoch bucket>:<mint>`.
Expiry is no later than snapshot time + 300000ms. Enforce one identity per
mint/bucket. Persistence can contain duplicate records under cross-isolate
races; consumer idempotency is authoritative, not a read/write pseudo-lock.

Report body: `{signalId,mint,status,signature?,code}` with status/code enums
in `base44/shared/ruFomoContract.js`. No freeform error messages or transaction
bytes. A report must reference an issued signal. Logs are append-only reports
and explicitly not on-chain verification of the caller's claimed outcome.
Logs response: `{schemaVersion:1,namespace:"RU_FOMO",logs:[]}`.

## Operator-run bot (outside Base44 and frontend)

Node service under `services/ru-fomo-bot/`, dry-run default; no auto-funding.
Use PumpPortal Local Transaction API `https://pumpportal.fun/api/trade-local`,
NOT the Lightning wallet setup. Only public trade intent leaves the signer.
Validate unsigned transactions before signing, simulate and enforce SOL/fee
limits; wallet key lives only in the operator process environment/vault.
Limit this MVP to SOL-funded buy orders and explicitly supported Pump routes.
Unsupported/graduated routes fail closed; no automatic swap to a different pool.
Persistent local journal must prevent replay, budget overspend and ambiguous
submission retries across restarts. Record intended signature before broadcast,
reconcile unknown results rather than create and sign a replacement buy.
Reports go only to ruFomoReport; keys are not printed, sent to PumpPortal, or
embedded in API URLs. Never log raw provider responses or error objects.

Sources: https://pumpportal.fun/trading-api/setup and
https://pumpportal.fun/local-trading-api/trading-api/.