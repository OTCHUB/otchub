# Wallet domain review submissions — otchub.dev

Updated 2026-09-24. This document holds the paste-ready submission text for
each wallet's domain/security review. It now references the two standard
verification files served on every published domain of the app:

- `https://otchub.dev/.well-known/security.txt` — RFC 9116 security.txt
  (responsible-disclosure contact, policy, expiry).
- `https://otchub.dev/.well-known/solana.txt` — sRFC-35 Address/Domain
  Association Specification (see
  https://forum.solana.com/t/srfc-35-address-domain-association-specification/3155).
  Its single record `solana-address=denyall` states that this domain
  deliberately associates itself with **no** Solana mint, program, or
  address: the site is community tooling over the third-party
  otcdesks.cash protocol and claims no ownership of any on-chain address.
  This record takes precedence per the spec and is the strongest possible
  anti-impersonation signal.

When the $HUB token/program launches on mainnet, **replace** the
`denyall` line with real association records, e.g.:

```
solana-mint-address=<$HUB_MINT> allow network=mainnet
solana-program-address=<$HUB_PROGRAM_ID> allow network=mainnet
```

(and mirror the same records as DNS TXT records at the registrar — the
sRFC-35-recommended primary channel; the file is the secondary channel).

Do not do this before the stealth launch is public: publishing the mints in
a public well-known file would break stealth.

---

## Facts shared by every submission

- **Website:** https://otchub.dev (this dashboard is also published at
  https://otchubdev.base44.app; both serve identical content).
- **What it is:** a read-mostly community analytics dashboard for the OTC
  Desks (otcdesks.cash) protocol: market/liquidity charts, NFT holdings
  gallery, treasury/pot metrics, and a launcher-ecosystem feed.
- **Wallet interactions (only user-initiated):** swap quotes executed
  through the Jupiter aggregator, and claim/distribute calls against the
  official otcdesks.cash on-chain program.
- **Key custody:** none. The app never touches private keys, seed phrases,
  or signatures; every transaction is built for simulation, shown to the
  user, and signed in the wallet itself (wallet-standard / injected
  providers). Signed bytes are validated against the simulated message
  before broadcast — a changed or unsigned transaction is refused.
- **Affiliation:** the app is NOT affiliated with, endorsed by, or
  maintained by otcdesks.cash. This disclaimer is permanently visible in
  the app header/footer, the boot screen, and a dedicated banner inside the
  wallet-connect UI explaining the "new dApp" verification warning.
- **Security contact:** security.txt above; contact mailto on file.

---

## Phantom — dApp review request

Phantom's only submission channel (confirmed from their live docs page,
[Domain and transaction warnings](https://docs.phantom.com/developer-powertools/domain-and-transaction-warnings),
2026-09-24) is this Google Form — there is no separate "developer portal"
review flow:

**https://docs.google.com/forms/d/1JgIxdmolgh_80xMfQKBKx9-QPC7LRdN6LHpFFW8BlKM/viewform**

It must be submitted by the project team (not a user), and its fields are
fixed — paste-ready answers below map 1:1 to the actual form questions:

- **Project Name:** OTC Hub (site title/branding: `OTC_HUB`)
- **Describe your dApp:**
  > OTC Hub is a community-built (unofficial) analytics dashboard and
  > toolset for the OTC Desks protocol (otcdesks.cash) on Solana: market
  > charts, NFT holdings gallery, treasury/pot metrics, a launcher-ecosystem
  > feed, and (via the `/hub` route) a companion $HUB protocol for staking
  > and desk activation. The only wallet actions are user-initiated Jupiter
  > swap quotes and claim/distribute/activate calls against the official
  > on-chain programs. The app never holds keys — every transaction is
  > built client-side, pre-simulated against our own RPC, and only then
  > sent to the wallet for the user's own signature.
- **dApp website URL:** https://otchub.dev
- **Your Name:** *(fill in — the person submitting on behalf of the team)*
- **Your E-mail:** tjaygmi@gmail.com
- **Transaction Link:** *(required — see "Before submitting" below)*
- **Team Information:** https://github.com/OTCHUB — public org for this
  project's repos.
- **Social Media Handles:** X: https://x.com/otchubdev · Telegram (own
  community bot): https://t.me/otchubSol_bot · Telegram (official OTC
  community, not ours but where the project is discussed):
  https://t.me/otcdesksofficial
- **Repository Links:** https://github.com/OTCHUB/otchub ·
  https://github.com/OTCHUB/hubconnect
- **Community vouch (optional):** leave blank unless a known Solana dev
  agrees to vouch — per Phantom's Blowfish-era guidance this can fast-track
  review, but is not required.
- **Any additional information:**
  > The domain publishes an sRFC-35 association file
  > (https://otchub.dev/.well-known/solana.txt) whose only record is
  > `solana-address=denyall` — it formally claims association with no
  > Solana mint or program, so it cannot be impersonating the token or
  > protocol it visualizes. It also publishes a standard RFC 9116
  > security.txt with a responsible-disclosure contact
  > (https://otchub.dev/.well-known/security.txt). The app displays a
  > permanent "community tooling, not affiliated with otcdesks.cash"
  > disclaimer, including inside the wallet-connect flow, where we explain
  > the new-dApp warning to users. Every transaction is simulated
  > (`sigVerify: false`) against our own RPC before it is ever shown to the
  > wallet, requires exactly one signer (the connected wallet — no
  > additional keypairs), and is signed via `solana:signTransaction`
  > (never `signAndSendTransaction`), matching Phantom's own transaction-
  > simulation-warning guidance.

### Before submitting: the "Transaction Link" field is required

Phantom's form will not accept a submission without a Solscan link to an
**actual transaction** that triggered the warning. This means someone on
the team must:

1. Connect Phantom to https://otchub.dev (or `/hub`).
2. Trigger the flow that shows the warning (e.g. a claim, swap, or `/hub`
   stake/activate action) and go through with signing + sending it.
3. Copy the resulting signature's Solscan URL
   (`https://solscan.io/tx/<signature>`) into the form.

There is no way to pre-fill this field — it has to come from a live
reproduction, so this is the one manual step before the form above can be
submitted.

### Why Phantom might show "Unable to simulate" / "This dApp could be malicious"

Per Phantom's own docs, this warning fires when Phantom's own RPC-side
simulation of the transaction is inconclusive before signing — it is a
transaction-content check, separate from the domain-reputation "new/
unreviewed domain" warning. Their documented causes and this codebase's
current status against each:

| Phantom's cause | Status in this codebase |
|---|---|
| Transaction requires more than one signer | ✅ Every claim/swap/activate tx has exactly one signer (the connected wallet); no extra `Keypair`/`partialSign` is used (`src/lib/otcClaim.js`, `src/hub/lib/*.ts`). |
| Using `signAndSendTransaction` instead of `signTransaction` first | ✅ The primary flow (`src/lib/walletSigner.js`, `src/hub/lib/wallets.ts`) signs via `solana:signTransaction` / injected `signTransaction`, then broadcasts through our own relay — `signAndSendTransaction` is only used as a narrow fallback for specific mobile wallets in the Jupiter swap panel. |
| Transaction not pre-simulated (`sigVerify: false`) before the sign prompt | ✅ Already done: `otcClaim.js` (`simulate`/`simulateMany`), `src/hub/lib/swap.ts`, `src/hub/lib/consolidate.ts`, and `ConsolidateBar.jsx` all call `connection.simulateTransaction(tx, { sigVerify: false })` (or the relay equivalent) and skip/refuse to sign anything that fails. |
| Transaction approaching Solana's size limit (no Address Lookup Tables) | ✅ Audited 2026-09-24. `packTxs`/`packPairedTxs` in `otcClaim.js` dynamically measure `serializeMessage().length` and cap each tx at a 1000-byte soft target (~230 bytes of margin below the 1232-byte hard limit) — measured against the actual instruction builders, even the worst case (a desk 8 rounds behind: 8 distributes + claim + Lighthouse assert in one tx) is only ~812 bytes message / ~877 bytes full tx. Compute units are similarly nowhere near the cap (worst case ~455k of the 1,000,000-unit budget). ALTs are not needed at current instruction sizes. The audit did surface two latent bugs in the packing logic's overflow handling (an instruction could be silently dropped in `packTxs`, and a spurious empty no-op tx could be emitted in `packPairedTxs`) — both fixed in the same pass so an oversized item is never lost and never causes a wasted signature. |

### Confirmed 2026-09-24: this IS the transaction-simulation warning, on the claim tx specifically

Live report: swap panel (Jupiter) shows no warning; the claim portal is
hard-blocked with "Request blocked — This dApp could be malicious." Per
[Phantom's own docs](https://docs.phantom.com/developer-powertools/domain-and-transaction-warnings),
this exact message **is** the transaction-simulation warning above, not a
separate domain-reputation tier — it fires per transaction, based on
whether Phantom/Blowfish's simulator can confidently predict that specific
transaction's outcome. That explains the swap/claim split perfectly:
swap routes through Jupiter, a program Blowfish already recognizes and
models; claim calls the `otcdesks.cash` program
(`AjMx5My4YUDHMiCtLpTAtgkiUJgrpJnQqd5AcQnddHQW`), which Blowfish has never
seen. When its simulator can't attribute what an unfamiliar program does
to a vault/user token account, it falls back to "unable to safely predict
outcome" → the malicious warning. (The Lighthouse assertion instruction is
not the likely culprit — it's a widely-used, well-known safety-check
program already integrated into `@blowfishxyz/safeguard` itself, which
even defines a specific `MISSING_LIGHTHOUSE_PROGRAM_CALL` check expecting
it to be present.) This is a known, common false positive for any new
Solana program: two directly comparable cases —
[`game.just2more.fun`](https://github.com/blowfishxyz/blocklist/issues/183)
and [`eyezon.gg`](https://github.com/blowfishxyz/blocklist/issues/186) —
hit the identical warning for the identical reason (unfamiliar
program/new domain) and got it resolved by filing a GitHub issue directly
against Blowfish's own blocklist repo.

### Filed 2026-09-24: `blowfishxyz/blocklist` false-positive report

**Status: submitted.** Filed via the GitHub API against Blowfish's own
blocklist repo:

**https://github.com/blowfishxyz/blocklist/issues/189**

The issue body includes the real reproduction Solscan link
(`4rX9kaBh...`), the flagged program ID
(`AjMx5My4YUDHMiCtLpTAtgkiUJgrpJnQqd5AcQnddHQW`), the six-transaction
on-chain evidence table (954-byte raw / 889-byte message, 62–66% CU
headroom, `err: null` across all six), and a link to the public
`https://github.com/OTCHUB/otchub` repo (`src/lib/otcClaim.js`
specifically) so Blowfish's team can review the actual client-side
transaction-building code, not just our description of it.

If the warning reproduces even on a simple, single-instruction action (a
Jupiter swap, or a single-ticker claim), that points away from tx content
and back to unreviewed domain reputation — in which case the Google Form
submission above (with that transaction's Solscan link attached) is the
correct next step. Both channels (Blowfish GitHub issue + Phantom form)
can be filed in parallel; Phantom does not expose a way to self-clear
this warning from the app side.

### Direct follow-up email to Phantom (William) — evidence dossier

Use this if there's already a live thread/ticket with Phantom support (e.g.
a named contact like William) rather than starting fresh via the Google
Form. It leads with concrete on-chain data rather than re-explaining the
theory already covered above.

> **Subject:** Re: otchub.dev claim portal — "This dApp could be malicious"
> false positive (evidence attached)
>
> [REDACTED — internal draft email removed from public history]

## Solflare — site review request

Solflare flags new dApps similarly; submit via their site/brand review form
(or support ticket). Paste-ready:

- **URL:** https://otchub.dev
- **Request type:** website verification / false-positive review of the
  security warning
- **Message:**
  > Please review https://otchub.dev — a community analytics dashboard for
  > the OTC Desks protocol. The site does not issue tokens and publishes an
  > sRFC-35 `solana-address=denyall` record
  > (https://otchub.dev/.well-known/solana.txt) explicitly declaring no
  > association with any Solana mint or program, plus an RFC 9116
  > security.txt (https://otchub.dev/.well-known/security.txt) with a
  > responsible-disclosure contact. All wallet interactions are
  > user-initiated: Jupiter swaps and claims on the official otcdesks.cash
  > program. Keys never leave the wallet. The site is clearly labeled
  > community tooling, not affiliated with otcdesks.cash. Could the
  > "unverified site" warning be reviewed?

## Jupiter — wallet & token verification

Jupiter's wallet does not run a per-site domain review, but the same two
files serve its token-verification pipeline (station.jup.ag / token API),
which reads sRFC-35 records:

- **Now:** the `solana-address=denyall` record tells Jupiter the domain
  issues no tokens — no verification action is needed pre-launch.
- **At $HUB launch:** replace the denyall record with
  `solana-mint-address=<$HUB_MINT> allow network=mainnet` (and mirror it as
  a DNS TXT record), then request the token listing/verification at
  https://station.jup.ag — the domain association file is part of their
  verification checklist.

## Backpack — site review request

Same pattern as Solflare:

- **URL:** https://otchub.dev
- **Message:**
  > Requesting a review of the security warning shown for
  > https://otchub.dev, a read-mostly community analytics dashboard for
  > the OTC Desks protocol. The domain publishes sRFC-35 and RFC 9116
  > well-known files (solana.txt with a deny-all association record, and a
  > security.txt with a disclosure contact). Only user-initiated Jupiter
  > swaps and otcdesks.cash program claims are signed; the app holds no
  > keys and claims no affiliation with the protocol it visualizes.

---

## Deployment checklist (after publishing the app)

1. Verify the files resolve on both domains:
   - https://otchub.dev/.well-known/security.txt
   - https://otchub.dev/.well-known/solana.txt
   - https://otchubdev.base44.app/.well-known/security.txt
   - https://otchubdev.base44.app/.well-known/solana.txt
2. (Recommended, sRFC-35 primary channel) add a DNS TXT record at the
   otchub.dev registrar: value `solana-address=denyall`.
3. Reproduce the warning once to get a Solscan transaction link, then
   submit the Phantom form above (it will reject submission without one).
   Also submit the Solflare and Backpack requests.
4. At $HUB launch: swap the denyall record for real mint/program records,
   add the DNS TXT equivalent, and request Jupiter token verification.