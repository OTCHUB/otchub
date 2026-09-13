import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import type { ProtocolState } from "@hub-sdk";
import { useHub } from "../HubProvider";
import { useTokenomics } from "../hooks/useTokenomics";
import { fetchDeskArtBatch } from "../lib/das";

type ActivationRow = {
  sig: string;
  blockTime: number | null;
  tier: number;
  kind: "activate" | "upgrade";
  desk: string | null;
};

// Spelled-out units ("23 mins ago", not "23m ago") so each milestone reads as a plain-English
// sentence at a glance — this is the social-proof copy, not a dense stat, so it should scan like
// one ("OTC Desk #123 T2 activated 23 mins ago").
const timeAgo = (t: number | null) => {
  if (!t) return "";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - t));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    return `${m} min${m === 1 ? "" : "s"} ago`;
  }
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    return `${h} hr${h === 1 ? "" : "s"} ago`;
  }
  const d = Math.floor(s / 86400);
  return `${d} day${d === 1 ? "" : "s"} ago`;
};

/**
 * Live $HUB activation ticker — the last 10 real on-chain desk activations
 * (activate_tier / upgrade_tier, decoded from the treasury vault's signature
 * history by the getHubActivations backend function). A continuously moving
 * marquee (pauses on hover) of chips showing the desk's art, tier and desk
 * number; each chip links straight to its transaction on Solscan so visitors
 * can verify the activity is real.
 */
export function HubActivations({ state }: { state: ProtocolState }) {
  const { connection, programId, cluster } = useHub();
  const tokenomics = useTokenomics(state);
  const vault = tokenomics.data?.onChain?.treasuryLockVault ?? null;

  const acts = useQuery({
    queryKey: ["hub", "activations", programId.toBase58(), cluster, vault],
    enabled: !!vault,
    refetchInterval: 45_000,
    queryFn: async (): Promise<ActivationRow[]> => {
      const res = await base44.functions.invoke("getHubActivations", {
        programId: programId.toBase58(),
        vaultAddress: vault,
        cluster,
      });
      return res?.data?.items || [];
    },
  });

  const rows = acts.data ?? [];
  const desks = useMemo(
    () => [...new Set(rows.map((r) => r.desk).filter((d): d is string => !!d))],
    [rows],
  );
  const art = useQuery({
    queryKey: ["hub", "activations", "art", connection.rpcEndpoint, ...desks],
    enabled: desks.length > 0,
    staleTime: 10 * 60_000,
    queryFn: () => fetchDeskArtBatch(connection.rpcEndpoint, desks),
  });

  const solscan = (sig: string) =>
    `https://solscan.io/tx/${sig}${cluster === "devnet" ? "?cluster=devnet" : ""}`;

  const Chip = ({ it }: { it: ActivationRow }) => {
    const a = it.desk ? art.data?.[it.desk] : undefined;
    const m = a?.name?.match(/#(\d+)/);
    const deskLabel = m ? `#${m[1]}` : (a?.name ?? (it.desk ? `${it.desk.slice(0, 4)}…` : "?"));
    return (
      <a
        href={solscan(it.sig)}
        target="_blank"
        rel="noopener noreferrer"
        title={`T${it.tier} ${it.kind === "activate" ? "activation" : "upgrade"} · ${a?.name ?? it.desk ?? "desk"} — view on Solscan`}
        className="flex shrink-0 items-center gap-1.5 border border-green-500/20 bg-green-500/5 px-2 py-1 transition-colors hover:border-emerald-400/60 hover:bg-emerald-500/10"
      >
        {a?.image ? (
          <img
            src={a.image}
            alt=""
            loading="lazy"
            className="h-5 w-5 border border-green-500/40 bg-black object-cover"
          />
        ) : (
          <span className="inline-block h-5 w-5 border border-green-500/15 bg-black" />
        )}
        {/* Reads as one plain-English milestone — "desk #123 T2 activated 23 mins ago" — instead
            of a dense stat, so the ticker doubles as social proof at a glance. */}
        <span className="text-[10px] font-bold text-green-300">desk {deskLabel}</span>
        <span
          className={`text-[10px] font-bold uppercase tracking-widest ${
            it.kind === "activate" ? "text-cyan-300" : "text-amber-300"
          }`}
        >
          T{it.tier} {it.kind === "activate" ? "activated" : "upgraded"}
        </span>
        <span className="text-[9px] text-green-600">{timeAgo(it.blockTime)}</span>
      </a>
    );
  };

  return (
    <section className="term-window flex items-center gap-2 border border-green-500/30 px-3 py-2 font-mono">
      <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-400">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> live activations
      </span>
      {/* This ticker only ever shows one network at a time — whichever cluster this mount is
          on (see HubProvider's `cluster`, wired independently for /hub vs /devnet) — so visitors
          can immediately tell real mainnet activity apart from the devnet sandbox's mock desks. */}
      <span className="hidden shrink-0 border border-green-500/20 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-green-500 sm:inline">
        {cluster === "devnet" ? "devnet" : "mainnet"}
      </span>
      <span className="hidden shrink-0 text-[9px] uppercase tracking-widest text-green-700 md:inline">
        click → solscan
      </span>
      <div className="relative min-w-0 flex-1 overflow-hidden">
        {acts.isPending ? (
          <span className="animate-pulse text-[10px] uppercase tracking-widest text-green-600">
            ▋ syncing on-chain history…
          </span>
        ) : rows.length === 0 ? (
          <span className="text-[10px] uppercase tracking-widest text-green-600">
            no $HUB activations recorded yet
          </span>
        ) : (
          <div className="hub-activations-track flex w-max items-center gap-2">
            {[...rows, ...rows].map((it, i) => (
              <Chip key={`${it.sig}-${i}`} it={it} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}