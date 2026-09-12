import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useHub } from "../HubProvider";
import {
  executeOpenOtcTickers,
  fetchMissingOtcTickers,
  resolveOtcTokenPrograms,
  type NativeActivatePhase,
  type OtcTicker,
} from "../lib/otcActivate";
import type { TxLog } from "../lib/swap";

/** Drives the "open native OTC stock accounts" action for one desk — mainnet-only (see
 *  otcActivate.ts's doc on why the vault itself can never be user-created). Lazily loads which
 *  ticker accounts are still missing the moment the desk's `nativeActive` status is known true, so
 *  the DeskSheet only pays the extra RPC round trip when the action can actually apply. */
export function useOtcActivate(asset: string, nativeActive: boolean | null) {
  const { connection, cluster, resolveSigner } = useHub();
  const qc = useQueryClient();
  const [missing, setMissing] = useState<OtcTicker[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<NativeActivatePhase | null>(null);
  const [logs, setLogs] = useState<TxLog[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const enabled = cluster === "mainnet-beta" && nativeActive === true;

  useEffect(() => {
    if (!enabled) {
      setMissing(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const tpMap = await resolveOtcTokenPrograms(connection);
        const gap = await fetchMissingOtcTickers(connection, asset, tpMap);
        if (!cancelled) setMissing(gap);
      } catch {
        if (!cancelled) setMissing(null); // best-effort — no button offered on a failed read
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, asset, connection]);

  const run = async (address: string) => {
    setErr(null);
    const signer = resolveSigner(address);
    if (!signer) return setErr("read-only address — connect the wallet itself to sign");
    if (!missing?.length) return;
    setBusy(true);
    setLogs([]);
    const tpMap = await resolveOtcTokenPrograms(connection);
    const res = await executeOpenOtcTickers({
      connection,
      signer,
      asset,
      tickers: missing,
      tokenProgramMap: tpMap,
      onLog: (l) => setLogs((p) => [...p, l]),
      onPhase: setPhase,
    });
    setBusy(false);
    setPhase(null);
    if (res.ok) {
      await qc.invalidateQueries({ queryKey: ["hub"] });
      const gap = await fetchMissingOtcTickers(connection, asset, tpMap);
      setMissing(gap);
    } else if (res.reason) {
      setErr(res.reason);
    }
  };

  return { enabled, missing, loading, busy, phase, logs, err, run };
}
