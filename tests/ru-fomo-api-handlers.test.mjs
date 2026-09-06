import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createRuFomoSignalsHandler } from "../base44/functions/ruFomoSignals/handler.js";
import { createRuFomoReportHandler } from "../base44/functions/ruFomoReport/handler.js";
import { readJsonBounded } from "../base44/shared/apiHttp.js";
import { AT, MINT, HASH, ROW, TEST_KEY, reportBody, request, setup } from "./ru-fomo-api-fixtures.mjs";

async function error(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  const body = await response.json();
  assert.equal(body.error.code, code);
  assert.deepEqual(Object.keys(body), ["error"]);
  assert.deepEqual(Object.keys(body.error), ["code", "message"]);
  return body;
}

test("auth fails closed for missing, malformed and throwing configuration without side effects", async () => {
  for (const hash of [undefined, null, "", "bad", "g".repeat(64), "a".repeat(63), ` ${HASH}`, {}, 123]) {
    const s = setup({ RU_FOMO_API_KEY_SHA256: hash });
    await error(await s.poll(request()), 503, "CONFIG_INVALID");
    await error(await s.report(request("ruFomoReport", { method: "POST", body: reportBody() })), 503, "CONFIG_INVALID");
    assert.deepEqual(s.calls, []);
  }
  const s = setup();
  const handler = createRuFomoSignalsHandler({ ...s.deps, getConfig: () => { throw Error("unsafe-detail"); } });
  assert.doesNotMatch(JSON.stringify(await error(await handler(request()), 503, "CONFIG_INVALID")), /unsafe-detail/);
  const reportHandler = createRuFomoReportHandler({ ...s.deps, getConfig: () => { throw Error("unsafe-detail"); } });
  await error(await reportHandler(request("ruFomoReport", { method: "POST", body: reportBody() })), 503, "CONFIG_INVALID");
  assert.deepEqual(s.calls, []);
});

test("bad bearer authorization and spoofed admin headers cannot reach any private data", async () => {
  for (const auth of [null, "", "Basic abc", "Bearer", "Bearer wrong", `Bearer ${HASH}`,
    `Bearer ${TEST_KEY}, Bearer ${TEST_KEY}`, `Bearer ${"a".repeat(513)}`]) {
    const s = setup();
    await error(await s.poll(request("ruFomoSignals", { auth, headers: { "X-User-Role": "admin" } })), 401, "AUTH_REQUIRED");
    await error(await s.report(request("ruFomoReport", { method: "POST", body: reportBody(), auth })), 401, "AUTH_REQUIRED");
    assert.deepEqual(s.calls, []);
  }
  const s = setup({ RU_FOMO_API_KEY_SHA256: HASH.toUpperCase() });
  assert.equal((await s.poll(request("ruFomoSignals", { auth: `bearer ${TEST_KEY}` }))).status, 200);
});

test("query credentials, URL injection, plaintext transport, and huge URLs are rejected", async () => {
  const s = setup();
  for (const query of ["api_key=x", "apiKey=x", "token=x", "authorization=x", "%61piKey=x", "__proto__=x", "view=meta"]) {
    await error(await s.poll(request(`ruFomoSignals?${query}`)), 400, "INVALID_PARAMS");
  }
  await error(await s.poll(new Request("http://example.test/functions/ruFomoSignals")), 400, "HTTPS_REQUIRED");
  await error(await s.poll(request(`ruFomoSignals?action=${"x".repeat(2050)}`)), 414, "REQUEST_TOO_LARGE");
  assert.deepEqual(s.calls, []);
});

test("disabled-by-default poll and preflight make no source/entity calls; all responses are no-store", async () => {
  const s = setup({ RU_FOMO_SIGNALS_ENABLED: undefined });
  const response = await s.poll(request());
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { schemaVersion: 1, namespace: "RU_FOMO", at: AT, stale: false, enabled: false, signals: [] });
  for (const handler of [s.poll, s.report]) {
    const options = await handler(request("ruFomoSignals", { method: "OPTIONS", auth: null }));
    assert.equal(options.status, 204);
    assert.equal(options.headers.get("Cache-Control"), "no-store");
  }
  await error(await s.poll(request("ruFomoSignals", { method: "DELETE" })), 405, "METHOD_NOT_ALLOWED");
  await error(await s.report(request("ruFomoReport")), 405, "METHOD_NOT_ALLOWED");
  assert.deepEqual(s.calls, []);
});

test("strict poll/log parameter allowlists reject strategy overrides and operator injection", async () => {
  const s = setup();
  for (const body of [[], null, 1, { action: null }, { action: { $ne: "logs" } }, { action: "buy" },
    { limit: 1 }, { minVolume: 0 }, { mint: MINT }, { action: "poll", enabled: true },
    { action: "logs", limit: 0 }, { action: "logs", limit: 101 }, { action: "logs", limit: "1" },
    { action: "logs", before: { $ne: null } }, { action: "logs", before: AT + 2 },
    { action: "logs", before: null }, { action: "logs", cursor: "x" },
    { action: "logs", sort: "$where" }, { action: "logs", skip: 1000000 }]) {
    await error(await s.poll(request("ruFomoSignals", { method: "POST", body })), 400, "INVALID_PARAMS");
  }
  for (const query of ["action=logs&limit=01", "action=logs&limit=1.1", "action=logs&limit=1e2",
    "action=logs&action=poll", "action=logs&before=-1"]) {
    await error(await s.poll(request(`ruFomoSignals?${query}`)), 400, "INVALID_PARAMS");
  }
  await error(await s.poll(request("ruFomoSignals?action=poll", { method: "POST", body: {} })), 400, "INVALID_PARAMS");
  await error(await s.poll(request("ruFomoSignals", { method: "POST", raw: '{"__proto__":{"polluted":true}}' })), 400, "INVALID_PARAMS");
  for (const raw of ['{"action":"logs","action":"poll"}', '{"action":"logs","\\u0061ction":"poll"}']) {
    await error(await s.poll(request("ruFomoSignals", { method: "POST", raw })), 400, "INVALID_PARAMS");
  }
  assert.deepEqual(s.calls, []);
  assert.equal({}.polluted, undefined);
});

test("bounded streaming reads enforce size before parse, media type, malformed JSON and read timeout", async () => {
  const s = setup();
  for (const handler of [s.poll, s.report]) {
    await error(await handler(request("ruFomoSignals", { method: "POST", raw: "x".repeat(4097) })), 413, "REQUEST_TOO_LARGE");
    await error(await handler(request("ruFomoSignals", { method: "POST", raw: "{}", headers: { "Content-Length": "99999" } })), 413, "REQUEST_TOO_LARGE");
    await error(await handler(request("ruFomoSignals", { method: "POST", raw: "{}", headers: { "Content-Type": "text/plain" } })), 415, "UNSUPPORTED_MEDIA_TYPE");
    await error(await handler(request("ruFomoSignals", { method: "POST", raw: "{" })), 400, "INVALID_PARAMS");
  }
  let cancelled = false;
  const streaming = new Request("https://example.test", { method: "POST", duplex: "half",
    headers: { "Content-Type": "application/json", "Content-Length": "1" },
    body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(4097)); }, cancel() { cancelled = true; } }) });
  await assert.rejects(readJsonBounded(streaming), { code: "REQUEST_TOO_LARGE" });
  assert.equal(cancelled, true);
  const stalled = new Request("https://example.test", { method: "POST", duplex: "half",
    headers: { "Content-Type": "application/json" }, body: new ReadableStream() });
  await assert.rejects(readJsonBounded(stalled, 4096, 5), { code: "REQUEST_TIMEOUT" });
  assert.deepEqual(s.calls, []);
});

test("fresh signals persist before response and retain the same identity/payload on retries", async () => {
  const s = setup();
  s.state.ranked.push({ ...ROW, change24h: 30 });
  const responses = await Promise.all([s.poll(request()), s.poll(request()), s.poll(request())]);
  const bodies = await Promise.all(responses.map((r) => r.json()));
  assert.equal(s.signals.length, 1, "in-isolate issuance shares an in-flight write");
  assert.equal(bodies[0].signals.length, 1);
  assert.deepEqual(bodies[1], bodies[0]);
  s.state.ranked[0].change24h = 20;
  assert.deepEqual((await (await s.poll(request())).json()).signals, bodies[0].signals);
  assert.equal(s.signals.length, 1);
  const find = s.calls.find(([name]) => name === "find");
  assert.deepEqual(find.slice(1), [{ signalId: bodies[0].signals[0].id, mint: MINT }, "createdAt", 1, 0]);
});

test("failed persistence produces only sanitized errors and retries are not stuck", async () => {
  const s = setup();
  const create = s.store.createSignal;
  s.store.createSignal = async () => { throw Error("unsafe-provider-detail"); };
  const body = await error(await s.poll(request()), 500, "INTERNAL_ERROR");
  assert.doesNotMatch(JSON.stringify(body), /unsafe-provider-detail/);
  assert.deepEqual(s.signals, []);
  s.store.createSignal = create;
  assert.equal((await (await s.poll(request())).json()).signals.length, 1);
});

test("cross-isolate read/create races may persist duplicate rows but never change wire identity", async () => {
  const s = setup();
  let readers = 0, release;
  const barrier = new Promise((resolve) => { release = resolve; });
  s.store.findSignal = async () => {
    if (++readers === 2) release();
    await barrier;
    return null;
  };
  const otherIsolate = createRuFomoSignalsHandler(s.deps);
  const responses = await Promise.all([s.poll(request()), otherIsolate(request())]);
  const bodies = await Promise.all(responses.map((r) => r.json()));
  assert.equal(s.signals.length, 2);
  assert.equal(bodies[0].signals[0].id, bodies[1].signals[0].id);
});

test("persisted signal projections cannot leak extra fields or extend an older snapshot's expiry", async () => {
  const s = setup();
  await s.poll(request());
  s.signals[0].metrics.internal = "not-for-wire";
  assert.equal((await (await s.poll(request())).json()).signals[0].metrics.internal, undefined);
  s.advance(1000);
  s.signals[0].createdAt += 500;
  s.signals[0].expiresAt += 500;
  assert.deepEqual((await (await s.poll(request())).json()).signals, []);
});

test("stale/future/expired snapshots and expiry during entity I/O never emit signals", async () => {
  for (const change of [{ stale: true }, { cache: "stale" }, { at: AT + 1 }, { at: AT - 300000 }]) {
    const s = setup();
    Object.assign(s.state, change);
    await error(await s.poll(request()), 503, "STALE_DATA");
    assert.equal(s.calls.some(([name]) => name === "store"), false);
  }
  const s = setup();
  const create = s.store.createSignal;
  s.store.createSignal = async (signal) => { await create(signal); s.advance(300000); return signal; };
  assert.deepEqual((await (await s.poll(request())).json()).signals, []);
  const failing = createRuFomoSignalsHandler({ ...s.deps, getAnalytics: async () => { throw Error("unsafe-source-detail"); } });
  await error(await failing(request()), 502, "PROVIDER_ERROR");
});

test("reports must reference persisted signals, allow late reconciliation and remain append-only", async () => {
  const s = setup();
  await error(await s.report(request("ruFomoReport", { method: "POST", body: reportBody() })), 404, "INVALID_SIGNAL");
  assert.equal(s.reports.length, 0);
  await s.poll(request());
  s.advance(300001);
  for (const body of [reportBody(), reportBody({ status: "confirmed", code: "CONFIRMED", signature: "3".repeat(88) })]) {
    const response = await s.report(request("ruFomoReport", { method: "POST", body }));
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), { schemaVersion: 1, namespace: "RU_FOMO", accepted: true });
  }
  assert.equal(s.reports.length, 2);
  assert.equal(s.reports[0].status, "dry_run");
  assert.equal(s.reports[1].status, "confirmed");
  assert.equal(s.signals.length, 1);
});

test("report arbitrary errors, transaction bytes, invalid enum and mismatched IDs are rejected before entity access", async () => {
  const s = setup();
  for (const change of [{ error: "provider details" }, { message: "anything" }, { transaction: "bytes" },
    { status: "success" }, { code: "arbitrary text" }, { code: { $ne: null } }, { signalId: { $ne: null } },
    { signalId: `RU_FOMO:06000000:${MINT}` }, { mint: "SOL" }, { signature: "not/a/signature" },
    { signature: "3".repeat(89) }, { action: "sell" }]) {
    await error(await s.report(request("ruFomoReport", { method: "POST", body: reportBody(change) })), 400, "INVALID_PARAMS");
  }
  await error(await s.report(request("ruFomoReport?token=x", { method: "POST", body: reportBody() })), 400, "INVALID_PARAMS");
  assert.deepEqual(s.calls, []);
});

test("report storage failures are sanitized and do not imply acceptance", async () => {
  const s = setup();
  await s.poll(request());
  s.store.appendReport = async () => { throw Error("unsafe-db-detail"); };
  assert.doesNotMatch(JSON.stringify(await error(await s.report(request("ruFomoReport",
    { method: "POST", body: reportBody() })), 500, "INTERNAL_ERROR")), /unsafe-db-detail/);
});

test("logs are sanitized, timestamp bounded and cursor-paginated without skipping timestamp ties", async () => {
  const s = setup();
  await s.poll(request());
  for (let i = 0; i < 3; i++) await s.report(request("ruFomoReport", { method: "POST", body: reportBody() }));
  s.reports[0].internalOnly = "not-for-wire";
  s.config.RU_FOMO_SIGNALS_ENABLED = "false";
  const first = await s.poll(request("ruFomoSignals?action=logs&limit=2"));
  const body = await first.json();
  assert.deepEqual(Object.keys(body), ["schemaVersion", "namespace", "logs"]);
  assert.equal(body.logs.length, 2);
  const cursor = first.headers.get("X-Next-Cursor");
  assert.equal(cursor, body.logs[1].cursor);
  const second = await s.poll(request("ruFomoSignals", { method: "POST", body: { action: "logs", cursor, limit: 2 } }));
  const next = await second.json();
  assert.equal(next.logs.length, 1);
  assert.equal(new Set([...body.logs, ...next.logs].map((r) => r.cursor)).size, 3);
  assert.equal(next.logs[0].internalOnly, undefined);
  const before = await s.poll(request(`ruFomoSignals?action=logs&before=${AT}`));
  assert.deepEqual((await before.json()).logs, []);
  assert.deepEqual(s.calls.find(([name]) => name === "logs").slice(2), ["-logKey", 2, 0]);
  await error(await s.poll(request("ruFomoSignals", { method: "POST",
    body: { action: "logs", before: AT, cursor } })), 400, "INVALID_PARAMS");
});

test("protected endpoints share a rolling 60/min credential quota with Retry-After and no-store", async () => {
  const s = setup();
  await s.poll(request());
  const responses = await Promise.all(Array.from({ length: 59 }, () => s.report(request("ruFomoReport", { method: "POST", body: reportBody() }))));
  assert.ok(responses.every((r) => r.status === 201));
  const limited = await s.poll(request());
  assert.equal(limited.headers.get("Retry-After"), "60");
  assert.equal(limited.headers.get("RateLimit-Limit"), "60");
  assert.equal(limited.headers.get("X-RateLimit-Remaining"), "0");
  await error(limited, 429, "RATE_LIMITED");
  s.advance(59999);
  const almost = await s.report(request("ruFomoReport", { method: "POST", body: reportBody() }));
  assert.equal(almost.headers.get("Retry-After"), "1");
  await error(almost, 429, "RATE_LIMITED");
  s.advance(1);
  assert.equal((await s.report(request("ruFomoReport", { method: "POST", body: reportBody() }))).status, 201);
  const secondKey = "another-unit-test-only-key";
  s.config.RU_FOMO_API_KEY_SHA256 = createHash("sha256").update(secondKey).digest("hex");
  const rotated = await s.report(request("ruFomoReport", { method: "POST", body: reportBody(), auth: `Bearer ${secondKey}` }));
  assert.equal(rotated.headers.get("RateLimit-Remaining"), "59");
});