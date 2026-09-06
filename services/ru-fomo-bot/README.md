# RU_FOMO operator bot — restricted MVP

**Dry-run is the default. This is not an audited trading system or a promise of
profit, successful fills, or cross-host exactly-once execution.** No wallet is
generated or funded by the service. Run it on a trusted, single-operator POSIX host
with Node **22.13+** (built-in `node:sqlite`; Node 24 LTS recommended) and the
repository's existing installed Solana dependencies. No additional dependencies.

## Start and test

From the repository root, provision configuration through the operator's process
manager/environment or a vault that injects environment variables. Do not put
secrets in CLI arguments, shell history, frontend `VITE_*`, Base44, source files,
screenshots, support messages, or logs. This service does not read `.env` files.

<augment_code_snippet mode="EXCERPT">
````sh
node services/ru-fomo-bot/main.mjs
node --test tests/ru-fomo-bot-*.test.mjs
````
</augment_code_snippet>

Tests use mocked HTTP/RPC, generated ephemeral test identities, and isolated
directories beneath the test process's `TMPDIR` / `TMP` / `TEMP`. They never call
real PumpPortal or broadcast transactions. Importing `main.mjs` does not start it.
Offline API/UI/bot regressions, lint and build were executed during integration.
These checks do not verify hosted authorization/RLS or live PumpPortal compatibility.

## Environment contract

All numeric inputs are **base-10 integer strings**, not SOL decimals. One SOL is
1,000,000,000 lamports; slippage is basis points (100 bps = 1 percent). Bad/missing
live bounds fail closed. Only the exact string `true` enables live mode.

| Variable | Requirement / bound |
| --- | --- |
| `RU_FOMO_BASE_URL` | Required; operator-approved HTTPS URL ending exactly `/functions/`; no userinfo, query, fragment or non-443 port |
| `RU_FOMO_ALLOWED_ORIGIN` | Required; explicit trusted HTTPS origin, equal to the base origin, with no path beyond `/` |
| `RU_FOMO_API_KEY` | Required bearer secret; 32–512 URL-safe characters; backend stores its SHA-256, not wallet credentials |
| `RU_FOMO_LIVE` | Absent or `false` = dry-run; `true` = explicitly armed live |
| `RU_FOMO_STATE_DIR` | Optional absolute private local directory; default `services/ru-fomo-bot/state`; existing parent required |
| `RU_FOMO_POLL_MS` | Optional 5,000–300,000; default 15,000 |
| `RU_FOMO_ALLOWED_MINTS` | Required nonempty comma-separated canonical mint allowlist in live; maximum 60; no wrapped SOL or system address |
| `RU_FOMO_WALLET_PUBLIC_KEY` | Live required; sole payer/signer public key, must match operator secret |
| `RU_FOMO_RPC_URL` | Live required trusted mainnet HTTPS RPC; query credential permitted here only; never logged |
| `RU_FOMO_SECRET_KEY_JSON` | Live required **only in the operator signer process**: JSON array of 64 integer bytes; never sent to any server |
| `RU_FOMO_BUY_LAMPORTS` | Live required, 1–100,000,000; dry default 1,000,000 |
| `RU_FOMO_MAX_TRADE_LAMPORTS` | Live required all-in reservation, at most 200,000,000; dry default 3,000,000 |
| `RU_FOMO_DAILY_LAMPORTS` | Live required UTC-day budget, at most 1,000,000,000; dry default 10,000,000 |
| `RU_FOMO_RESERVE_LAMPORTS` | Live required minimum wallet remainder, 1,000,000–10,000,000,000; dry default 10,000,000 |
| `RU_FOMO_MAX_FEE_LAMPORTS` | Live required network fee cap including priority, 5,000–1,000,000; dry default 100,000 |
| `RU_FOMO_PRIORITY_FEE_LAMPORTS` | Optional 0–995,000; default 10,000; priority + 5,000 must fit fee cap |
| `RU_FOMO_SLIPPAGE_BPS` | Live required 1–500; dry default 100 |
| `RU_FOMO_COOLDOWN_MS` | Live required per-mint reservation cooldown, 300,000–604,800,000; dry default 3,600,000 |

Buy input + network fee cap + **1,000,000 lamports creator-vault rent headroom**
must fit the per-trade reservation, which must fit the daily budget. Before
signing, the wallet must cover reserve + the full per-trade reservation. Pump
trading fees are included in `spendable_sol_in`, not added to the buy input.
Dry-run needs no RPC URL, wallet, or private key; it polls and reports intent,
**not transaction simulation or proof that a live trade would work**. With no
dry-run allowlist it can report any otherwise-valid issued SOL buy signal.

## Signing boundary and supported variant

PumpPortal receives only public intent at its fixed `/api/trade-local` endpoint:
`action=buy`, `denominatedInSol="true"`, amount in SOL, slippage in percent,
priority fee in SOL, `pool=pump`. The bearer goes only to the validated RU_FOMO
base's `ruFomoSignals` and `ruFomoReport`. All HTTP redirects are rejected.

The unsigned transaction is **untrusted**. Supported transactions are canonical
v0 messages, <=1,232 bytes, no lookup tables, exactly the expected sole signer
and payer, exactly 17 unique static accounts, and exactly three instructions:

1. Compute-unit limit, <=300,000; no accounts.
2. Compute-unit price; no accounts; rounded-up fee bounded locally.
3. Pump `buy_exact_sol_in`, exactly the IDL's 16 accounts in order, 25 data bytes:
   discriminator, exact configured u64 SOL input, positive u64 minimum output,
   `OptionBool(false)`. Extra accounts/instructions/bytes are rejected.

PDA/account order and privileges are verified, not just program IDs. The global
fee recipient must be the **primary** recipient in on-chain Global. The mint
must be legacy SPL Token (no mint/freeze authorities). Buyer and bonding-curve
ATAs, creator vault, fee configuration, and volume-accumulator bindings are
verified against trusted RPC state. Buyer/curve token accounts must already be
initialized, unfrozen, non-native, and free of delegates/close authorities.
Curve data must be the current 115-byte layout, incomplete, normal/non-cashback,
native-SOL quote (`Pubkey::default()`); Global buyback bps must be zero.

**Not supported:** old `buy`, v2 buys, Token-2022, ATA creation, account extension,
missing user-volume accumulator, missing/unfunded creator vault, buys needing
extra buyback/shareholder accounts, mayhem/cashback, graduated/PumpSwap/Raydium,
WSOL wrapping, tips, additional SOL transfers, approvals/authority changes,
sells, bundles, automatic pool fallback or funding. An ordinary PumpPortal
response may therefore be rejected. Do not loosen validation to force a fill.

Unsigned simulation uses `sigVerify=false`, no replacement blockhash, and
post-account data. Balance/fee/simulation snapshots must have exactly the same
slot, otherwise rejection; a slow/load-balanced RPC may reject frequently.
Simulation must succeed, fit compute and debit bounds, retain SOL reserves,
and credit the correct token account. Decoded minimum output must be at least
`ceil(simulated_credit * (10000 - slippage_bps) / 10000)`. A private one-use
approval expires within two seconds and binds the exact bytes before signing.
RPC send uses preflight and `maxRetries=0`. Signing is in `signer.mjs`, never
imported from `src` or Base44. Only a public signature is persisted/reported.

## Durability and recovery

State is local SQLite (FULL synchronous), private directory 0700/files 0600,
with no symlink/hardlink files or unsafe ancestors. Process umask stays 0077.
An exclusive SQLite transaction in `operator-lock.sqlite` owns the process lock;
the OS releases it on exit/crash. A separate journal commits atomic reservations.
Use one canonical state directory, host, wallet and process; never use NFS,
multiple copied journals, separate state directories for the same wallet, or a
concurrently active manual wallet. **There is no cross-host exactly-once claim.**
Keep the state directory out of Git, cloud sync, frontend builds and deployment.

Dry/live journals are separate; switching live does not inherit dry-run replay
state. Live identity is bound to its wallet. Reservations consume the maximum
per-trade budget and start cooldown even when rejected; no automatic refunds.
Signal IDs never replay within that journal. Clock rollback fails closed.
The locally derived signature is committed **before** broadcast. A crash after
reservation but before signature burns the reservation; after signature it
reconciles that signature only. Null/error/processed/confirmed-only statuses
block all new buys indefinitely, including new days and mints. Only finalized
success/failure clears the block; old-day settlement also charges its new day.
No automatic rebroadcast, replacement signing, or journal reset exists.

SIGINT/SIGTERM stops new reservations and signing, including work returning from
an in-flight poll or validation. An already-journaled submission finishes its
normal success/unknown path. Clock rollback during validation halts before signing.

If a signature was never sent, the block may require manual investigation even
after blockhash expiry. Stop the service, independently investigate the stored
signature and wallet using trustworthy archival RPC, preserve the journal, and
review recovery with the operator. Do not delete state just to resume buying.

Each HTTP request has one attempt, 10-second end-to-end deadline and a response
size cap (trade 1,232 bytes; reports 8 KiB; polls/RPC 256 KiB). Polling continues
at its bounded cadence. 429 pauses all requests for Retry-After seconds/date
(at least one second). If the server asks for more than five minutes, the service
stops for operator review rather than retrying early. Invalid/missing values use
15 seconds. Reports use a durable outbox, at most three
attempts, five-minute spacing and ten per cycle. A lost HTTP acknowledgement may
duplicate an append-only report, not a buy. After three failures reports remain
locally retained for operator investigation. Logs contain shared enum codes only.

## Trust, risk and sources

Trust the operator host, installed dependencies, approved API origin/TLS/DNS,
trusted mainnet RPC, and deployed Pump/fee/SPL/system programs. The RPC can lie;
simulation is not independent chain verification, does not guarantee execution,
and cannot eliminate market movement or upgrades between simulation and landing.
Use a dedicated small hot wallet; never your treasury. JavaScript/environment
strings cannot be reliably erased; host/root access or memory dumps compromise
the wallet. Vault-to-environment injection is supported; direct hardware/vault
remote signing and encrypted-at-rest secret storage are not implemented here.
Reports are claims, not proof of finality from the backend's perspective.

Reviewed read-only on 2026-09-06 (no live transaction requests during development):
- [PumpPortal Lightning setup — explicitly NOT used](https://pumpportal.fun/trading-api/setup)
- [PumpPortal Local Transaction API](https://pumpportal.fun/local-trading-api/trading-api/)
- [Official Pump IDL](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json)
- [Official native-SOL quote/layout announcement](https://github.com/pump-fun/pump-public-docs/blob/main/README.md)
- [Official Pump program](https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_PROGRAM_README.md)
- [Official buy variants](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/BUY.md)

No IDL is downloaded/executed at runtime. Any upstream change requires code
review and new adversarial fixtures. Live compatibility is deliberately not
claimed until the narrow variant passes offline tests and operator review.