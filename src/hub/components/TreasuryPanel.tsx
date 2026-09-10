import {
  BPS,
  otcPotPda,
  burnPda,
  potPda,
  treasuryPda,
  vaultPda,
  creatorFeePda,
  creatorFeeClearProgress,
  CREATOR_FEE_DESK_POT_BP,
  CREATOR_FEE_BURN_BP,
  CREATOR_FEE_LP_BP,
  CREATOR_FEE_STACK_BP,
  CREATOR_FEE_OPS_BP,
  type ProtocolState,
} from "@hub-sdk";
import { useHub } from "../HubProvider";
import { fmtBp, fmtBpPct, fmtHub, fmtNum, fmtSol, fmtUnits, fmtUtc } from "../lib/format";
import { TREASURY_DESK_TARGET, treasuryDeskProgressPct } from "../lib/yield";
import { AddressLink } from "./ui/AddressLink";
import { CollapsibleCard, Flag, Panel, Row, Stat } from "./ui/Panel";
import { ProgressBar } from "./ui/ProgressBar";
import { TreasuryPortfolio } from "./TreasuryPortfolio";
import { VerificationPanel } from "./VerificationPanel";

/** $OTC mint decimals fallback for the pot's lifetime-bought display. */
const OTC_DECIMALS = 6;

/** §C6 — treasury transparency: what the protocol holds, has swept, and has burned. */
export function TreasuryPanel({ state }: { state: ProtocolState }) {
  const { programId } = useHub();
  const { config, treasury, burn, otcPot, creatorFee, potLamports, supply, token } = state;
  const d = supply.decimals;
  const pdas = {
    pot: potPda(programId)[0].toBase58(),
    burn: burnPda(programId)[0].toBase58(),
    otcPot: otcPotPda(programId)[0].toBase58(),
    creatorFee: creatorFeePda(programId)[0].toBase58(),
    treasury: treasuryPda(programId)[0].toBase58(),
    vault: vaultPda(programId)[0].toBase58(),
  };
  const stepFeeSplit = `${fmtBp(BPS - config.opsPctBp, 0)} pot / ${fmtBp(config.opsPctBp, 0)} ops`;
  const roundSplit = `${fmtBp(config.burnPctBp, 0)} burn / ${fmtBp(config.lpPctBp, 0)} LP / ${fmtBp(BPS - config.burnPctBp - config.lpPctBp, 0)} $OTC yield`;
  const potVsLiability = `${fmtSol(potLamports)} / ${fmtSol(config.potLiabilityLamports)}`;
  const otcAvgRate =
    otcPot && otcPot.totalLamportsSpent > 0
      ? Number(otcPot.totalOtcBoughtUnits) / otcPot.totalLamportsSpent
      : null;

  return (
    <div className="space-y-2">
      <Panel title="TREASURY" id="hub-treasury">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
          <Stat
            label="desks owned"
            value={fmtNum(treasury.desksOwned)}
            sub={`bought via sweeps · ${treasuryDeskProgressPct(treasury.desksOwned)}% of ${fmtNum(TREASURY_DESK_TARGET)} target`}
          />
          <Stat label="desks consigned" value={fmtNum(treasury.desksConsigned)} sub="in vault" />
          <Stat label="sweeps" value={fmtNum(treasury.totalSweeps)} sub="floor buys executed" />
          <Stat label="exits" value={fmtNum(treasury.totalExits)} sub="desks sold back" />
          <Stat
            label="$HUB burned"
            value={fmtHub(supply.burnedUnits, d)}
            sub={`ledger ${fmtNum(burn.totalHubBurned)} units${supply.ledgerDrift ? " · drift" : ""}`}
          />
          <Stat label="burn pending" value={fmtSol(burn.burnPendingLamports)} sub="awaiting swap" />
          <Stat
            label="LP-build pending"
            value={fmtSol(treasury.lpPendingLamports)}
            sub="§A5 5% leg · phase-2 $HUB/$OTC LP"
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Flag on={!config.paused} label="LIVE" />
          <Flag on={config.consignmentEnabled} label="CONSIGNMENT" />
          <Flag on={config.lpEnabled} label="LP" />
          <Flag on={otcAvgRate !== null} label="$OTC YIELD FUNDED" />
          <Flag on={creatorFee !== null} label="CREATOR FEE FLYWHEEL" />
        </div>
      </Panel>

      <Panel
        title="$OTC YIELD VAULT"
        right="§A5 90% leg — desks claim_yield pays out of this vault"
        id="hub-vault"
      >
        {!otcPot ? (
          <div className="text-xs text-amber-400">
            not provisioned yet — init_otc_pot hasn't been called on this cluster.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Stat
                label="pending buy"
                value={fmtSol(otcPot.otcPendingLamports)}
                sub="SOL earmarked, not yet spent by the keeper"
              />
              <Stat
                label="lifetime spent"
                value={fmtSol(otcPot.totalLamportsSpent)}
                sub="SOL the keeper has deployed into $OTC buys"
              />
              <Stat
                label="lifetime bought"
                value={fmtUnits(otcPot.totalOtcBoughtUnits, OTC_DECIMALS)}
                sub="$OTC deposited into the vault"
              />
              <Stat
                label="avg buy rate"
                value={otcAvgRate === null ? "—" : `${otcAvgRate.toFixed(4)} $OTC/lamport`}
                sub={
                  otcAvgRate === null
                    ? "NoOtcPurchased — claim_yield reverts until the first buy"
                    : "prices every claim_yield payout"
                }
              />
            </div>
            <div className="mt-2 text-[10px] text-green-700">
              keeper <AddressLink address={otcPot.authority} /> · vault{" "}
              <AddressLink address={otcPot.otcVault} />
            </div>
          </>
        )}
      </Panel>

      <Panel
        title="CREATOR FEE FLYWHEEL"
        right="§A6.3 treasury's launcher holder-leg claim (2% $HUB supply) — re-split every clear"
        id="hub-flywheel"
      >
        {!creatorFee ? (
          <div className="text-xs text-amber-400">
            not provisioned yet — init_creator_fee_state hasn't been called on this cluster.
          </div>
        ) : (
          <>
            <ProgressBar frac={creatorFeeClearProgress(creatorFee)} suffix="to clear threshold" />
            <Row
              k="pending $OTC / threshold"
              v={`${fmtUnits(creatorFee.pendingOtcUnits, OTC_DECIMALS)} / ${fmtUnits(creatorFee.clearThresholdUnits, OTC_DECIMALS)} $OTC`}
            />
            <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
              <Stat
                label={`desk pot (${fmtBp(CREATOR_FEE_DESK_POT_BP, 0)})`}
                value={fmtUnits(creatorFee.totalDeskPotOtc, OTC_DECIMALS)}
                sub="direct $OTC injection, no swap — raises avg buy rate"
              />
              <Stat
                label={`burn (${fmtBp(CREATOR_FEE_BURN_BP, 0)})`}
                value={fmtUnits(creatorFee.totalBurnHub, d)}
                sub={`$HUB burned · ${fmtUnits(creatorFee.burnPendingOtc, OTC_DECIMALS)} $OTC pending swap`}
              />
              <Stat
                label={`LP build (${fmtBp(CREATOR_FEE_LP_BP, 0)})`}
                value={fmtUnits(creatorFee.totalLpOtc, OTC_DECIMALS)}
                sub={`$OTC locked · ${fmtUnits(creatorFee.lpPendingOtc, OTC_DECIMALS)} pending — Raydium CP-Swap lock+burn`}
              />
              <Stat
                label={`stack (${fmtBp(CREATOR_FEE_STACK_BP, 0)})`}
                value={fmtUnits(creatorFee.totalStackHub, d)}
                sub={`$HUB held · ${fmtUnits(creatorFee.stackPendingOtc, OTC_DECIMALS)} $OTC pending swap`}
              />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
              <Stat
                label={`ops (${fmtBp(CREATOR_FEE_OPS_BP, 0)})`}
                value={fmtSol(Number(creatorFee.totalOpsSolLamports))}
                sub={`SOL for protocol ops · ${fmtUnits(creatorFee.opsPendingOtc, OTC_DECIMALS)} $OTC pending swap`}
              />
              <Stat
                label="lifetime received"
                value={fmtUnits(creatorFee.totalReceivedOtc, OTC_DECIMALS)}
                sub="$OTC claimed via the launcher holder-leg, all-time"
              />
            </div>
            <div className="mt-2 text-[10px] text-green-700">
              keeper <AddressLink address={creatorFee.authority} /> · vault{" "}
              <AddressLink address={creatorFee.creatorFeeVault} />
            </div>
          </>
        )}
      </Panel>

      <Panel title="TREASURY LOCKS" right="what the treasury's holdings are earmarked for">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Stat
            label="LP provisioning"
            value={config.lpEnabled ? "ACTIVE" : "PENDING"}
            sub="liquidity for the $HUB / $OTC pair — seeded from treasury OTC + $HUB once price holds ≥14 days"
          />
          <Stat
            label="buyback reserve"
            value={fmtSol(burn.burnPendingLamports)}
            sub="SOL earmarked each round, awaiting the buyback-burn keeper — automated floor support"
          />
          <Stat
            label="yield buffer"
            value={fmtHub(supply.lockedUnits, d)}
            sub="treasury-held $HUB + swept desks that keep tier payouts sustainable as Σw grows"
          />
        </div>
      </Panel>

      <Panel title="$HUB SUPPLY" right={`max ${fmtHub(supply.maxUnits, d, 0)}`} id="hub-supply">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
          <Stat
            label="burn % of circulating"
            value={
              <span className="text-orange-300">{fmtBpPct(supply.burnPctOfCirculatingBp)}</span>
            }
            sub="burned ÷ circulating"
          />
          <Stat
            label="burn % of max"
            value={fmtBpPct(supply.burnPctOfMaxBp)}
            sub={`${fmtHub(supply.burnedUnits, d)} destroyed`}
          />
          <Stat
            label="circulating"
            value={fmtHub(supply.circulatingUnits, d)}
            sub="max − burned − locked"
          />
          <Stat
            label="treasury / locked"
            value={fmtHub(supply.lockedUnits, d)}
            sub={token.holdings
              .map(
                (h) =>
                  `${h.owner === config.treasury ? "multisig" : "vault"} ${fmtHub(h.units, d)}`,
              )
              .join(" · ")}
          />
          <Stat
            label="mint supply (live)"
            value={fmtHub(supply.mintSupplyUnits, d)}
            sub={
              token.mint
                ? token.mint.mintAuthority
                  ? "⚠ mint authority set"
                  : "mint authority revoked"
                : "mint not found"
            }
          />
        </div>
      </Panel>

      <TreasuryPortfolio state={state} />

      <VerificationPanel state={state} />

      <div className="grid gap-2 lg:grid-cols-2">
        <CollapsibleCard title="ADDRESSES" defaultOpen>
          <Row k="program" v={<AddressLink address={programId.toBase58()} />} />
          <Row k="$HUB mint" v={<AddressLink address={config.hubMint} />} />
          <Row k="pot (system PDA)" v={<AddressLink address={pdas.pot} />} />
          <Row k="burn state" v={<AddressLink address={pdas.burn} />} />
          <Row k="OTC pot state" v={<AddressLink address={pdas.otcPot} />} />
          <Row k="creator fee state" v={<AddressLink address={pdas.creatorFee} />} />
          <Row k="treasury state" v={<AddressLink address={pdas.treasury} />} />
          <Row k="vault (consigned custody)" v={<AddressLink address={pdas.vault} />} />
          <Row k="treasury multisig" v={<AddressLink address={config.treasury} />} />
          <Row k="ops wallet" v={<AddressLink address={config.opsWallet} />} />
          <Row k="authority" v={<AddressLink address={config.authority} />} />
          <Row k="desk collection" v={<AddressLink address={config.deskCollection} />} />
        </CollapsibleCard>

        <CollapsibleCard title="PARAMETERS" defaultOpen>
          <Row k="step fee" v={fmtSol(config.stepFeeLamports, 2)} />
          <Row k="step fee split" v={stepFeeSplit} />
          <Row k="round split" v={roundSplit} />
          <Row k="tier weights" v={config.tierWeightsBp.map((w) => `${w / 100}%`).join(" · ")} />
          <Row k="round threshold" v={fmtSol(config.minPotThresholdLamports, 2)} />
          <Row k="genesis" v={fmtUtc(config.genesisTs)} />
          <Row k="consignor share" v={fmtBp(config.consignorShareBp, 0)} />
          <Row k="pot balance / liability" v={potVsLiability} />
        </CollapsibleCard>
      </div>
    </div>
  );
}