import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { otcDueForLamports, type ProtocolState } from "@hub-sdk";
import { useHub } from "../HubProvider";
import { executeClaimYield, type ClaimPhase } from "../lib/claim";
import type { TxLog } from "../lib/swap";

/** Shared `claim_yield` runner for the wallet's activated desks — used by the compact ClaimPanel
 * bar (claim all / claim selected) and the per-desk DeskSheet, so every surface runs the exact
 * same validated path: signer check → vault readiness → executeClaimYield → hub cache
 * invalidate → caller refetch. `pendingLamports`, when given, is the sum of the lamport-equivalent
 * yield being claimed across `assets` — used to estimate the $OTC the vault must actually hand
 * over (at the pot's lifetime average buy rate) so `executeClaimYield` can bail out up front with
 * a clear message if the keeper-fed vault is momentarily underfunded, instead of the claim reaching
 * `/simulate` and failing there with an opaque SPL error. */
export function useClaimRunner(address: string, state: ProtocolState, onClaimed?: () => void) {
  const { connection, program, resolveSigner } = useHub();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<ClaimPhase | null>(null);
  const [logs, setLogs] = useState<TxLog[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const run = async (assets: string[], pendingLamports?: number) => {
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
    // try/finally: a claim that throws anywhere must still clear busy/phase — a stuck spinner
    // with a dead claim behind it is the worst possible failure mode for a money-moving button.
    try {
      const res = await executeClaimYield({
        connection,
        program,
        signer,
        assets,
        config: state.config,
        otcPot,
        estimatedOtcDueUnits:
          pendingLamports != null ? (otcDueForLamports(pendingLamports, otcPot) ?? undefined) : undefined,
        onLog: (l) => setLogs((p) => [...p, l]),
        onPhase: setPhase,
      });
      if (res.some((r) => r.ok)) {
        await qc.invalidateQueries({ queryKey: ["hub"] });
        onClaimed?.();
      }
    } catch (e) {
      setErr((e as Error).message ?? "claim failed unexpectedly");
    } finally {
      setBusy(false);
      setPhase(null);
    }
  };

  return { run, busy, phase, logs, err };
}