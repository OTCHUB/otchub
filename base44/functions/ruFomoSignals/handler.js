import { ApiError, assertKeys, requestParams } from "../../shared/apiHttp.js";
import { createPrivateHandler } from "../../shared/ruFomoAuth.js";
import { readAnalyticsSnapshot } from "../../shared/analyticsSnapshot.js";
import { SIGNAL_NAMESPACE, SIGNAL_SCHEMA_VERSION } from "../../shared/ruFomoContract.js";
import { eligibleMetrics, isIssuedSignal, signalCandidates, strategyConfig, SIGNAL_TTL_MS } from "../../shared/ruFomoStrategy.js";
import { logParams, publicLog } from "../../shared/ruFomoReports.js";

export function createRuFomoSignalsHandler({ getConfig, getAnalytics, getStore, clock = Date.now, limiter }) {
  const issuing = new Map();
  const envelope = { schemaVersion: SIGNAL_SCHEMA_VERSION, namespace: SIGNAL_NAMESPACE };
  const keys = ["action", "limit", "before", "cursor"];
  return createPrivateHandler({ getConfig, limiter, methods: ["GET", "POST"], queryKeys: keys,
    async execute({ req, url, headers, config }) {
      const params = await requestParams(req, url, keys);
      if (params.action === "logs") {
        const paging = logParams(params, req.method === "GET", clock());
        const store = await getStore(req);
        const rows = await store.listReports(paging);
        const logs = rows.slice(0, paging.limit).map(publicLog);
        if (logs.length === paging.limit) headers.set("X-Next-Cursor", logs.at(-1).cursor);
        return Response.json({ ...envelope, logs }, { headers });
      }
      assertKeys(params, ["action"]);
      if (params.action !== undefined && params.action !== "poll") throw new ApiError(400, "INVALID_PARAMS", "Invalid request parameters.");
      const strategy = strategyConfig(config);
      if (!strategy.enabled) return Response.json({ ...envelope, at: clock(), stale: false, enabled: false, signals: [] }, { headers });
      const snapshot = await readAnalyticsSnapshot(getAnalytics);
      if (snapshot.stale || snapshot.at > clock() || snapshot.at <= clock() - SIGNAL_TTL_MS) {
        throw new ApiError(503, "STALE_DATA", "A fresh analytics snapshot is required.");
      }
      const candidates = signalCandidates(snapshot, strategy, clock());
      const signals = [];
      if (candidates.length) {
        const store = await getStore(req);
        for (const candidate of candidates) {
          if (candidate.expiresAt <= clock()) continue;
          // Single-flight reduces local duplicate writes; it makes no global lock claim.
          if (!issuing.has(candidate.id)) {
            const promise = (async () => {
              const existing = await store.findSignal(candidate.id, candidate.mint);
              if (existing) return existing;
              if (candidate.expiresAt <= clock()) return null;
              return store.createSignal(candidate);
            })().finally(() => issuing.delete(candidate.id));
            issuing.set(candidate.id, promise);
          }
          const signal = await issuing.get(candidate.id);
          if (isIssuedSignal(signal) && signal.id === candidate.id && signal.createdAt <= clock()
            && signal.createdAt <= snapshot.at && signal.expiresAt <= snapshot.at + SIGNAL_TTL_MS
            && signal.expiresAt > clock() && eligibleMetrics(signal.metrics, strategy)) signals.push(signal);
        }
      }
      // Entity I/O can consume the remaining lifetime. Never send an expired signal.
      return Response.json({ ...envelope, at: snapshot.at, stale: false, enabled: true,
        signals: signals.filter((signal) => signal.expiresAt > clock() && signal.createdAt <= clock()) }, { headers });
    },
  });
}