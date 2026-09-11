import { useState } from "react";
import { TIER_WEIGHTS_BP, type ProtocolState } from "@hub-sdk";
import { usePayerBalances } from "../hooks/usePayerBalances";
import { useWalletPortfolio, type OwnedDesk } from "../hooks/useWalletPortfolio";
import { fmtNum, fmtSol, fmtUnits, fmtWeight, shortKey } from "../lib/format";
import { baseInputs, distributableLamports, roundsPerDay } from "../lib/yield";
import { useWallet } from "../WalletProvider";
import { ActivationGuide } from "./ActivationGuide";
import { ClaimPanel } from "./ClaimPanel";
import { DeskSheet } from "./DeskSheet";
import { HubPotPanel } from "./HubPotPanel";
import { AddressLink } from "./ui/AddressLink";
import { Panel } from "./ui/Panel";
import { TierLadder } from "./ui/TierProgress";
import { WalletConnect } from "./WalletConnect";

type Props = {
  state: ProtocolState;
  /** Host-supplied address (otchub passes its connected wallet); hides the connect UI. */
  walletAddress?: string;
};

/** $OTC mint decimals; the payer ATA's reported decimals take precedence once loaded. */
const OTC_DECIMALS = 6;

/** Desks shown before the "show all" toggle — keeps huge wallets from turning the page into a
 * wall of cards; the rest is one tap away. */
const DESK_PAGE = 24;

const deskNo = (d: OwnedDesk) => d.art?.name?.match(/#\s*(\d+)/)?.[1] ?? shortKey(d.asset, 4);
const isActive = (d: OwnedDesk) => !!d.tier && !d.tier.voided;

function Chip({
  k,
  v,
  tone = "text-green-300",
  title,
}: {
  k: string;
  v: string;
  tone?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 border border-green-500/20 bg-green-500/5 px-2 py-1 text-[11px]"
    >
      <span className="text-[9px] uppercase tracking-widest text-green-600">{k}</span>
      <span className={`font-bold ${tone}`}>{v}</span>
    </span>
  );
}

function DeskCard({ desk, onOpen }: { desk: OwnedDesk; onOpen: () => void }) {
  const voided = !!desk.tier?.voided;
  const tier = isActive(desk) ? desk.tier!.tier : 0;
  const pending = desk.pendingLamports;
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Open desk — claim · activate · upgrade"
      className="flex min-h-[60px] flex-col justify-between gap-1.5 border border-green-500/15 p-1.5 text-left transition-colors hover:border-emerald-400/50 hover:bg-green-500/5"
    >
      <div className="flex w-full items-center gap-1.5">
        {desk.art?.image ? (
          <img
            src={desk.art.image}
            alt=""
            loading="lazy"
            className="h-5 w-5 shrink-0 border border-green-500/30 bg-black object-cover"
          />
        ) : (
          <span className="inline-block h-5 w-5 shrink-0 border border-green-500/15 bg-black" />
        )}
        <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-green-300">
          #{deskNo(desk)}
        </span>
        {voided ? (
          <span className="text-[9px] font-bold uppercase tracking-widest text-red-400">VOID</span>
        ) : tier ? (
          <span className="text-[9px] font-bold uppercase tracking-widest text-cyan-300">T{tier}</span>
        ) : (
          <span className="text-[9px] font-bold uppercase tracking-widest text-green-700">RAW</span>
        )}
      </div>
      <div className="flex w-full items-center justify-between gap-1">
        <TierLadder tier={tier} voided={voided} />
        <span className={`text-[10px] font-bold ${pending > 0 ? "text-emerald-300" : "text-green-800"}`}>
          {pending > 0 ? fmtSol(pending, 3) : "·"}
        </span>
      </div>
    </button>
  );
}

/** Wallet :: Portfolio — the dashboard's one wallet surface. One compact panel: connect/status
 * header → balance chips → yield/earnings summary strip → claim bar → filterable desk grid.
 * Per-desk actions (claim · activate · upgrade) live in the DeskSheet the grid opens, so the
 * page never grows with the number of desks a wallet holds. */
export function WalletPanel({ state, walletAddress }: Props) {
  const wallet = useWallet();
  const address = walletAddress ?? wallet.address;
  const [switchOpen, setSwitchOpen] = useState(false);
  const [openAsset, setOpenAsset] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "idle">("all");
  const [showAll, setShowAll] = useState(false);
  // Same query key as before → one fetch, shared by grid, claim bar and the sheet.
  const portfolio = useWalletPortfolio(address, state);
  const balances = usePayerBalances(
    address,
    state.config.otcMint,
    state.config.hubMint,
    state.token.hubTokenProgram,
  );

  const data = portfolio.data;
  const desks = data?.desks ?? [];
  const activeDesks = desks.filter(isActive);
  const idleDesks = desks.filter((d) => !isActive(d));
  const shown = filter === "all" ? desks : filter === "active" ? activeDesks : idleDesks;
  const visible = showAll ? shown : shown.slice(0, DESK_PAGE);
  const openDesk = openAsset ? (desks.find((d) => d.asset === openAsset) ?? null) : null;

  // EST_DAILY_YIELD: this wallet's share of Σw against the same round-size + cadence basis as the
  // EARNING PREVIEW calculator — an estimate, not a promise.
  const activeWeightBp = activeDesks.reduce(
    (s, d) => s + (TIER_WEIGHTS_BP[d.tier!.tier - 1] ?? 0),
    0,
  );
  const lifetimeEarningsLamports =
    desks.reduce((s, d) => s + (d.tier?.totalClaimedLamports ?? 0), 0) ?? 0;
  const roundInputs = baseInputs(state.currentEpoch, state.config);
  const distributable = distributableLamports(
    roundInputs.roundInflowLamports,
    roundInputs.burnPctBp,
    roundInputs.lpPctBp,
    roundInputs.treasuryFloatPctBp,
  );
  const perDay = roundsPerDay(state.previousEpoch);
  const estDailyYieldLamports =
    perDay !== null && activeWeightBp > 0 && roundInputs.totalWeightBp > 0
      ? Math.floor((distributable * activeWeightBp) / roundInputs.totalWeightBp) * perDay
      : null;

  const otcDecimals = balances.data?.otcDecimals ?? OTC_DECIMALS;

  if (!address) {
    return (
      <div className="space-y-2">
        <Panel title="WALLET">
          <WalletConnect onConnected={(pk) => wallet.connect(pk)} />
        </Panel>
        <HubPotPanel />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Panel title="WALLET :: PORTFOLIO">
        <div className="flex flex-wrap items-center gap-2">
          <AddressLink address={address} label={shortKey(address, 6)} />
          {!walletAddress && (
            <span className="ml-auto flex gap-2 text-[10px] uppercase tracking-widest">
              <button
                type="button"
                onClick={() => setSwitchOpen((o) => !o)}
                className="text-green-500 underline hover:text-green-300"
              >
                {switchOpen ? "cancel" : "switch"}
              </button>
              <button
                type="button"
                onClick={() => wallet.disconnect()}
                className="text-amber-400 underline hover:text-amber-200"
              >
                disconnect
              </button>
            </span>
          )}
        </div>
        {switchOpen && (
          <div className="mt-2">
            <WalletConnect
              onConnected={(pk) => {
                wallet.connect(pk);
                setSwitchOpen(false);
              }}
            />
          </div>
        )}

        {portfolio.isPending && (
          <div className="mt-2 text-xs text-green-500/50">
            <span className="animate-pulse">▋</span> LOADING…
          </div>
        )}
        {portfolio.isError && (
          <div className="mt-2 text-xs text-amber-400">ERR: {(portfolio.error as Error).message}</div>
        )}

        {data && (
          <>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Chip k="SOL" v={fmtSol(data.solLamports, 3)} />
              <Chip
                k="$HUB"
                v={data.hubBalance === null ? "—" : fmtNum(data.hubBalance)}
                tone="text-emerald-300"
                title={data.hubBalance === null ? "no token account" : "$HUB (spl)"}
              />
              <Chip
                k="$OTC"
                v={
                  !balances.data
                    ? "…"
                    : balances.data.otcUnits === null
                      ? "—"
                      : fmtUnits(balances.data.otcUnits, otcDecimals)
                }
                tone="text-amber-300"
                title="$OTC (spl)"
              />
            </div>

            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] uppercase tracking-widest text-green-600">
              <span>
                est{" "}
                <span className="font-bold text-cyan-300">
                  {estDailyYieldLamports === null ? "—" : fmtSol(estDailyYieldLamports, 4)}
                </span>
                /day
              </span>
              <span>
                lifetime{" "}
                <span className="font-bold text-green-300">{fmtSol(lifetimeEarningsLamports, 4)}</span>
              </span>
              <span>
                Σw <span className="font-bold text-amber-300">{fmtWeight(activeWeightBp)}</span>
                {state.config.totalWeightBp > 0
                  ? ` · ${((activeWeightBp / state.config.totalWeightBp) * 100).toFixed(2)}% of cohort`
                  : ""}
              </span>
            </div>

            <ClaimPanel
              address={address}
              state={state}
              desks={desks}
              onClaimed={() => void portfolio.refetch()}
            />

            <div className="mt-2 flex items-center gap-1">
              {(
                [
                  ["all", desks.length],
                  ["active", activeDesks.length],
                  ["idle", idleDesks.length],
                ] as const
              ).map(([id, n]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id)}
                  className={`border px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                    filter === id
                      ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                      : "border-green-500/25 text-green-600 hover:text-green-300"
                  }`}
                >
                  {id} {n}
                </button>
              ))}
            </div>
            {shown.length === 0 ? (
              <div className="mt-1.5 text-xs text-green-700">
                no desks from this collection in the wallet.
              </div>
            ) : (
              <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-4">
                {visible.map((d) => (
                  <DeskCard key={d.asset} desk={d} onOpen={() => setOpenAsset(d.asset)} />
                ))}
              </div>
            )}
            {shown.length > visible.length && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="mt-1.5 w-full border border-green-500/25 py-1 text-[10px] uppercase tracking-widest text-green-500/70 hover:text-green-300"
              >
                show all {shown.length} desks
              </button>
            )}
            <div className="mt-2 text-[10px] text-green-700">
              tap a desk to claim · activate · upgrade
            </div>
          </>
        )}
      </Panel>
      <HubPotPanel desks={desks} address={address} />
      <ActivationGuide />
      {openDesk && (
        <DeskSheet
          desk={openDesk}
          state={state}
          address={address}
          onClose={() => setOpenAsset(null)}
          onChanged={() => void portfolio.refetch()}
        />
      )}
    </div>
  );
}