import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import {
  AIRDROP_RUN,
  BURN_ACTIONS,
  LP_LOCKS,
  PUMPSWAP_POOL,
  SQUADS_MULTISIG,
  TEAM_VESTING,
  TEAM_WALLET,
  TOKEN_2022_PROGRAM_ID,
  ataPda,
  type ProtocolState,
} from "@hub-sdk";
import { useHub } from "../HubProvider";
import { fmtBpPct, fmtHub, fmtNum } from "../lib/format";
import { AddressLink } from "./ui/AddressLink";
import { Flag, Panel, Row, Stat } from "./ui/Panel";

/** Commitment links live only on mainnet — pin the explorer cluster regardless of the cluster
 *  the app is previewing. */
const M = "mainnet-beta" as const;
const tx = (sig: string) => <AddressLink address={sig} kind="tx" cluster={M} />;
const ext = (href: string, label: string) => (
  <a href={href} target="_blank" rel="noreferrer" className="text-green-300 underline decoration-green-700 hover:text-green-100">
    {label}
  </a>
);

/**
 * Post-launch trust layer (2026-09-13): the irreversible on-chain actions behind the current
 * tokenomics — supply burns, 100% permanently locked LP, immutable team vesting, and the
 * 2-of-3 multisig treasury. Live counters come from `ProtocolState` / fresh RPC reads; the
 * pinned proof links come from `@hub-sdk`'s `commitments.ts`.
 */
export function CommitmentsPanel({ state }: { state: ProtocolState }) {
  const { connection } = useHub();
  const d = state.supply.decimals;
  const hubMint = new PublicKey(state.config.hubMint);
  const max = state.supply.maxUnits;
  const burned = state.supply.burnedUnits;
  const burnedBp = max > 0n ? Number((burned * 10_000n) / max) : 0;

  const balances = useQuery({
    queryKey: ["hub", "commitment-balances", hubMint.toBase58(), connection.rpcEndpoint],
    refetchInterval: 60_000,
    queryFn: async () => {
      const read = async (owner: string) => {
        const ata = ataPda(new PublicKey(owner), hubMint, new PublicKey(TOKEN_2022_PROGRAM_ID))[0];
        return connection
          .getTokenAccountBalance(ata)
          .then((b) => BigInt(b.value.amount))
          .catch(() => 0n);
      };
      return { treasury: await read(SQUADS_MULTISIG.vault), team: await read(TEAM_WALLET.address) };
    },
  });
  const live = (v: bigint | undefined) => (v === undefined ? "…" : fmtHub(v, d));
  const pctOfSupply =
    state.supply.mintSupplyUnits && state.supply.mintSupplyUnits > 0n
      ? (v: bigint) => ` · ${fmtBpPct(Number((v * 10_000n) / state.supply.mintSupplyUnits!))} of supply`
      : () => "";

  return (
    <Panel title="MAINNET COMMITMENTS" right="landed 2026-09-13 · irreversible" collapsible>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat
          label="$HUB burned"
          value={<span className="text-orange-300">{fmtHub(burned, d)}</span>}
          sub={`${fmtBpPct(burnedBp)} of 1B genesis · mint-verified`}
        />
        <Stat
          label="live supply"
          value={fmtHub(state.supply.mintSupplyUnits ?? 0n, d)}
          sub="mint authority revoked · never increases"
        />
        <Stat
          label="team liquid wallet"
          value={live(balances.data?.team)}
          sub={
            <>
              {pctOfSupply(balances.data?.team ?? 0n).trim()} ·{" "}
              <AddressLink address={TEAM_WALLET.address} cluster={M} />
            </>
          }
        />
        <Stat
          label="treasury multisig $HUB"
          value={live(balances.data?.treasury)}
          sub={
            <>
              {pctOfSupply(balances.data?.treasury ?? 0n).trim()} ·{" "}
              {ext(SQUADS_MULTISIG.url, `squads ${SQUADS_MULTISIG.threshold}`)}
            </>
          }
        />
      </div>

      <div className="mt-3 space-y-1.5">
        {LP_LOCKS.map((l) => (
          <Row
            key={l.pair}
            k={`${l.pair} LP · 100% locked`}
            v={
              <>
                pool <AddressLink address={l.pool} cluster={M} /> · lock {tx(l.lockTx)} · fee NFT{" "}
                <AddressLink address={l.feeNft} cluster={M} /> → {l.note}
              </>
            }
          />
        ))}
        <Row
          k={`${PUMPSWAP_POOL.pair} · ${PUMPSWAP_POOL.venue}`}
          v={
            <>
              pool <AddressLink address={PUMPSWAP_POOL.pool} cluster={M} /> · {PUMPSWAP_POOL.note}
            </>
          }
        />
        <Row
          k="team vesting"
          v={
            <>
              {fmtNum(TEAM_VESTING.amountHub)} $HUB · {TEAM_VESTING.months}mo monthly · cliff{" "}
              {TEAM_VESTING.cliffDate} · immutable ·{" "}
              {ext(TEAM_VESTING.url, "streamflow contract")} · create {tx(TEAM_VESTING.createTx)}
            </>
          }
        />
        <Row
          k="supply burns"
          v={
            <>
              {BURN_ACTIONS.map((b, i) => (
                <span key={b.tx}>
                  {i > 0 && " · "}
                  {tx(b.tx)} {b.label}
                </span>
              ))}
            </>
          }
        />
        <Row
          k="desk airdrop"
          v={`${fmtNum(AIRDROP_RUN.desks)} desks × ${fmtNum(AIRDROP_RUN.perDeskHub)} $HUB · snapshot slot ${fmtNum(AIRDROP_RUN.snapshotSlot)} · ${AIRDROP_RUN.note}`}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Flag on label="100% LP LOCKED" />
        <Flag on label="TEAM VESTED 24MO" />
        <Flag on label={`MULTISIG ${SQUADS_MULTISIG.threshold}`} />
        <Flag on={burned > 0n} label="DEFLATIONARY" />
      </div>
    </Panel>
  );
}
