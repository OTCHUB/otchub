# $HUB Protocol — Tokenomics Specification

**Version:** 0.9 (community draft) · **Date:** 2026-09-07 · **Status:** PRE-LAUNCH DRAFT
**Scope:** Spec only. No app UI in this round.

> **DISCLAIMER — COMMUNITY TOOLING.** $HUB is a community-built token and staking
> layer. It is **not affiliated with, endorsed by, or built by the OTC protocol
> team**. All OTC protocol mechanics described here were verified by public
> on-chain inspection and public web pages, and may change without notice.
> Nothing here is financial advice. Verify every constant on-chain before
> committing capital.

---

## 1. Intent

$HUB is a stake-to-earn layer for **existing OTC desk NFTs**. It harvests two
fee engines that already exist in the OTC ecosystem — the **launcher's creator-fee
engine** and the **desk pot's distribution rounds** — and routes the proceeds to
desk owners who activate tiers, with a deflationary buyback-burn sink and a
treasury desk flywheel.

**Design principles (in priority order):**

1. **Not greedy** — $HUB takes nothing from other OTC participants; it *adds*
   buy pressure (reward stock = OTC), grows desk-pot funding (launcher's 10% leg),
   and sells desks back to the community at a discount.
2. **Better yield for desk owners** — every stream lands with activated desks,
   weighted by tier.
3. **Deflationary by construction** — 10% of every pot inflow burns $HUB; every
   treasury desk exit burns $HUB; tiers are burn-based, so supply only shrinks.
4. **Evidence-first** — every constant below is parameterized and must be
   re-verified on-chain before launch (checklist in §11).

---

## 2. Verified Foundations

All items below were verified from public sources (see §12 for the re-verification
protocol). Facts as of **2026-09-07**.

### 2.1 The launcher fee engine (source: otcdesks.cash/launcher launch form)

> *"Launch a coin whose creator fees buy tokenised stock for the people holding it."*

**Where the fees go (fixed by the launcher, not by us):**

| Recipient | Share | Meaning for $HUB |
|---|---|---|
| **Holders, in stock** | **67.5%** | $HUB creator fees **buy OTC** and distribute to $HUB holders pro-rata |
| **OTC desk pot** | **10%** | $HUB volume funds *all* desk holders' pot rounds |
| OTC buybacks | 10% | Buys OTC on the open market and burns it — eco support |
| OTC protocol | 5% | Servers, database, APIs and infrastructure |
| OTC holders | 5% | Paid in SOL every 12h to wallets holding $20+ of $OTC — a protocol-wide stream, not $HUB-specific |
| Account rent | 2.5% | Opens the token accounts the OTC-holder payout above is paid into |
| Launcher (us) | 0% ("Nothing to you, the launcher") | $HUB extracts nothing for the treasury here |

Key consequences:

- **Every $HUB trade is direct OTC buy pressure.** Choosing reward stock = OTC
  is the deliberate eco-alignment decision (see §3).
- **The 67.5% leg is holder-pro-rata, per wallet — it cannot be routed to a central
  pot.** This is why $HUB tiers are *burn*-based, not lock-based (see §5.2).
- **Launched coins join the reward-stock rotation** (verified: $PONS, a launcher
  coin, now appears in the selectable stock list). Once $HUB is launched, future
  launches may select $HUB as their reward stock — **their** creator fees then buy
  $HUB from the open market. This is the inbound extraction channel (§7).

### 2.2 The desk pot (source: otcdesks.cash stats + on-chain pot account)

- Desk pot distributes the **13-stock desk rotation** pro desk, per round
  (verified against the on-chain IDL stock list and the public ledger).
- Lifetime desk-channel distribution: **≈ 2,570 SOL** over **2,487 rounds**.
- Latest closed day (2026-09-06): **0.1443 SOL/desk/day**; trailing 7-day
  average **0.1464 SOL/desk/day**.
- Desk-pot inflow that day: mints 166.5 SOL + ME royalties 52.9 SOL +
  launchpad share 121.5 SOL + sweeps 2.1 SOL.
- Headline protocol distribution (6,090 SOL) splits ≈ **74% launcher-side /
  26% desk-side** — the launcher economy is where the fees are, which is exactly
  why $HUB launches *through* it rather than around it.

### 2.3 Desk market (source: live snapshot 2026-09-07 05:40 UTC)

| Metric | Value |
|---|---|
| Desks minted | 2,221 |
| Listed (Magic Eden) | 56 |
| Floor | 6.41 SOL (≈ $676) |
| True buyer cost on secondary (incl. 2% taker + 5% royalty) | 6.86 SOL |
| Mint cost (100k OTC + 0.5 SOL surcharge) | 14.98 SOL |
| **Sweep-vs-mint spread** | **8.12 SOL per desk (sweep is ~54% cheaper)** |

> **This spread is the treasury flywheel's fuel.** While it holds, the treasury
> buys existing desks instead of minting — adding **zero dilution** to the desk
> pot and taking a listed desk off the market (floor support).

### 2.4 Market context at draft time

OTC itself is in a violent expansion: +100% (24h) to $0.01529 on **$7.44M** 24h
volume, $547k liquidity, ≈ $10.9M mcap. A $HUB launch into this tape maximizes
early creator-fee capture *and* the OTC-bought-as-reward effect.

---

## 3. $HUB Launch Configuration

Launched **via the OTC launcher** (https://otcdesks.cash/launcher):

| Parameter | Value | Rationale |
|---|---|---|
| Name / ticker | Hub / **$HUB** | |
| **Reward stock** | **OTC** | Every $HUB trade's creator fees buy OTC for $HUB holders — maximum eco coupling; $HUB volume becomes OTC buy pressure |
| Launcher's own share | **None** (0%) | "Not greedy" made literal; the 67.5/10/10/5/5/2.5 split is the treasury's take |
| First buy | Small, optional (0.5–1% of curve) | Bootstraps holder alignment; nothing can front-run it |
| Socials | OTC Hub dashboard links | Transparency: all analytics public |

**Post-launch requirement:** confirm $HUB appears in the reward-stock rotation
(PONS precedent). If it does, $HUB becomes selectable by future launches (§7).

---

## 4. Tier System — Desk Activation

Tiers are **bound to an existing OTC desk NFT**, not to a wallet balance. One
desk = one tier. Tiers only ever upgrade (pay the difference between steps).

| Tier | Weight | Cumulative cost | Cumulative to pot (90%) | To ops (10%) |
|---|---|---|---|---|
| T1 · BRONZE | 1.00x | 0.5 SOL | 0.45 SOL | 0.05 SOL |
| T2 · SILVER | 1.25x | 1.0 SOL | 0.90 SOL | 0.10 SOL |
| T3 · GOLD | 1.60x | 1.5 SOL | 1.35 SOL | 0.15 SOL |
| T4 · DIAMOND | 2.00x | 2.0 SOL | 1.80 SOL | 0.20 SOL |

Constants (all parameterized, re-verify at launch): `TIER_STEPS = 4`,
`STEP_FEE_SOL = 0.5`, `POT_SHARE = 0.90`, `OPS_SHARE = 0.10`,
`WEIGHTS = [1.00, 1.25, 1.60, 2.00]`.

**Why 0.5 SOL/step:** at the current desk take (0.144 SOL/desk/day), T1's 0.45 SOL
pot contribution is repaid to the *pool* in roughly 3 desk-days of treasury-swept
yield per activated desk (see §6.3) — the fee is heavy enough to filter serious
desks, light enough to pay back fast.

### 4.1 Desk binding — lazy revocation

- A tier is recorded against the desk's **asset id** (Metaplex Core).
- **Every claim and every upgrade re-verifies on-chain ownership** of the desk
  NFT via Metaplex Core / DAS lookup. No webhooks, no cached ownership as source
  of truth.
- A desk that was sold or transferred is **silently de-weighted at its next
  claim**: the claim instruction checks current owner; if the caller no longer
  owns the desk, the claim reverts and the tier is voided (burned $HUB stays
  burned — no refunds, by design).
- **Claim-before-list warning** (community tooling, not protocol-enforced):
  the OTC Hub dashboard flags listed desks with unclaimed yield ≥ 0.02 SOL:
  `⚠ UNCLAIMED YIELD — CLAIM BEFORE SELLING`.

---

## 5. The $HUB Yield Engine

### 5.1 Pot inflow sources

| # | Source | Mechanism | Est. scale (live) |
|---|---|---|---|
| A | **Activation fees** | 0.45 SOL × each tier step taken | One-off, front-loaded at launch |
| B | **Treasury desk yield** | Treasury-owned desks claim desk-pot rounds (13-stock rotation); proceeds → pot | 0.144 SOL/desk/day × desks swept |
| C | **Treasury OTC-stock claims** | Treasury's HUB float claims its pro-rata 67.5% launcher leg (paid in OTC); OTC sold → pot | Scales with $HUB volume |
| D | **Discount-exit SOL leg** | 50% SOL half of every treasury desk sale → pot | Episodic |

### 5.2 Distribution — burn, don't lock

```text
epoch_yield_i  = (w_i / Σ w_j) × 0.90 × pot_inflow_epoch        [SOL]
buyback_burn   =              0.10 × pot_inflow_epoch           [SOL → buy $HUB → burn]
```

- One epoch = 24h (parameter `EPOCH_HOURS = 24`). Unclaimed yield rolls to the
  next epoch.
- **Why burn-based tiers:** the launcher's 67.5% leg pays **per wallet, pro-rata
  on HUB held**. Locked HUB in an escrow would likely *miss* that stream; burned
  tiers never conflict with it. Stakers therefore hold $HUB in their own wallet
  (earning launcher OTC distributions directly, §5.3) and *burn* for tier weight
  on the pot streams.
- Staker yield is thus **dual-stream**: (1) launcher OTC stock, per wallet, no
  tier needed; (2) pot yield + bonus streams, per tier weight.

### 5.3 The launcher leg — direct to holders

For $HUB 24h volume `V` (SOL) and creator-fee rate `f` (verify at launch; the
launcher sets it per coin):

```text
daily_creator_fees = f × V
→ holders (bought OTC):  0.675 × f × V     [distributed pro-rata to $HUB wallets]
→ desk pot:              0.10  × f × V     [funds ALL desks — HUB's gift to the eco]
→ OTC buybacks:          0.10  × f × V     [buys OTC on the open market and burns it]
→ OTC protocol:          0.05  × f × V     [servers, database, APIs, infrastructure]
→ OTC holders:           0.05  × f × V     [paid in SOL every 12h to $20+ $OTC wallets, not HUB-specific]
→ account rent:          0.025 × f × V     [opens the OTC-holder payout token accounts]
```

Worked example, `f = 0.25%` (placeholder — verify), `V = 50,000 SOL`:
holders receive **84.375 SOL/day of OTC purchases**; the desk pot gains 12.5 SOL/day
on top of its current ~343 SOL/day inflow — from $HUB volume alone.

---

## 6. Treasury Desk Flywheel

### 6.1 Acquisition rule — sweep, never dilute

```text
sweep_cost = list_price × (1 + 0.02 taker + 0.05 royalty)      [true buyer cost]
mint_cost  = 100_000 × p_OTC_SOL + 0.5                          [surcharge model]

SWEEP  if sweep_cost < mint_cost                                [current: 6.86 < 14.98 ✓]
MINT   only if sweep_cost ≥ mint_cost
```

- Reference valuation: the dashboard's SNIPE net-value logic (verified live vault
  stock per desk). **Only sweep desks with verified non-empty vault stock.**
- **Why sweep > mint:** minting a desk grows the desk-pot payout base (each new
  desk dilutes per-desk rounds and burns 100k OTC — fine for OTC but dilutive to
  every existing desk holder). Sweeping takes an *existing* desk off the market:
  zero payout-base growth, floor support, and the desk's full future yield now
  flows to $HUB stakers instead of one outside holder.
- Treasury targets: lowest-cost stocked listings, ≤ 10% of treasury SOL per desk,
  spread across mint vintages.

### 6.2 What a swept desk earns

A swept desk claims the desk pot like any desk. At the live take:

```text
per-desk take D ≈ 0.144 SOL/day (7d avg 0.146; latest closed day 0.144)
sweep cost C   ≈ 6.86 SOL
yield payback  = C / D ≈ 48 desk-days
```

### 6.3 Discount exit — deflationary by construction

Any treasury desk can be sold back to the community at a **10% discount to the
verified live Magic Eden floor**, consideration paid **50% $HUB + 50% SOL**:

```text
sale_value  = 0.90 × floor_live                                  [e.g. 0.90 × 6.41 = 5.77 SOL]
HUB leg     = 0.50 × sale_value / p_HUB  → BURNED in the sale tx
SOL leg     = 0.50 × sale_value            → pot, in the sale tx
```

Guardrails:

- `floor_live` from a verified Magic Eden floor read at tx build time — never a
  cached or manual value.
- The treasury **claims all accrued vault yield before listing** the desk for
  exit, so the buyer receives it clean.
- The HUB leg is burned in the **same transaction** as the sale — no treasury
  custody window. The SOL leg lands in the pot in the same tx.
- Community-first: exits are announced with a fair queue; the discount is the
  "not greedy" dividend to the OTC community.

**Exit economics (live):** buy at 6.86, exit at 5.77 → capital loss 1.09 SOL, so
a swept desk is **break-even after ≈ 8 desk-days of yield** even at full
discount. The treasury is structurally long desks; exits are optional liquidity,
not the business model.

### 6.4 Treasury float accounting

- Treasury holds a **HUB float** (post-launch, from the first buy + any
  community donations). The float **claims its pro-rata launcher OTC leg like any
  holder** (legit — it is a holder); proceeds are sold into the pot.
- Treasury SOL is multi-sig. Sweep budget, pot, and ops wallets are separate,
  published addresses. Every pot tx is publicly auditable on the pot account —
  same standard as the OTC desk pot tracing this dashboard already publishes.

---

## 7. Inbound Channel — $HUB as a Reward Stock

Once $HUB joins the rotation (PONS precedent, re-verify — §11 item 2), any future
launch that selects $HUB as its reward stock has **its own creator fees buy $HUB
from the open market** for its holders:

```text
inbound_HUB_buys = Σ over launches selecting HUB: 0.675 × f_launch × V_launch
```

This is passive, compounding fee extraction from the launcher economy — powered
entirely by $HUB being an *attractive reward pick* (liquidity, price action,
community). No protocol change, no loophole: it is the launcher's own design.

Go-to-market implication: $HUB's reward-stock attractiveness is a marketing
problem, not a protocol one. Target: be selectable within the first week, be
*selected* by the first month.

---

## 8. Buyback-Burn Sink (Summary)

| Event | HUB burned |
|---|---|
| Every pot inflow (activation fees, treasury yield, exit SOL legs, treasury OTC proceeds) | **10% of inflow, bought on the market and burned** |
| Every treasury desk exit | **50% of sale consideration** |
| Tier upgrades | the HUB spent on tier NFT-bonded activation (if tiers are priced in HUB at the market-clearing rate — decide at launch: SOL-priced (current spec) or HUB-priced; HUB-priced adds a third burn sink but adds price risk to desk owners) |

Supply trajectory is monotonic down after launch: no emissions, no staking
rewards minted, only burns. Circulating supply chart lives on the dashboard.

---

## 9. Sizing — Live Formulas & Sensitivity

All figures below recompute from the live snapshot (2026-09-07 05:40 UTC);
they are **worked examples of the formulas**, not promises.

### 9.1 Base inputs

```text
D      = 0.144 SOL/desk/day          (desk-pot take; 7d avg 0.146)
C      = 6.86 SOL                    (sweep cost incl. fees)
F      = 6.41 SOL                    (floor)
SOL$   = 105.48
desks  = 2,221; listed 56
```

### 9.2 Scenario grid (per epoch = day)

Assumptions: activation cohort `A` desks at average tier weight `w̄`; treasury
sweeps `T` desks; desk take `D`.

```text
pot_inflow/day  = 0.45×A×steps_avg + T×D + treasury_OTC_proceeds + exit_SOL_legs
staker_yield/desk-tier = (w_i/Σw) × 0.90 × pot_inflow
burn/day        = 0.10 × pot_inflow / p_HUB   [HUB]
```

| Scenario | A (activated) | T (swept) | D used | Pot inflow/day | Yield pool/day (90%) |
|---|---|---|---|---|---|
| **Bear** | 100 @ T1 | 3 | 0.05 | 45.0 + 0.15 ≈ **45 SOL** | 40.5 SOL |
| **Base** | 400 @ mixed (w̄ 1.3) | 10 | 0.12 | 180 + 1.2 + launcher ≈ **190 SOL** | 171 SOL |
| **Bull** | 900 @ mixed (w̄ 1.4) | 25 | 0.18 | 405 + 4.5 + launcher ≈ **430 SOL** | 387 SOL |

Per-desk effective yield in the **base** case, cohort of 400 desks (Σw = 520):

```text
T1 desk: (1.00/520) × 171 ≈ 0.33 SOL/day ≈ $35/day  ≈ 2.3× the raw desk-pot take
T4 desk: (2.00/520) × 171 ≈ 0.66 SOL/day ≈ $69/day
```

> The honest framing for the community: **$HUB yield scales with adoption** — at
> low activation, per-desk $HUB yield is very high (few stakers sharing treasury
> yield); as activation grows, per-desk $HUB yield compresses toward
> `T×D×0.90/Σw + launcher legs`, and the **desk-pot 10% leg + OTC buy pressure**
> become the dominant value. Every scenario still beats the raw desk-pot take
> for activated desks, which is the entire point.

### 9.3 Sensitivity warning (history-informed)

The desk take has collapsed before (per-desk take fell ~85% from peak during the
2026-09 routing cliff before recovering). The spec therefore:

- sizes the **treasury sweep budget** so payback ≤ 60 desk-days at `D = 0.07`
  (half the current take), i.e. max sweep cost ≈ 4.2 SOL/desk at that take —
  pause sweeps above it;
- treats source C (launcher OTC claims) and source A (activation) as uncorrelated
  with `D`, so a desk-pot drawdown does not zero the yield engine.

---

## 10. Security & Anti-Gaming

| Vector | Mitigation |
|---|---|
| Stale ownership (sell desk, keep claiming) | Lazy revocation — on-chain owner check **inside** every claim/upgrade instruction (§4.1) |
| Wash-claim via transfer round-trips | Tier voids on ownership change; re-activation costs a fresh 0.5 SOL/step; voided tiers never refund |
| Buyback manipulation (sell HUB into our own burn) | Buys route through a public AMM route with slippage caps; burns verifiable on the burn address; buyback txs published |
| Discount-exit self-dealing (treasury buys its own discounted desk) | Exits are community-announced, wallet-restricted to non-treasury addresses, one desk per wallet per exit window |
| Floor spoofing | `floor_live` must come from the verified ME floor read at tx build; tx reverts if floor moved > 5% |
| Config drift (OTC protocol changes under us) | No hardcoded addresses in enforcement logic — every OTC-side constant (pot, program, collection, royalty rates, rotation list) re-resolved from on-chain config per claim batch; the dashboard's existing config-fingerprint watcher flags drift |
| Tier-priced-in-SOL vs HUB | SOL-priced in this draft (desk owners know SOL); HUB-pricing optional at launch as an extra burn sink (§8) |

---

## 11. Pre-Commit Verification Checklist

**Do not launch $HUB before all five are checked and documented on-chain:**

1. **Launcher claim settlement:** confirm how reward-stock OTC reaches $HUB
   holders — claim instruction vs auto-airdrop, and whether it reads **wallet
   token balance** (this determines whether the treasury float's claim path in
   §6.4 is valid and how staker HUB must be held).
2. **Reward-stock rotation entry:** confirm a launched coin automatically joins
   the selectable stock list (PONS precedent) → the inbound channel (§7) exists.
3. **Creator-fee rate `f`:** confirm the fee the launcher sets on the coin and
   that the **67.5/10/10/5/5/2.5 split holds at launch time** on the launch summary
   before signing.
4. **Desk-pot mechanics for swept desks:** confirm treasury-owned desks receive
   rounds identically (same claim instruction, no owner-type restriction) using
   the existing claim-scan infrastructure against a small pilot sweep.
5. **Royalty/taker constants:** re-verify the 2% taker + 5% royalty buyer-cost
   model against live Magic Eden policy (they have changed before).

---

## 12. Open Questions for the Community

1. **Tier pricing currency** — SOL (current draft) or HUB (extra burn sink, adds
   price risk to desk owners)? Lean: launch SOL-priced, poll after epoch 30.
2. **Exit queue design** — first-come vs weighted-by-tier vs lottery. Lean:
   tier-weighted (reward the most committed desks).
3. **Ops share** — 10% of activation fees (0.05/step) covers infra (RPC, relays,
   dashboard hosting). Too high / too low?
4. **Should the treasury also mint desks** when the spread inverts (§6.1 allows
   it)? Minting burns 100k OTC and dilutes per-desk rounds — lean: **never
   mint**, cap the flywheel, and let the spread invert without us.

---

## 13. Constants Table (single source of truth)

| Constant | Value | Notes |
|---|---|---|
| `TIER_STEPS` | 4 | BRONZE→DIAMOND |
| `STEP_FEE_SOL` | 0.5 | per tier step, upgrades pay differences |
| `POT_SHARE` | 0.90 | of activation step fee |
| `OPS_SHARE` | 0.10 | of activation step fee |
| `WEIGHTS` | [1.00, 1.25, 1.60, 2.00] | tier multipliers |
| `EPOCH_HOURS` | 24 | yield epoch |
| `BUYBACK_BURN_PCT` | 0.10 | of every pot inflow |
| `REWARD_STOCK` | OTC | launch config, fixed at launch |
| `LAUNCHER_SHARE` | None | we take 0% |
| `EXIT_DISCOUNT` | 0.10 | off verified live floor |
| `EXIT_HUB_LEG` | 0.50 | burned in sale tx |
| `EXIT_SOL_LEG` | 0.50 | to pot in sale tx |
| `SWEEP_BUDGET_CAP_PCT` | 0.10 | of treasury SOL per desk |
| `SWEEP_PAYBACK_CAP_DAYS` | 60 | at D = 0.07 → max sweep cost ≈ 4.2 SOL |
| `UNCLAIMED_YIELD_WARN_SOL` | 0.02 | claim-before-list threshold |
| `f` (creator fee rate) | TBD at launch | §11 item 3 |

---

*Community tooling by the OTC Hub dashboard team. Not affiliated with the OTC
protocol. Verify everything on-chain. DYOR.*