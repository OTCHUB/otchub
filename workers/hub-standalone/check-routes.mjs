import fs from "node:fs";
import os from "node:os";

const toml = fs.readFileSync(os.homedir() + "/.wrangler/config/default.toml", "utf8");
const m = toml.match(/oauth_token\s*=\s*"([^"]+)"/);
if (!m) {
  console.log("no token found");
  process.exit(1);
}
const token = m[1];

const zonesRes = await fetch("https://api.cloudflare.com/client/v4/zones?name=otchub.dev", {
  headers: { Authorization: "Bearer " + token },
});
const zonesJson = await zonesRes.json();
const zone = zonesJson.result && zonesJson.result[0];
if (!zone) {
  console.log("zone lookup failed:", JSON.stringify(zonesJson).slice(0, 500));
  process.exit(1);
}
console.log("zone found:", zone.id ? "yes" : "no", "status:", zone.status, "plan:", zone.plan && zone.plan.name);

const routesRes = await fetch(
  "https://api.cloudflare.com/client/v4/zones/" + zone.id + "/workers/routes",
  { headers: { Authorization: "Bearer " + token } },
);
const routesJson = await routesRes.json();
console.log("routes:", JSON.stringify(routesJson.result, null, 2));

const pagesRes = await fetch(
  "https://api.cloudflare.com/client/v4/zones/" + zone.id + "/pagerules",
  { headers: { Authorization: "Bearer " + token } },
);
const pagesJson = await pagesRes.json();
console.log("page rules count:", (pagesJson.result || []).length);
