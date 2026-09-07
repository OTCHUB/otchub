import React, { useEffect, useRef, useState } from "react";
import CopyBlock from "@/components/otc/CopyBlock";
import { PUBLIC_API_META } from "../../../base44/shared/publicApiCatalog.js";
import {
  getPublicApiBaseUrl, getPublicApiStatus, isPublicSnapshotStale,
  PUBLIC_PROBE_TIMEOUT_MS, PUBLIC_SNAPSHOT_TTL_MS, readPublicMetricsSnapshot,
} from "@/lib/publicApi";

const timestamp = (at) => `${new Date(at).toISOString()} (${at} ms)`;

export default function ApiAgentPanel() {
  const baseUrl = getPublicApiBaseUrl(typeof window === "undefined" ? undefined : window.location.origin);
  const [probe, setProbe] = useState({ phase: "idle", snapshot: null, checkedAt: null, error: null });
  const [now, setNow] = useState(Date.now);
  const active = useRef(null);

  useEffect(() => () => {
    const request = active.current;
    active.current = null;
    if (request) {
      clearTimeout(request.timer);
      request.controller.abort();
    }
  }, []);

  // Age an observed snapshot locally; this timer never makes another request.
  useEffect(() => {
    if (!probe.snapshot || isPublicSnapshotStale(probe.snapshot, now)) return;
    const delay = probe.snapshot.at + PUBLIC_SNAPSHOT_TTL_MS - Date.now();
    const timer = setTimeout(() => setNow(Date.now()), Math.min(2147483647, Math.max(0, delay) + 1));
    return () => clearTimeout(timer);
  }, [probe.snapshot, now]);

  const checkPublicRead = async () => {
    if (active.current) return;
    const request = { controller: new AbortController(), timer: null, timedOut: false };
    active.current = request;
    setProbe((previous) => ({ ...previous, phase: "loading", error: null }));
    request.timer = setTimeout(() => {
      request.timedOut = true;
      request.controller.abort();
    }, PUBLIC_PROBE_TIMEOUT_MS);
    let result;
    try {
      const response = await fetch(`${baseUrl}getPublicMetrics`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sort: "change24h", limit: 1 }),
        mode: "same-origin", credentials: "omit", redirect: "error", cache: "no-store",
        signal: request.controller.signal,
      });
      if (!response.ok) {
        result = { phase: "error", error: `Public read returned HTTP ${response.status}. Availability is not verified.` };
      } else {
        const snapshot = readPublicMetricsSnapshot(await response.json());
        result = snapshot
          ? { phase: "success", snapshot, error: null }
          : { phase: "error", error: "Unexpected metrics schema. API availability is not verified." };
      }
    } catch {
      // Never display raw server bodies or provider/network exception messages.
      result = { phase: "error", error: request.timedOut
        ? `Public read timed out after ${PUBLIC_PROBE_TIMEOUT_MS / 1000}s.`
        : "Public read failed. Check hosting or network; API availability is not verified." };
    } finally {
      clearTimeout(request.timer);
      // Ignore a response that arrives after unmount/StrictMode cleanup.
      if (active.current === request) {
        active.current = null;
        const checkedAt = Date.now();
        setNow(checkedAt);
        setProbe((previous) => ({ ...previous, ...result, checkedAt }));
      }
    }
  };

  return (
    <section aria-label="Hosted API dashboard" className="min-w-0 space-y-2 border border-emerald-500/30 bg-black p-2 font-mono text-[12px] leading-relaxed text-green-300 break-words [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[12px] uppercase tracking-widest text-cyan-300">API_AGENT :: HOSTED FUNCTIONS</h3>
        <button type="button" onClick={checkPublicRead} disabled={probe.phase === "loading"}
          className="border border-emerald-500/50 px-2 py-1 text-emerald-300 hover:bg-emerald-500/10 disabled:cursor-wait disabled:opacity-50">
          {probe.phase === "loading" ? "[CHECKING…]" : probe.checkedAt === null ? "[CHECK PUBLIC API]" : "[REFRESH PUBLIC CHECK]"}
        </button>
      </div>
      <CopyBlock label="HOSTED BASE :: SAME ORIGIN" value={baseUrl}
        note="Hosted /functions/ routes; frontend-only development may not serve them. Catalog entries are known contracts, not deployment checks." />
      <p>Only getPublicMetrics is probed: POST {"{sort: 'change24h', limit: 1}"}. No credentials, protected requests, or automatic polling. Timeout: {PUBLIC_PROBE_TIMEOUT_MS / 1000}s.</p>
      <div role="status" aria-live="polite" aria-busy={probe.phase === "loading"} className="space-y-1 text-cyan-300/80">
        <p>LAST CHECKED :: {probe.checkedAt === null ? "NEVER" : timestamp(probe.checkedAt)} (browser check time, not source at)</p>
        {probe.phase === "loading" && <p>Checking public read only…</p>}
        {probe.error && <p className="text-amber-300">{probe.error} Protected routes remain unprobed.</p>}
        {probe.snapshot && <div>
          <p>LAST SUCCESSFUL READ :: {isPublicSnapshotStale(probe.snapshot, now) ? "STALE" : "WITHIN 300s SNAPSHOT WINDOW"} · upstream cache: {probe.snapshot.cache}</p>
          <p>SOURCE at :: {timestamp(probe.snapshot.at)}</p>
          <p>FRESHNESS ENDS :: {timestamp(probe.snapshot.at + PUBLIC_SNAPSHOT_TTL_MS)}</p>
          <p>Prior read evidence only; not a continuous uptime or current deployment guarantee.</p>
        </div>}
      </div>
      <ul className="space-y-2" aria-label="Known API routes">
        {PUBLIC_API_META.endpoints.map((endpoint) => (
          <li key={endpoint.name} className="min-w-0 border border-green-500/20 p-2">
            <div className="flex flex-wrap justify-between gap-1">
              <h4 className="text-cyan-300">{endpoint.name}</h4>
              <span className="text-emerald-300">{getPublicApiStatus(endpoint, probe, now)}</span>
            </div>
            <p>{endpoint.methods.join(" / ")} · {endpoint.namespace} · access: {endpoint.access}</p>
            <p className="break-all text-green-400/80">{baseUrl}{endpoint.name}</p>
            <p>RATE :: {endpoint.rateLimit.limit} requests / {endpoint.rateLimit.windowSeconds}s · {endpoint.rateLimit.scope}</p>
            <p>{endpoint.access === "public"
              ? `UPSTREAM ANALYTICS CACHE :: ${endpoint.cacheTtlSeconds}s (5 min); not a rate limit`
              : "PRIVATE RESPONSE :: Cache-Control: no-store; upstream analytics may still use the 300s cache"}</p>
          </li>
        ))}
      </ul>
      <p className="text-green-400/80">Limits and cache/single-flight are per-isolate, not global quotas. Production needs an edge rate limiter. Analytics allow 1,800s (30 min) stale-on-error fallback; stale/expired data never produces signals. This check bypasses browser cache, not the upstream 300s analytics cache.</p>
      <details className="min-w-0 border border-cyan-500/20">
        <summary className="cursor-pointer px-2 py-1 text-cyan-300">Documentation :: schemas, examples, units &amp; access</summary>
        <div className="space-y-2 border-t border-cyan-500/20 p-2">
          <p>SYNTHETIC EXAMPLES ONLY — not live responses, current market data, enabled-state evidence, or trading recommendations.</p>
          <p>HUMAN UNITS :: vol24 / volume24hUsd, mcap / marketCapUsd and liquidityUsd are USD, not atomic token amounts. change24h / change24hPct are percent (12 = 12%). null means unknown, not zero. baseAsset SOL means SOL-funded buys.</p>
          <p>TIME :: at is source snapshot time in epoch milliseconds, never request time. createdAt / expiresAt use epoch milliseconds. Signal expiry is no later than at + 300000ms (5 min); consumers must reject expired signals.</p>
          <p>SCOPE :: top-60-volume cohort, not every launch. Sort by change24h (default), vol24 or mcap; limit 1–60 (default 15). Unknown/non-finite metrics sort last; ties retain source order.</p>
          <p>THRESHOLDS :: server/operator configuration only; not accepted from request parameters. Defaults: volume ≥ $100,000, 24h change 10–100%, liquidity ≥ $25,000. Invalid configuration fails closed. RU_FOMO signals are disabled by default; runtime settings are NOT PROBED.</p>
          <p>MOMENTUM LIMITATION :: 24h price change is a momentum proxy, not measured statistical volatility. Poll ruFomoSignals with GET/POST; action=logs reads caller-reported outcomes, not verified on-chain confirmations. POST ruFomoReport records a sanitized execution report for an issued signal.</p>
          <p>Public getPublicMetrics accepts GET query or POST JSON; view=meta serves the catalog. This panel uses bundled static metadata and does not probe that view or protected endpoints.</p>
          <CopyBlock label="HEADERS :: PROTECTED API DOCUMENTATION ONLY"
            value={'Content-Type: application/json\nAuthorization: Bearer <operator API key>'}
            note="Placeholder only. Use HTTPS from the operator service. Never put keys in URLs, frontend bundles, or this dashboard. No credential inputs or automatic trading." />
          <div className="max-h-80 overflow-auto">
            <CopyBlock label="EXAMPLES :: SYNTHETIC JSON" value={JSON.stringify(PUBLIC_API_META.examples, null, 2)}
              note="Illustrative payloads only; not actual token recommendations or live API responses." />
          </div>
          <div className="max-h-80 overflow-auto">
            <CopyBlock label="SCHEMAS :: PUBLIC WIRE CONTRACT" value={JSON.stringify(PUBLIC_API_META.schemas, null, 2)}
              note="Validate schemaVersion, numeric units, and timestamps before consuming signals." />
          </div>
          <ul className="space-y-1 text-green-400/80">
            {PUBLIC_API_META.notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </div>
      </details>
    </section>
  );
}