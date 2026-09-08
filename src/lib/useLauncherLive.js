import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { fetchLauncherLiveMirror, projectLauncherView } from "@/lib/launcherFeed";

export const LAUNCHER_POLL_MS = 30_000;

// One request at a time. No background-tab polling; resume immediately on focus.
// SDK requests cannot be aborted, so late/unmounted results are ignored instead.
export function watchLauncherLive({ invoke, onData, onError, document, window,
  setInterval, clearInterval, params = {} }) {
  let stopped = false, pending = false;
  const refresh = async () => {
    if (stopped || pending || document.hidden) return;
    pending = true;
    try {
      const result = await invoke("getLauncherLive", { ...params });
      const data = result?.data;
      if (data?.error || !Array.isArray(data?.ranked) || !Number.isFinite(data.at)) {
        throw new Error("Launcher feed unavailable");
      }
      if (!stopped) { onData(data); onError(null); }
    } catch {
      // Live endpoint down: fall back to the 5-min Supabase mirror (archived
      // tape, filtered/sorted/paged locally). A missing/unreachable mirror
      // keeps the old behavior — stale warning over the last snapshot.
      try {
        const mirror = await fetchLauncherLiveMirror();
        const view = projectLauncherView(mirror, params);
        if (!stopped) {
          onData(view);
          onError("Live feed unavailable — showing archived feed (refreshed every 5 min).");
        }
      } catch {
        if (!stopped) onError("Live refresh failed; displayed data may be stale.");
      }
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

export function useLauncherLive(params = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  // Restart the poller only when the requested feed view actually changes.
  const key = JSON.stringify(params ?? {});
  useEffect(() => watchLauncherLive({
    invoke: (name, body) => base44.functions.invoke(name, body),
    params: JSON.parse(key),
    onData: setData, onError: setError, document, window, setInterval, clearInterval,
  }), [key]);
  return { data, error };
}