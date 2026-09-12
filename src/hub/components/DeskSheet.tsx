import { Link } from "react-router-dom";
import type { ProtocolState } from "@hub-sdk";
import { useHub } from "../HubProvider";
import type { OwnedDesk } from "../hooks/useWalletPortfolio";
import { useClaimRunner } from "../hooks/useClaimRunner";
import { useOtcActivate } from "../hooks/useOtcActivate";
import { OTC_TICKERS } from "../lib/otcActivate";
import { MAX_TIER } from "../lib/activate";
import { fmtSol, shortKey } from "../lib/format";
import { magicEdenItemUrl, OFFICIAL_DESKS_URL } from "../lib/marketplace";
import { ActivateFlow } from "./ActivateFlow";
import { AddressLink } from "./ui/AddressLink";
import { Sheet } from "./ui/Sheet";
import { TierBadge, TierLadder } from "./ui/TierProgress";
import { TxLogView } from "./ui/TxLogView";

type Props = {
  desk: OwnedDesk;
  state: ProtocolState;
  address: string;
  onClose: () => void;
  onChanged?: () => void;
};

const deskNumber = (d: OwnedDesk) => d.art?.name?.match(/#\s*(\d+)/)?.[1] ?? shortKey(d.asset, 4);

/** Per-desk action sheet — the ONE place a desk's actions live (claim · activate · upgrade ·
 * links), so the wallet panel stays a compact grid no matter how many desks a wallet holds.
 * Bottom sheet on mobile, centered modal on desktop (see ui/Sheet). */
export function DeskSheet({ desk, state, address, onClose, onChanged }: Props) {
  const { cluster } = useHub();
  const claim = useClaimRunner(address, state, onChanged);
  const otcActivate = useOtcActivate(desk.asset, desk.nativeActive);
  const voided = !!desk.tier?.voided;
  const tier = desk.tier && !voided ? desk.tier.tier : 0;
  const pending = desk.pendingLamports;
  const canAdvance = !voided && tier < MAX_TIER;

  return (
    <Sheet open onClose={onClose} title={`DESK #${deskNumber(desk)}`}>
      {/* Overview: art, status, claimable amount — the context for every action below. */}
      <div className="flex items-center gap-2.5">
        {desk.art?.image ? (
          <img
            src={desk.art.image}
            alt={desk.art.name ?? "desk NFT"}
            className="h-10 w-10 shrink-0 border border-green-500/30 bg-black object-cover"
          />
        ) : (
          <span className="inline-block h-10 w-10 shrink-0 border border-green-500/15 bg-black" />
        )}
        <div className="min-w-0">
          <TierBadge tier={tier} voided={voided} />
          <div className="mt-1 text-[11px] text-green-500/70">
            {pending > 0
              ? `${fmtSol(pending, 4)} claimable`
              : tier
                ? "no pending yield yet"
                : "raw desk — activate to earn"}
            {tier > 0 && desk.yieldBoostPct > 0 ? ` · +${desk.yieldBoostPct}% boost` : ""}
          </div>
        </div>
        <span className="ml-auto shrink-0">
          <TierLadder tier={tier} voided={voided} />
        </span>
      </div>

      {pending > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => void claim.run([desk.asset])}
            disabled={claim.busy}
            className="w-full border border-emerald-500/60 py-2 text-[12px] font-bold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-30"
          >
            {claim.busy
              ? `${(claim.phase ?? "prep").toUpperCase()}…`
              : `[CLAIM ${fmtSol(pending, 4)}]`}
          </button>
          {claim.err && <div className="mt-1 text-[11px] text-amber-400">ERR: {claim.err}</div>}
          <TxLogView logs={claim.logs} />
        </div>
      )}

      {canAdvance && (
        <div className="mt-3 border-t border-green-500/20 pt-3">
          <div className="mb-2 text-[10px] uppercase tracking-widest text-green-600">
            {tier ? `UPGRADE FROM T${tier}` : "ACTIVATE — START EARNING"}
          </div>
          <ActivateFlow address={address} state={state} desk={desk} onChanged={onChanged} />
        </div>
      )}

      {/* Native OTC Desks program status — mainnet only (see otcNative.ts/otcActivate.ts). A
          desk's payout vault can only be created by otcdesks.cash's own mint/grant, so `false`
          links out to the official app instead of offering a broken button; `true` offers the one
          step that IS user-triggerable here — opening any still-missing stock accounts. */}
      {cluster === "mainnet-beta" && desk.nativeActive !== null && (
        <div className="mt-3 border-t border-green-500/20 pt-3">
          <div className="mb-2 text-[10px] uppercase tracking-widest text-green-600">
            OTC DESKS PROGRAM
          </div>
          {desk.nativeActive ? (
            <>
              {otcActivate.loading ? (
                <div className="text-[11px] text-green-500/50">
                  <span className="animate-pulse">▋</span> checking native stock accounts…
                </div>
              ) : otcActivate.missing && otcActivate.missing.length > 0 ? (
                <>
                  <div className="mb-1.5 text-[11px] text-green-500/70">
                    {otcActivate.missing.length} of {OTC_TICKERS.length} stock account(s) not open
                    yet — required before this desk can accrue those tickers.
                  </div>
                  <button
                    type="button"
                    onClick={() => void otcActivate.run(address)}
                    disabled={otcActivate.busy}
                    className="w-full border border-cyan-500/60 py-2 text-[12px] font-bold text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-30"
                  >
                    {otcActivate.busy
                      ? `${(otcActivate.phase ?? "prep").toUpperCase()}…`
                      : `[OPEN ${otcActivate.missing.length} STOCK ACCOUNT${otcActivate.missing.length === 1 ? "" : "S"}]`}
                  </button>
                  {otcActivate.err && (
                    <div className="mt-1 text-[11px] text-amber-400">ERR: {otcActivate.err}</div>
                  )}
                  <TxLogView logs={otcActivate.logs} />
                </>
              ) : (
                <div className="text-[11px] text-emerald-400">
                  ✓ natively activated — all stock accounts open
                </div>
              )}
            </>
          ) : (
            <div className="text-[11px] text-amber-500/70">
              no payout vault found for this desk in the official OTC Desks program — it can only be
              created by minting through{" "}
              <a
                href={OFFICIAL_DESKS_URL}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-amber-300"
              >
                otcdesks.cash ↗
              </a>
              .
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-green-500/20 pt-2 text-[10px]">
        <Link
          to={`desk/${desk.asset}`}
          onClick={onClose}
          className="text-green-500 hover:text-green-300"
        >
          [DETAIL →]
        </Link>
        <a
          href={magicEdenItemUrl(desk.asset)}
          target="_blank"
          rel="noreferrer"
          className="text-green-500 hover:text-green-300"
          title="view this desk on Magic Eden"
        >
          [MAGIC EDEN ↗]
        </a>
        <AddressLink address={desk.asset} label={shortKey(desk.asset)} />
      </div>
      <div className="mt-1.5 text-[10px] text-green-700">
        non-custodial — the desk stays in your wallet · transfer voids the tier
      </div>
    </Sheet>
  );
}