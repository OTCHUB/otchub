import assert from "node:assert/strict";
import test from "node:test";
import { createClientFromRequest } from "@base44/sdk";
import { serviceRoleRequest } from "../base44/shared/ruFomoStore.js";

test("SDK service context drops operator bearer/cookies even after the POST body is consumed", async () => {
  // Nonfunctional synthetic placeholders only; no real credentials or network.
  const req = new Request("https://example.test/functions/ruFomoReport", {
    method: "POST", body: "{}", headers: {
      Authorization: "bearer synthetic-operator-placeholder", Cookie: "synthetic=placeholder",
      "on-behalf-of": "synthetic-must-not-forward", "X-Api-Key": "synthetic-must-not-forward",
      "Base44-Service-Authorization": "Bearer synthetic-service-placeholder",
      "Base44-App-Id": "synthetic-app", "Base44-Api-Url": "https://example.test",
      "X-Data-Env": "dev",
    },
  });
  await req.json();
  const context = serviceRoleRequest(req);
  assert.equal(context.body, null);
  for (const name of ["authorization", "cookie", "on-behalf-of", "x-api-key"]) {
    assert.equal(context.headers.has(name), false);
  }
  assert.equal(req.headers.has("authorization"), true, "Do not mutate the authorized request");
  assert.equal(context.headers.get("X-Data-Env"), "dev");
  // Exercise the installed SDK constructor and service-role gate without calling an entity.
  const client = createClientFromRequest(context);
  assert.equal(typeof client.asServiceRole.entities.RuFomoReport.create, "function");
});

test("missing host-injected service authorization never falls back to the operator bearer", () => {
  const req = new Request("https://example.test/functions/ruFomoSignals", {
    headers: { Authorization: "Bearer synthetic-operator-placeholder", "Base44-App-Id": "synthetic-app" },
  });
  const client = createClientFromRequest(serviceRoleRequest(req));
  assert.throws(() => client.asServiceRole, /Service token is required/);
});