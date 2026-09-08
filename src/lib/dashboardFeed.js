// Dashboard payload feed — QUOTA FIX, round 2.
// getOtcDashboard (a Base44 function) costs an entity read on every call, and
// under traffic the app hit the platform's "App entity read traffic volume
// limit exceeded" cap. The payload is identical for every visitor and only
// changes once per 5-min ingest, so the ingest now also mirrors the two
// aggregate records into the project's own Supabase table (see
// shared/dashboardAggregate.ts) and browsers read it DIRECTLY from Supabase —
// zero Base44 entity reads for the dashboard. The Base44 function stays as a
// fallback for when Supabase is unreachable or not yet provisioned.
//
// The returned body is byte-compatible with getOtcDashboard's:
// { addresses, latest, history, holdings, snapshot_count }.

import { base44 } from "@/api/base44Client";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const CORE_KEY = "otc_dash_core";
const HOLDINGS_KEY = "otc_dash_holdings";
const TTL_MS = 60_000; // same freshness window the function endpoint served

// In-memory cache shared by every caller (boot screen + dashboard 60s poll):
// one Supabase read per visitor per minute, regardless of how many panels ask.
let cache = { at: 0, body: null };

function assemble(core, held) {
  return {
    addresses: core.addresses,
    latest: core.latest,
    history: core.history,
    holdings: held?.holdings || [],
    snapshot_count: core.snapshot_count,
  };
}

async function fromSupabase() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/otc_dashboard?select=key,payload&key=in.(${CORE_KEY},${HOLDINGS_KEY})`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    }
  );
  if (!res.ok) throw new Error(`supabase read ${res.status}`);
  const rows = await res.json();
  const byKey = new Map((rows || []).map((r) => [r.key, r.payload]));
  const core = byKey.get(CORE_KEY);
  const held = byKey.get(HOLDINGS_KEY);
  if (!core || !held) throw new Error("supabase dashboard rows missing");
  return assemble(core, held);
}

// Public: returns the dashboard body. Supabase first, Base44 function
// fallback. `force` skips the in-memory TTL (manual refresh).
export async function fetchDashboardBody({ force = false } = {}) {
  if (!force && cache.body && Date.now() - cache.at < TTL_MS) return cache.body;
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const body = await fromSupabase();
      cache = { at: Date.now(), body };
      return body;
    } catch {
      /* fall through to the Base44 function */
    }
  }
  const res = await base44.functions.invoke("getOtcDashboard", {});
  cache = { at: Date.now(), body: res.data };
  return res.data;
}