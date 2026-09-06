import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync(new URL("../src/lib/useLauncherLive.js", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function setup(options = {}) {
  const module = { exports: {} };
  runInNewContext(compiled, { module, exports: module.exports, require: () => ({}) });
  const document = new EventTarget(), window = new EventTarget();
  document.hidden = false;
  const requests = [], data = [], errors = [], timers = new Map();
  const stop = module.exports.watchLauncherLive({
    params: options.params,
    invoke: (name, args) => {
      assert.equal(name, "getLauncherLive");
      // Compare across the VM/host realm boundary by value, not prototype.
      assert.equal(JSON.stringify(args), JSON.stringify(options.params ?? {}));
      const pending = deferred(); requests.push(pending); return pending.promise;
    },
    onData: (value) => data.push(value), onError: (value) => errors.push(value), document, window,
    setInterval: (fn, delay) => { assert.equal(delay, 30000); timers.set(1, fn); return 1; },
    clearInterval: (id) => timers.delete(id),
  });
  return { requests, data, errors, timers, stop, document, window, poll: () => timers.get(1)(),
    focus: () => window.dispatchEvent(new Event("focus")),
    hidden: (value) => { document.hidden = value; document.dispatchEvent(new Event("visibilitychange")); } };
}
const response = (at, ranked = []) => ({ data: { at, ranked } });

test("live poll starts immediately, coalesces overlapping triggers and refreshes every30s", async () => {
  const s = setup();
  assert.equal(s.requests.length, 1);
  s.poll(); s.focus();
  assert.equal(s.requests.length, 1);
  s.requests[0].resolve(response(100)); await tick();
  s.poll();
  assert.equal(s.requests.length, 2);
  s.requests[1].resolve(response(200, [{ mint: "new-leader" }])); await tick();
  assert.deepEqual(s.data.map((d) => d.at), [100, 200]);
  s.stop();
});

test("hidden tabs pause requests, focus resumes, cleanup ignores late responses", async () => {
  const s = setup(); s.requests[0].resolve(response(100)); await tick();
  s.hidden(true); s.poll(); s.focus(); assert.equal(s.requests.length, 1);
  s.hidden(false); assert.equal(s.requests.length, 2);
  s.stop(); s.requests[1].resolve(response(200)); await tick();
  assert.equal(s.data.length, 1); assert.equal(s.timers.size, 0);
  s.focus(); s.hidden(false); assert.equal(s.requests.length, 2);
});

test("feed params ride along on every poll", async () => {
  const s = setup({ params: { page: 2, pageSize: 50, status: "BONDING", sort: "vol24", maxAgeHours: 24 } });
  assert.equal(s.requests.length, 1);
  s.requests[0].resolve(response(100)); await tick();
  s.poll();
  s.requests[1].resolve(response(200, [{ mint: "paged" }])); await tick();
  assert.deepEqual(s.data.map((d) => d.at), [100, 200]);
  s.stop();
});

test("failed or malformed refresh preserves last snapshot with a stale warning and recovers", async () => {
  const s = setup(); s.requests[0].resolve(response(100)); await tick();
  s.poll(); s.requests[1].reject(new Error("private upstream details")); await tick();
  assert.equal(s.data.length, 1); assert.match(s.errors.at(-1), /may be stale/);
  assert.doesNotMatch(s.errors.at(-1), /private/);
  s.poll(); s.requests[2].resolve({ data: { error: "bad" } }); await tick();
  assert.equal(s.data.length, 1);
  s.poll(); s.requests[3].resolve(response(400)); await tick();
  assert.equal(s.errors.at(-1), null); assert.equal(s.data.at(-1).at, 400);
  s.stop();
});