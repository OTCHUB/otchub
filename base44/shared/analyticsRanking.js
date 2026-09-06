// Pure, non-mutating ranking shared by public analytics consumers.
export function rankAnalytics(rows, key, limit = 15) {
  if (!Array.isArray(rows) || !Number.isInteger(limit) || limit < 0) return [];
  return rows.map((row, index) => ({ row, index, value: row?.[key] }))
    .sort((a, b) => {
      const aKnown = Number.isFinite(a.value), bKnown = Number.isFinite(b.value);
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      if (aKnown && a.value !== b.value) return a.value > b.value ? -1 : 1;
      return a.index - b.index;
    }).slice(0, limit).map(({ row }) => row);
}