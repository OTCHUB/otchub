# Wallet domain review submissions — otchub.dev

Updated 2026-09-09. This document holds the paste-ready submission text for
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

Submit at Phantom's dApp review form ("Request a dApp review" in the
Phantom developer portal / the security-review flow linked from the
warning). Paste-ready answers:

- **dApp URL:** https://otchub.dev
- **Contact email:** tjaygmi@gmail.com
- **dApp name:** OTC Pulse
- **What does your dApp do?**
  > OTC Pulse is a community analytics dashboard for the OTC Desks
  > protocol (otcdesks.cash): charts, holdings, treasury metrics and a
  > launcher feed. The only wallet actions are user-initiated Jupiter swaps
  > and claim calls against the official otcdesks.cash on-chain program.
  > The app never holds keys — every transaction is signed in Phantom.
- **Why should this dApp be trusted / not flagged?**
  > The domain deliberately publishes an sRFC-35 association file
  > (https://otchub.dev/.well-known/solana.txt) whose only record is
  > `solana-address=denyall` — it formally claims association with no
  > Solana mint or program, so it cannot be impersonating the token or
  > protocol it visualizes. It also publishes a standard RFC 9116
  > security.txt with a contact for responsible disclosure
  > (https://otchub.dev/.well-known/security.txt). The app displays a
  > permanent "community tooling, not affiliated with otcdesks.cash"
  > disclaimer, including inside the wallet-connect flow itself, where we
  > explain the new-dApp warning to users. The mint shown with the
  > "OFFICIAL" badge is verified against the official contract address at
  > render time.
- **Additional notes:** new dApp; no marketing claims, no token sale on the
  site, no airdrop promises, no requests for seed phrases or signatures
  outside of explicit swap/claim approval prompts.

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
3. Submit the Phantom, Solflare, and Backpack requests above.
4. At $HUB launch: swap the denyall record for real mint/program records,
   add the DNS TXT equivalent, and request Jupiter token verification.