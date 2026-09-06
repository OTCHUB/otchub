import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";

export const LAUNCHER_POLL_MS = 30_000;

// One request at a time. No background-tab polling; resume immediately on focus.
// SDK requests cannot be aborted, so late/unmounted results are ignored instead.
export function watchLauncherLive({ invoke, onData, onError, document, window,
  setInterval, clearInterval }) {
  let stopped = false, pending = false;
  const refresh = async () => {
    if (stopped || pending || document.hidden) return;
    pending = true;
    try {
      const result = await invoke("getLauncherLive", {});
      const data = result?.data;
      if (data?.error || !Array.isArray(data?.ranked) || !Number.isFinite(data.at)) {
        throw new Error("Launcher feed unavailable");
      }
      if (!stopped) { onData(data); onError(null); }
    } catch {
      if (!stopped) onError("Live refresh failed; displayed data may be stale.");
    } finally { pending = false; }
  };
  refresh();
  const timer = setInterval(refresh, LAUNCHER_POLL_MS);
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("focus", refresh);
  return () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", refresh);
    window.removeEventListener("focus", refresh);
  };
}

export function useLauncherLive() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => watchLauncherLive({
    invoke: (name, body) => base44.functions.invoke(name, body),
    onData: setData, onError: setError, document, window, setInterval, clearInterval,
  }), []);
  return { data, error };
}