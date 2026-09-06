// Construct ONLY after RU_FOMO authorization. The SDK otherwise forwards the
// operator bearer as a Base44 user token in its on-behalf-of header.
// These are hosting-injected headers, trusted only inside the Base44 runtime.
export function serviceRoleRequest(req) {
  const headers = new Headers();
  for (const name of ["Base44-Service-Authorization", "Base44-App-Id", "Base44-Api-Url",
    "Base44-Functions-Version", "Base44-State", "X-Data-Env"]) {
    const value = req.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  // Header-only SDK context; do not clone a body already consumed by the handler.
  return new Request(req.url, { headers });
}

// Service-role entity facade. Construct ONLY inside an authorized handler.
// This is deliberately not an atomic lock: Base44 read/create can race across
// isolates. Duplicate rows with the same signalId are possible. Consumers MUST
// use the deterministic wire ID in their durable operator execution journal.
export function createRuFomoStore(entities) {
  return {
    async findSignal(signalId, mint) {
      const rows = await entities.RuFomoSignal.filter({ signalId, mint }, "createdAt", 1, 0);
      if (!rows.length) return null;
      const row = rows[0];
      return { id: row.signalId, mint: row.mint, action: row.action, baseAsset: row.baseAsset,
        createdAt: row.createdAt, expiresAt: row.expiresAt, reason: row.reason,
        metrics: { volume24hUsd: row.metrics?.volume24hUsd, marketCapUsd: row.metrics?.marketCapUsd,
          change24hPct: row.metrics?.change24hPct, liquidityUsd: row.metrics?.liquidityUsd } };
    },
    async createSignal(signal) {
      const { id, ...fields } = signal;
      await entities.RuFomoSignal.create({ signalId: id, ...fields });
      return signal;
    },
    async appendReport(report) {
      await entities.RuFomoReport.create(report);
    },
    async listReports({ cursor, limit }) {
      // Base44 filter supports MongoDB query operators (SDK entities reference).
      return entities.RuFomoReport.filter({ logKey: { $lt: cursor } }, "-logKey", limit, 0);
    },
  };
}