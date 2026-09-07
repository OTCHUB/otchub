// Browser-side graduation confirmation for the launcher tape. DexScreener
// rate-limits the shared function-runtime egress IP, so AMM-migration
// evidence is confirmed from the visitor's own browser: the feed lists
// completed-but-unconfirmed curves (pendingGraduation), this checks each for
// a live AMM pair and reports the confirmed mints once. The backend
// re-verifies on-chain before persisting to the global ledger — after that
// the status is GRADUATED for every visitor and never re-checked.
import { base44 } from "@/api/base44Client";

const DEX_URL = "https://api.dexscreener.com/latest/dex/tokens/";
const AMMS = new Set(["pumpswap", "raydium", "meteora"]);
const CHUNK = 30;
const RECHECK_MS = 10 * 60_000; // unconfirmed mints are re-checked at most every 10 minutes

const checkedAt = new Map(); // per session: mint → last check time
let inFlight = false;

function hasAmmPair(mint, pairs) {
  return (pairs || []).some((p) => p?.chainId === "solana" && AMMS.has(p.dexId)
    && (p.baseToken?.address === mint || p.quoteToken?.address === mint)
    && Number.isFinite(p.liquidity?.usd) && p.liquidity.usd > 0);
}

export async function confirmPendingGraduations(pendingMints) {
  if (inFlight) return;
  const now = Date.now();
  const targets = (pendingMints || [])
    .filter((mint) => typeof mint === "string" && (now - (checkedAt.get(mint) || 0)) > RECHECK_MS)
    .slice(0, 90);
  if (!targets.length) return;
  inFlight = true;
  try {
    const confirmed = [];
    for (let i = 0; i < targets.length; i += CHUNK) {
      const chunk = targets.slice(i, i + CHUNK);
      // Mark the window up front so a failed fetch also backs off.
      for (const mint of chunk) checkedAt.set(mint, now);
      try {
        const res = await fetch(DEX_URL + chunk.join(","));
        if (!res.ok) continue;
        const pairs = (await res.json())?.pairs;
        const list = Array.isArray(pairs) ? pairs : [];
        for (const mint of chunk) {
          if (hasAmmPair(mint, list)) confirmed.push(mint);
        }
      } catch { /* DexScreener hiccup: retried after the recheck window */ }
    }
    if (confirmed.length) {
      try { await base44.functions.invoke("reportLauncherGraduation", { mints: confirmed }); }
      catch { /* the feed still lists them; retried after the recheck window */ }
    }
  } finally { inFlight = false; }
}