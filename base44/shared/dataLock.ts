// Cross-request global locks, shared by every backend function that must not
// run the same data-producing work twice concurrently (snapshot ingest,
// wallet claim scans). Backed by one DataLock entity row per lock name, using
// a write-then-recheck pattern: after writing our token we re-read the row —
// only the LAST writer sees its own token, so exactly one concurrent caller
// proceeds. A crashed holder auto-expires via the TTL, and duplicate lock
// rows created by a create-tie are pruned deterministically (newest wins).

const LOCK_ENTITY = "DataLock";

export async function acquireLock(base44, key, ttlMs) {
  const read = () => base44.asServiceRole.entities[LOCK_ENTITY].filter({ key });
  const rows = (await read()) || [];
  const now = Date.now();
  const current = rows[0] || null;
  const held =
    current?.payload?.token && now - (current.payload.at || 0) < ttlMs;
  if (held) {
    return { acquired: false, key, token: null };
  }

  const token = `${now}-${Math.random().toString(36).slice(2)}`;
  const payload = { at: now, token };
  if (current?.id) {
    await base44.asServiceRole.entities[LOCK_ENTITY].update(current.id, { payload });
  } else {
    await base44.asServiceRole.entities[LOCK_ENTITY].create({ key, payload });
  }

  // Re-read: the last writer keeps the lock; a loser sees a different token.
  // Prune any duplicate rows a create-tie produced (newest created wins).
  const after = (await read()) || [];
  after.sort(
    (a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0)
  );
  if (after.length > 1) {
    await Promise.all(
      after
        .slice(1)
        .map((r) => base44.asServiceRole.entities[LOCK_ENTITY].delete(r.id))
    );
  }
  if (after[0]?.payload?.token !== token) {
    return { acquired: false, key, token: null };
  }
  return { acquired: true, key, token };
}

export async function releaseLock(base44, lock) {
  if (!lock?.acquired || !lock.token) return;
  try {
    const rows =
      (await base44.asServiceRole.entities[LOCK_ENTITY].filter({ key: lock.key })) ||
      [];
    const row = rows[0];
    if (row?.payload?.token === lock.token) {
      await base44.asServiceRole.entities[LOCK_ENTITY].update(row.id, {
        payload: { at: 0, token: null },
      });
    }
  } catch {
    /* a failed release simply expires via the TTL */
  }
}