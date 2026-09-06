import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("Deno entry wires the existing Helius helper and pinned web3 deriver into one isolate handler", () => {
  // Compile only our entry; do not load otcSources or any runtime/secret module.
  const source = readFileSync(new URL("../base44/functions/getLauncherLive/entry.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const PublicKey = class {}, rpc = () => {}, derive = () => {}, handler = () => {};
  let factories = 0;
  const modules = {
    "npm:@solana/web3.js@1.98.4": { PublicKey },
    "../../shared/otcSources.ts": { heliusRpc: rpc },
    "../../shared/launcherCurve.js": { createCurveAddressDeriver: (key) => {
      assert.equal(key, PublicKey);
      return derive;
    } },
    "./handler.js": { createLauncherLiveHandler: (dependencies) => {
      assert.equal(dependencies.rpc, rpc);
      assert.equal(dependencies.deriveCurveAddress, derive);
      factories++;
      return handler;
    } },
  };
  const module = { exports: {} };
  runInNewContext(compiled, { module, exports: module.exports, require: (name) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected entry import: ${name}`);
    return modules[name];
  } });
  assert.equal(factories, 1);
  assert.equal(module.exports.default, handler);
});