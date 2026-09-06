import { randomUUID } from "node:crypto";
import { ApiError, requestParams } from "../../shared/apiHttp.js";
import { createPrivateHandler } from "../../shared/ruFomoAuth.js";
import { SIGNAL_NAMESPACE, SIGNAL_SCHEMA_VERSION } from "../../shared/ruFomoContract.js";
import { REPORT_FIELDS, sanitizeReport } from "../../shared/ruFomoReports.js";
import { isIssuedSignal } from "../../shared/ruFomoStrategy.js";

export function createRuFomoReportHandler({ getConfig, getStore, clock = Date.now, limiter, uuid = randomUUID }) {
  return createPrivateHandler({ getConfig, limiter, methods: ["POST"], queryKeys: [],
    async execute({ req, url, headers }) {
      const report = sanitizeReport(await requestParams(req, url, REPORT_FIELDS));
      const store = await getStore(req);
      const signal = await store.findSignal(report.signalId, report.mint);
      if (!isIssuedSignal(signal) || signal.id !== report.signalId || signal.mint !== report.mint
        || signal.createdAt > clock()) throw new ApiError(404, "INVALID_SIGNAL", "An issued signal is required.");
      const at = clock();
      // Late reports are valid (confirmation/reconciliation may follow expiry).
      // No update/delete path: every accepted caller claim is appended as-is after sanitization.
      await store.appendReport({ ...report, at, logKey: `${String(at).padStart(16, "0")}:${uuid()}` });
      return Response.json({ schemaVersion: SIGNAL_SCHEMA_VERSION, namespace: SIGNAL_NAMESPACE, accepted: true }, { status: 201, headers });
    },
  });
}