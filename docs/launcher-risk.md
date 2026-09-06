# Launcher risk enrichment

Contract research date: **2026-09-06**. Risk enrichment is enabled by default in
`getLauncherLive`; no frontend, analytics cache, wallet, or trading change is required.

## Source and limits of evidence

- Contract: [RugCheck Swagger](https://api.rugcheck.xyz/swagger/doc.json).
- Only public **GET** `https://api.rugcheck.xyz/v1/tokens/{id}/report` is used.
  The same path's POST submits a suspicious-token report and is **never used**.
  Authenticated bulk POST `/v1/bulk/tokens/report` is also never used.
- Observed full reports contain exact `mint`, creator wallet `creator`, raw `score`,
  `score_normalised`, boolean `rugged`, `risks` (`level/name/description/value/score`),
  `topHolders` (observed sample: 20 token accounts with `address/owner/pct`), integer
  `totalHolders`, and ISO `detectedAt`. Missing/future report time becomes null.
- `creatorTokens` is absent/null in observed reports. No schema is assumed, no
  undocumented creator-history endpoint is called, and no complete history is claimed.
- HTTP success is insufficient: exact canonical 32-byte base58 mint,
  finite raw score, boolean rugged flag, and non-error payload are required.
  Optional malformed holder/creator/normalized-score data stays unknown; missing risks
  do not become an empty/no-warning assessment. No string-to-number coercion occurs.

## Every row's risk contract

`row.risk` always contains all of the following fields:

| Field | Meaning |
| --- | --- |
| `state` | `READY`, `STALE`, `UNAVAILABLE`, or `NOT_CHECKED` |
| `checkedAt`, `reportedAt` | Local successful fetch time and upstream detection time; epoch ms or null |
| `score`, `scoreNormalised` | Finite raw score; validated normalized 0..100 score; otherwise null |
| `level` | `DANGER`, `WARNING`, `NONE`, or `UNKNOWN` |
| `factors` | Bounded array of `{name, description, value, level, score}` |
| `rugged`, `deployer` | Upstream boolean and exact validated creator; otherwise null |
| `top15Pct`, `holderSampleSize`, `holderConcentrationHigh` | Gross account concentration, validated unique sample size, strict >35 flag |
| `highRisk` | True for adverse signals; false only with sufficient fresh data; null for incomplete/stale non-adverse data |
| `reputation` | `{status, evidence}`; status `MALICIOUS_REPORTED`, `SUCCESS_REPORTED`, or `UNKNOWN` |
| `error` | Safe enum below or null; never upstream body/error text |

Factor levels are `DANGER`, `WARNING` (upstream `warn` or `warning`), `INFO`, or
`UNKNOWN`. Names/descriptions/string values are limited to 128/1024/256 characters;
finite numeric and boolean values are retained, other values become null. Factor
score is finite numeric or null. Reports with more than 64 factors are rejected
rather than silently dropping a possible danger. The response body is streamed and
limited to 512 KiB before JSON parsing. Holder input is limited to 100 accounts.

**Local classification policy:** `rugged === true`, any danger factor, or a valid
normalized score **>=50** means DANGER. This 50 threshold is an application policy,
not a claimed RugCheck cutoff. Warning factors mean WARNING. An explicitly empty
risk array or only recognized INFO factors means NONE, unless a danger trigger
applies. Unrecognized/missing risks remain UNKNOWN. The raw score is unbounded and
display-only: **there is no raw-score threshold**. NONE does **not** mean safe.

`highRisk` is true for DANGER/WARNING, concentration >35, or negative reputation.
Otherwise it is false only for READY data with known level and available holder
percentage, and null when that minimum evidence is missing. UNKNOWN reputation
means no available matching evidence, not a clean or audited history.

## Holder concentration is gross token-account concentration

Accounts are deduplicated by exact `address`, not by owner, then sorted by numeric
`pct` descending. Only finite percentages in 0..100 are accepted. Identical duplicate
accounts are counted once; conflicting duplicate owner/percentage, malformed entries,
aggregate >100, or a zero total with nonempty accounts invalidate the calculation.
At least 15 unique accounts are required, unless a positive safe integer `totalHolders`
is <= the smaller nonempty sample (all available holders supplied). Missing/truncated samples stay
null; malformed total values cannot validate a short sample. No rounding precedes
the strict **>35** comparison: 35 is false, 35.01 is true.

The result includes LP, burn, and lock accounts. It is **not** 15 distinct wallets,
beneficial ownership, or proof that a creator controls those accounts. Invalid
samples report size zero; valid but insufficient samples retain their unique count.

## Reputation provenance

Two user-curated examples are built in as **mints, not hardcoded creator wallets**:

| Label | Mint | User-reported outcome |
| --- | --- | --- |
| ETF | `6sPYBcVxbudw4V2bgDrGvtAQ38mccTtcVUasEDhZ78qt` | `MALICIOUS_REPORTED` |
| pumpcat | `ANM35KbUcfKdEVBXzSjZBoT6ceSwYRs3fuc79fp7kRqP` | `SUCCESS_REPORTED` |

These are user-curated incident/success examples, **not an audit**. Both reference
reports were observed with score 1 and rugged false during contract research; ETF's
negative classification does **not** assert that its current RugCheck report is rugged.
Runtime fresh cached reports resolve the seed creators. Only exact `creator` matches
propagate evidence; never symbol, mint authority, holder, or guessed identity.

Any other fresh cached report with rugged true supplies `RUGCHECK_RUGGED` negative
evidence for its exact creator. No high-volume/low-score heuristic implies success.
Negatives override positives. Evidence entries contain `mint`, `label`, `outcome`,
`source` (`USER_REFERENCE` or `RUGCHECK_RUGGED`), and numeric `checkedAt`; the frontend
can build evidence links from these validated mints. At most 16 entries are retained.

Expired/error/mismatched seeds cannot create new cross-mint attribution. Previously
observed negative evidence for a cached row's unchanged creator may be retained for
up to 30 minutes, but marks that row STALE when no longer freshly supported. Stale
rows (including stale roster fallbacks) never carry SUCCESS_REPORTED evidence, and
non-adverse stale data has `highRisk: null`. Changed creators discard remembered
evidence. Eviction, restart, or another isolate loses this warm-cache-only history.

## Cache, scheduling, and partial coverage

- Existing 30-second live response cache and full-rebuild singleflight remain;
  five-minute analytics cache is untouched. Cache hits perform no network work,
  but re-project risk freshness so crossing a report TTL cannot preserve trust.
- One risk service per handler instance. A stage is awaited **in parallel** with
  existing curve/DEX probes, never serially afterwards. There are no background
  prefetches or detached cache-writing jobs requiring Deno to stay alive.
- At most **12 starts in any rolling 30 seconds**, including reference GETs, and
  at most **2 unsettled requests**, including body processing. Stage and default
  request deadline are **2500 ms**, not twelve separate 2500-ms waits. Monotonic
  elapsed time enforces deadlines; payload bounds constrain synchronous processing.
- Due references go first. Roughly half the remaining slots prefer launcher
  candidates; alternating reserved slots rotate across the full valid roster.
  The rotation cursor advances only on starts, not queued work. A 3000-row roster
  does not fan out into 3000 requests. Eventual attempts require continuing rebuilds,
  an available upstream, and settling requests; complete simultaneous coverage is
  not promised. Cached results attach across the roster independently of scheduling.
- Success TTL **5 minutes**, stale data maximum **30 minutes**, retry/negative TTL
  **60 seconds**. Failures preserve the last valid report, marked STALE with error.
  Cache is bounded to **512** entries with oldest-write eviction, protecting the
  two reference entries until age pruning. Evicted rows become NOT_CHECKED.
- 429 stops queued starts and sets an isolate-global cooldown of at least 60s.
  Valid Retry-After integer seconds or HTTP-date can extend it, never shorten it.
  Timeouts, 403/404/5xx, invalid reports, and network failures are independently
  cached. No upstream errors are logged or forwarded. Fixed-origin canonical-mint
  GETs use redirect rejection and no credentials or request-supplied parameters.
- Timed-out abort-ignoring fetches/streams retain slots until actual settlement;
  late completions cannot write cache or change cooldown. Clock rollback invalidates
  evidence/outstanding writes and preserves rate pressure with a minimum 60s pause.
  Invalid clock values fail unknown. Limits/history are per isolate, not a durable
  deployment-wide rate limiter or global reputation database.

`feed.riskCoverage` (top-level live response) contains `total`, `checked` (READY only),
`stale`, `unavailable`, `notChecked`, `requested`, `limited`, `nextRetryAt`.
The four state counts sum to total. `requested` counts actual starts during that
rebuild, including off-roster seeds, and is retained on response-cache hits.
`limited` indicates eligible rows remain unserved by the stage; `nextRetryAt` is
the earliest known retry/rate-window release, bounded below by global cooldown, or
null. Neither is a promise of a check at that instant. Rows without reports are not safe.

Safe errors: `INVALID_MINT`, `INVALID_REPORT`, `PAYLOAD_TOO_LARGE`, `FORBIDDEN`,
`NOT_FOUND`, `HTTP_ERROR`, `UPSTREAM_UNAVAILABLE`, `NETWORK_ERROR`, `RATE_LIMITED`,
`TIMEOUT`, `CLOCK_INVALID`, `STALE_REPORT`, `STALE_EVIDENCE`, `STALE_EXPIRED`, `FEED_STALE`.

## Exports, injection, and offline validation

`base44/shared/launcherRisk.js` exports `LAUNCHER_RISK_REFERENCES`,
`isLauncherRiskMint(value)`, `emptyLauncherRisk(state?, error?)`,
`normalizeLauncherRiskReport(report, mint, checkedAt)`, and `createLauncherRiskService(options?)`.
The service exposes async `enrich(rows, priority = rows)`, synchronous
`attach(rows, {requested, limited, forceStale}?)`, and metadata-only `inspect()`
(`cacheSize`, `activeRequests`, `rollingStarts`, `cooldownUntil`). Enrich/attach mutate
only `row.risk` and return coverage. The pure normalizer throws sanitized INVALID_REPORT.

Factory injections: `fetchImpl`, `clock` (epoch ms), `monotonicClock` (elapsed ms),
`budgetMs=2500`, `timeoutMs=2500`, `maxRequests=12`, `concurrency=2`, `maxEntries=512`.
Numeric knobs are capped at these production ceilings; maxRequests may be zero for
offline legacy tests, other minima are 1 (capacity minimum 2). No timers/network
start on construction. Handler injections add `riskOptions` and optional `riskService`
(must implement enrich/attach); handler-owned fetch/clock override those in riskOptions.

Regressions live in `tests/launcher-live.test.mjs`. Legacy metric fixtures explicitly
set maxRequests to zero; new integration tests exercise the real enabled service and
stub coins, DEX, and RugCheck hosts. Run `node --test tests/launcher-live.test.mjs`,
then `node --test tests/*.test.mjs`, `npm run lint`, and `npm run build` from the repo.
These offline fixtures validate behavior, not future live upstream schema stability.