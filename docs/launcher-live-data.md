# Launcher live dashboard data

`getLauncherLive` is a separate public, read-only Base44 function. It does not
change `getLauncherAnalytics`, public metrics, entities, frontend code, or trades.
GET accepts no query parameters. SDK invocation uses POST with `{}` (an empty
body also works). Unknown parameters, including `mint`, `mints`, `sort`, and
`limit`, return 400; unsupported methods return 405; OPTIONS returns 204.

## Response contract

The JSON response contains:

| Field | Meaning |
| --- | --- |
| `at` | Coin-roster observation time, Unix milliseconds. |
| `stale` | Explicit boolean; true only when a failed rebuild uses prior data. |
| `ranked` | Entire normalized roster, descending `vol24`, stable ties, null-last. No top-60 truncation. |
| `candidateCount` | Size of the deduplicated inspection union, at most 150. |
| `statusChecked` | Candidates with at least one successfully completed curve or DEX probe. Empty/no-account results count; this is **not** the number of known statuses or a guarantee that both probes succeeded. |
| `statusError` | Null, or sorted unique codes for unavailable/invalid probes. |
| `nearThreshold` | 90, inclusive percentage threshold. |
| `sourceError` | `COINS_UNAVAILABLE` on stale responses only. |

Each row has `mint`, `symbol`, `name`, `image`, `logoUrl`, `socials`, `payoutInfo`, `vol24`, `mcap`, `liquidity`,
`change24h`, `ageH`, `metricsAt`, `curveProgress`, `status`, `curveComplete`,
and `statusAt`. Numeric metrics are finite numbers or null. Volume/cap/liquidity
must also be nonnegative. Zero and negative price changes are retained; strings,
booleans, missing values, NaN and infinity are not coerced into numbers.

Rows with a mint are retained even without a symbol or snapshot. Duplicate mints
use the first source row; entries without a nonempty string mint are discarded.
Invalid Solana mints remain visible but cannot generate upstream status requests.
An unrecognized source envelope or a nonempty feed with no usable mint rows is
unavailable, not a fabricated empty success. A genuine empty array is valid.
Supported envelopes are an array, `{coins: [...]}`, `{data: [...]}`, or
`{tokens: [...]}`. No upstream ranking or pagination filters are sent.

Age uses numeric seconds or milliseconds in `createdAt`; missing, invalid or
future timestamps produce null, not an invented new launch. HTTP(S) images only;
credential-bearing and other-protocol URLs become empty strings.

`metricsAt` preserves the upstream `snapshot.at` timestamp normalized to Unix
milliseconds. Missing/invalid/future timestamps stay null, never the fetch time.
This function cannot guarantee the upstream's own snapshot cadence. `statusAt`
is the observation time of evidence supporting a known status; an UNKNOWN row
may have a successful empty-probe timestamp. Uninspected/fully unavailable rows
have null `statusAt`. Stale responses retain all original timestamps.

## Logo and social metadata

- `image` remains the sanitized roster `image`, including an empty string when
  absent/invalid. DEX fallback never overwrites this existing field.
- `logoUrl` starts as the safe `image` alias; only an empty value can be filled
  from DexScreener `info.imageUrl`.
- `socials` always has exactly `twitter`, `telegram`, and `website`, each a safe
  HTTP(S) URL or `""`. Per field, prefer a valid `coin.socials` object value, then
  the corresponding flat `coin.twitter`, `coin.telegram`, or `coin.website`.
  Non-object/array `coin.socials` values are ignored. An invalid nested URL does
  not hide a valid flat URL. No handles are converted into invented links.
- All URLs use the same HTTP(S)-only normalization as images, rejecting embedded
  credentials and malformed/relative/other-protocol URLs. These are reported
  links, not independently verified official accounts or trusted destinations.

Only missing logo/social fields are filled from the **existing bounded DEX
batches**, and only for candidates actually included in those batches. Metadata
requires `chainId === "solana"` and an **exact `baseToken.address` match**:
DexScreener pair `info` describes the base token, never the quote token. This is
deliberately separate from the unchanged base-or-quote graduation check.

Matching pairs are preferred by descending finite numeric `liquidity.usd`;
non-numeric/non-finite values sort last without coercion. Zero or negative finite
values are still finite for metadata ordering, not graduation evidence. Ties
use a locale-independent lexical key of pair address and sanitized metadata,
so response order cannot decide the fallback. Within a pair, safe URLs of each
type sort lexically. Use `info.socials` array entries typed `twitter`/`telegram`
(trimmed, case-insensitive type) and `info.websites` array URLs. Each still-empty
field can fall back to a lower-preference pair; valid source fields always win.
An AMM allowlist/positive-liquidity status requirement is not a metadata requirement.

The currently observed `/api/coins` roster has `image` but no social fields.
Social coverage is therefore **bounded and incomplete**: uninspected rows,
quote-only matches, missing DEX info, and failed probes may have empty links.
There are no extra requests, per-token lookups, retries, or logo/social fetches.
Malformed optional metadata is ignored without making a successful status batch
unavailable. Metadata never changes metrics, ranking, status, or status timestamps.

## Source-reported payout settings (unverified)

`payoutInfo` is **null** if no valid reported payout metadata survives sanitation.
Otherwise it is an object with exactly these fields, read only from `/api/coins`:

| Field | Contract |
| --- | --- |
| `rewardMint` | Trimmed base58-shaped string (32–44 characters), or null. |
| `rewardSymbol` | Trimmed nonempty source string, or null. Never inferred from the coin symbol, DEX, or a mint lookup. |
| `rewardCycle` | Nonnegative safe integer number, or null. Numeric strings, booleans, fractions, negatives and non-finite/unsafe numbers are rejected. **0 is preserved**, not treated as missing. |
| `rewardBasket` | Array of trimmed base58-shaped mint strings (32–44 characters), deduplicated in first-source order. Non-arrays and invalid entries become/are removed to yield `[]`; objects are not converted to mints. |

Base58 shape uses `1-9`, `A-H`, `J-N`, `P-Z`, `a-k`, `m-z`; it does **not** verify
mint existence, token ownership, balances or on-chain configuration. Fields are
independently sanitized: any valid mint, symbol, cycle (including zero), or
nonempty basket makes `payoutInfo` non-null; an empty basket alone does not.
Unknown sibling fields stay null/empty, even when another field is present.
Payout metadata covers the full roster, not only the bounded DEX candidates.

The observed source exposes `rewardMint`, `rewardSymbol`, `rewardCycle` (observed
as `0`), and `rewardBasket` as mint strings. A focused public-source lookup did
not verify the meaning/units of `rewardCycle`, including what `0` means. The
frontend must treat it as an **unverified source-reported setting**, not seconds,
minutes, a disabled flag, a countdown, a payout frequency, or a guaranteed schedule.
Basket membership likewise does not establish allocation percentages, equal
splits, payout amounts, eligibility, execution, or guarantees. No token symbol
lookup, payout calculation, invented units, or inference of missing settings occurs.
Display null as unknown/unreported rather than "no rewards"; use explicit null
checks for cycles so a reported zero remains visible without assigning it meaning.

## Status evidence and bounded work

Inspect the union of top 60 by `vol24`, top 60 by `change24h` (momentum), and
newest 30 by ascending `ageH`. Rankings are finite-only/null-last, including
all-negative momentum. Overlap is deduplicated, not padded to 150. Every other
row remains UNKNOWN with null curve fields and status time.

Derive Pump's PDA from `['bonding-curve', mint]` using
`6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`. Reuse `heliusRpc` from
`otcSources.ts` for confirmed `getMultipleAccounts`, batches of at most 100,
base64 encoding and a 49-byte prefix data slice. DEX requests use the existing
DexScreener `/latest/dex/tokens/{mints}` API, batches of at most 30. There are
at most 3 concurrent probe tasks and 2 active Helius calls per handler instance.

Each probe has a 9-second deadline; the coins fetch has 15 seconds. DEX/coins
fetches are abortable. The existing Helius helper has no cancellation parameter:
a timed-out RPC keeps its capacity slot until it settles, preventing hung calls
from accumulating on later refreshes. No retries or public-RPC fallback.

Status precedence:

1. **GRADUATED** only if DexScreener reports a matching base or quote mint on
   `chainId: solana`, `dexId` exactly `pumpswap`, `raydium`, or `meteora`, a
   base58-shaped pair address and finite, positive USD liquidity. This is
   third-party AMM evidence, not an independent on-chain migration verification.
2. **ABOUT_TO_GRADUATE** if an authenticated curve account is complete, or its
   measured progress is at least 90. Complete means curve funding is finished;
   migration is still pending/unconfirmed without the AMM evidence above.
3. **BONDING** if authenticated reserves yield progress below 90.
4. **UNKNOWN** otherwise. Missing curves, missing DEX pairs, a `pumpfun` pair,
   unrecognized AMMs, malformed data, or unavailable probes do not prove graduation.

`curveComplete` is boolean only for a successfully decoded curve, otherwise null.
`curveProgress` is never manufactured from a DEX status: a graduated row can
have null (or contradictory, but faithfully observed) reserve progress.
Probe failures never fall back to previous statuses while showing fresh metrics.
Error codes are `CURVE_RPC_UNAVAILABLE`, `DEXSCREENER_UNAVAILABLE`,
`CURVE_ACCOUNT_INVALID`, `CURVE_RESERVES_INVALID`, and `INVALID_MINT`.
Raw upstream errors, credential-bearing URLs and RPC details are not returned.

## Reserve-derived quote funding (not market cap)

Verified against the [official Pump IDL](https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/idl/pump.json)
on 2026-09-06: `BondingCurve` discriminator is
`[23,183,248,55,96,216,172,96]`. The stable prefix contains five little-endian
u64s at offsets 8/16/24/32/40: virtual token, virtual quote, real token, real
quote, token supply; the completion boolean is at offset 48. Owner and
discriminator are checked before parsing; executable/wrong-owner/truncated or
invalid-boolean accounts are rejected. Later IDL fields do not shift this prefix.

Let `offsetQ = virtualQuote - realQuote`,
`terminalVirtualQ = virtualQuote * virtualToken / (virtualToken - realToken)`,
`targetRealQ = terminalVirtualQ - offsetQ`.
Then progress is `100 * realQuote / targetRealQ`, not token depletion or market
cap divided by a fixed graduation cap. Quote units cancel, so no USD/SOL price
or quote-token decimal conversion is needed.

The calculation uses bigint u64 inputs and a rational target without intermediate
division, avoiding unsafe Number conversion and multiplication overflow. Invalid
denominators, negative offsets, zero targets, or terminal reserve targets outside
u64 return null. The bounded result is truncated to four percentage decimals
(never rounded from just below 90 to 90). A valid completion flag gives 100 even
if reserves have been drained. This remains an **approximate reserve-derived
quote-funding metric**: real program quotes have integer rounding and fees, and
curve parameters can change. It is not an executable buy quote or market-cap metric.

## Cache and validation

30-second per-isolate singleflight cache, independent of analytics. Cache age
starts at coin observation, not the end of slow probes. Concurrent cold/expired
requests share one whole rebuild. Coin-source failures use prior data only
through **120 seconds total age**, checked after the failed request, not two
additional minutes after expiry. Beyond this bound (or cold) return 502 with
`error.code: COINS_UNAVAILABLE`, never an empty success. Failed rebuilds do not
renew cache age. Probe-only failures still return fresh metrics with status errors.
There is no durable/distributed cache or cross-isolate rate limiter.

Logo, social, and payout metadata share this same cache: hits/stale responses
retain the cached fields; successful rebuilds derive them anew, never carrying
missing metadata forward from a previous response. DEX outages leave roster
metadata intact and fallback fields empty without changing cache behavior.

`Cache-Control: no-store` prevents CDN/browser caching from extending freshness;
`X-Launcher-Cache` is `hit`, `miss`, `stale`, or `error`, exposed through CORS.

Offline checks: `node --test tests/launcher-live*.test.mjs`. Tests use injected
fetch/RPC/clock dependencies, real local PublicKey derivation, encoded account
fixtures, and an isolated entry wiring test (no runtime/secret imports). No live
RPC calls, deployments, trades, secret provisioning or new dependencies required.
Metadata regressions cover mapping/defaults, unsafe URLs, malformed optional
fields, payout sanitation/zero preservation, base-vs-quote matching, deterministic
liquidity fallback, unchanged request bounds, and retained hit/stale cache data.