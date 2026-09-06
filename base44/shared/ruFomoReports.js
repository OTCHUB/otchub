import { SIGNAL_CODES, SIGNAL_STATUSES } from "./ruFomoContract.js";
import { assertKeys, integerParam, invalidParams } from "./apiHttp.js";
import { isTokenMint } from "./ruFomoStrategy.js";

export const REPORT_FIELDS = ["signalId", "mint", "status", "signature", "code"];
const ID = /^RU_FOMO:(0|[1-9][0-9]{0,10}):([1-9A-HJ-NP-Za-km-z]{32,44})$/;
const CURSOR = /^[0-9]{16}:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function sanitizeReport(body) {
  assertKeys(body, REPORT_FIELDS);
  const match = typeof body.signalId === "string" && ID.exec(body.signalId);
  if (!match || !isTokenMint(body.mint) || match[2] !== body.mint
    || !SIGNAL_STATUSES.includes(body.status) || !SIGNAL_CODES.includes(body.code)) throw invalidParams();
  if (body.signature !== undefined && body.signature !== null
    && (typeof body.signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(body.signature))) throw invalidParams();
  return { signalId: body.signalId, mint: body.mint, status: body.status, code: body.code,
    ...(body.signature == null ? {} : { signature: body.signature }) };
}

export function logParams(params, fromQuery, now) {
  assertKeys(params, ["action", "limit", "before", "cursor"]);
  const limit = integerParam(params.limit, 50, 1, 100, fromQuery);
  const before = integerParam(params.before, now + 1, 0, now + 1, fromQuery);
  if (params.cursor !== undefined && (params.before !== undefined || typeof params.cursor !== "string"
    || !CURSOR.test(params.cursor) || Number(params.cursor.slice(0, 16)) > now)) throw invalidParams();
  // A single ordering field encodes timestamp plus UUID to page through
  // equal timestamps without dropping reports. before is an exclusive epoch-ms bound.
  return { limit, cursor: params.cursor ?? `${String(before).padStart(16, "0")}:` };
}

export function publicLog(record) {
  if (!Number.isSafeInteger(record.at) || record.at < 0 || !CURSOR.test(record.logKey)
    || Number(record.logKey.slice(0, 16)) !== record.at) throw invalidParams();
  const fields = Object.fromEntries(REPORT_FIELDS.filter((key) => Object.hasOwn(record, key)).map((key) => [key, record[key]]));
  return { at: record.at, cursor: record.logKey, ...sanitizeReport(fields) };
}