#!/usr/bin/env node
// Backfills public/stocks/ with the official 1:1 payout-stock icons listed in
// base44/shared/rewardStockCatalog.js (REWARD_STOCKS). Run it whenever the
// catalog gains new entries after re-harvesting the site's launcher picker:
//
//   node scripts/backfill_stock_icons.mjs
//
// Files already bundled are kept as-is; every download is verified to be a
// real image under 512KB. Anything it cannot fetch is reported — the
// frontend falls back to the getRewardIcon proxy for those until backfilled.
import { mkdir, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { REWARD_STOCKS, STOCKS_ORIGIN } from "../base44/shared/rewardStockCatalog.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const MAX_BYTES = 512_000;
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "stocks");

await mkdir(dir, { recursive: true });
const lines = [];
for (const { symbol, icon } of REWARD_STOCKS) {
  const file = path.join(dir, icon);
  try {
    const existing = await stat(file);
    if (existing.size > 0) { lines.push(`kept    ${icon}`); continue; }
  } catch { /* not bundled yet */ }
  try {
    const res = await fetch(STOCKS_ORIGIN + icon, { headers: { "User-Agent": UA, "Accept": "image/*,*/*;q=0.8" } });
    const type = res.headers.get("content-type") || "";
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok || !type.startsWith("image/") || buf.byteLength === 0 || buf.byteLength > MAX_BYTES) {
      lines.push(`FAILED  ${icon} (${symbol}): HTTP ${res.status} ${type || "no type"}`);
      continue;
    }
    await writeFile(file, buf);
    lines.push(`saved   ${icon} (${buf.byteLength}B)`);
  } catch (error) {
    lines.push(`FAILED  ${icon} (${symbol}): ${error.name}`);
  }
}
console.log(lines.join("\n"));
const failed = lines.filter((l) => l.startsWith("FAILED")).length;
console.log(`\n${REWARD_STOCKS.length} catalog stocks: ${REWARD_STOCKS.length - failed} bundled, ${failed} failed.`);