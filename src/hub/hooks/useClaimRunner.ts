import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ProtocolState } from "@hub-sdk";
import { useHub } from "../HubProvider";
import { executeClaimYield, type ClaimPhase } from "../lib/claim";
import type { TxLog } from "../lib/swap";

/** Shared `claim_yield` runner for the wallet's activated desks — used by the compact ClaimPanel
 * bar (claim all / claim selected) and the per-desk DeskSheet, so every surface runs the exact
 * same validated path: signer check → vault readiness → executeClaimYield → hub cache
 * invalidate → caller refetch. */
export function useClaimRunner(address: string, state: ProtocolState, onClaimed?: () => void) {
  const { connection, program, resolveSigner } = useHub();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<ClaimPhase | null>(null);
  const [logs, setLogs] = useState<TxLog[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const run = async (assets: string[]) => {
    setErr(null);
    const signer = resolveSigner(address);
    if (!signer) return setErr("read-only address — connect the wallet itself to sign claims");
    const otcPot = state.otcPot;
    if (!otcPot || otcPot.totalLamportsSpent <= 0)
      return setErr(
        !otcPot
          ? "$OTC yield vault not provisioned yet — nothing to claim into"
          : "keeper hasn't recorded an $OTC buy yet — try again shortly",
      );
    if (!assets.length) return setErr("nothing to claim — no activated desk has pending yield");
    setBusy(true);
    setLogs([]);
    const res = await executeClaimYield({
      connection,
      program,
      signer,
      assets,
      config: state.config,
      otcPot,
      onLog: (l) => setLogs((p) => [...p, l]),
      onPhase: setPhase,
    });
    setBusy(false);
    setPhase(null);
    if (res.some((r) => r.ok)) {
      await qc.invalidateQueries({ queryKey: ["hub"] });
      onClaimed?.();
    }
  };

  return { run, busy, phase, logs, err };
}