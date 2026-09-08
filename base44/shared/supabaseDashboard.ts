// Server-side Supabase mirror of the dashboard aggregate — QUOTA FIX, round 2.
// The 5-min snapshot ingest upserts the two aggregate payloads (core series +
// NFT holdings table) into the project's own Supabase table so browsers can
// read the dashboard DIRECTLY from Supabase (src/lib/dashboardFeed.js) with
// zero Base44 entity reads. Writes go through the service-role key, which
// bypasses RLS; the table has a public read policy for the anon key only.

import { secrets } from "base44:runtime";

const TABLE = "otc_dashboard";

// rows: [{ key, payload }] — one global upsert, newest payload per key wins.
// `on_conflict=key` + Prefer merge-duplicates makes it idempotent across
// concurrent ingest isolates.
export async function pushDashboardToSupabase(rows) {
  const url = (secrets.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const serviceKey = secrets.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    return { ok: false, skipped: true };
  }
  const res = await fetch(`${url}/rest/v1/${TABLE}?on_conflict=key`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(
      rows.map((r) => ({
        key: r.key,
        payload: r.payload,
        updated_at: new Date().toISOString(),
      }))
    ),
  });
  if (!res.ok) {
    throw new Error(
      `supabase upsert ${res.status}: ${(await res.text()).slice(0, 200)}`
    );
  }
  return { ok: true };
}