/** Normalize only case and whitespace; keep distinct names in the source distinct. */
export function normalizeName(value) {
  return value.replace(/\s+/g, '').toLocaleLowerCase('en-US');
}

export function shardForName(name) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(name)) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return (hash % 256).toString(16).padStart(2, '0');
}

export function findNames(names, query, limit = 8) {
  const normalized = normalizeName(query);
  if (!normalized) return [];
  return names
    .filter(([name]) => normalizeName(name).includes(normalized))
    .map(([name, count], position) => ({
      name, count, position,
      match: normalizeName(name) === normalized ? 0 : normalizeName(name).startsWith(normalized) ? 1 : 2,
    }))
    .sort((a, b) => a.match - b.match || b.count - a.count || a.position - b.position)
    .slice(0, limit)
    .map(({ name, count }) => [name, count]);
}

export function decodeRows(raw) {
  if (!Array.isArray(raw)) throw new Error('보유 데이터 형식을 확인할 수 없어요.');
  return raw.map((row) => {
    if (!Array.isArray(row) || row.length !== 6 || typeof row[0] !== 'string' || typeof row[1] !== 'string'
      || row.slice(2).some((value) => value !== null && (typeof value !== 'number' || !Number.isFinite(value)))) {
      throw new Error('보유 데이터 형식을 확인할 수 없어요.');
    }
    return { code: row[0], name: row[1], weight: row[2], count: row[3], marketSum: row[4], amount: row[5] };
  });
}

/** Missing metrics have no rank. A disclosed zero is a valid metric. */
export function rankRows(rows, mode) {
  const metric = mode === 'weight' ? 'weight' : mode === 'amount' ? 'amount' : 'count';
  const ranked = rows.filter((row) => row[metric] !== null).sort((a, b) =>
    b[metric] - a[metric] || (b.count ?? -Infinity) - (a.count ?? -Infinity) || a.name.localeCompare(b.name, 'ko') || a.code.localeCompare(b.code));
  const missing = rows.filter((row) => row[metric] === null).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return { ranked, missing };
}

export function effectiveMode(rows, mode) {
  return mode === 'weight' && rows.length > 0 && rows.every((row) => row.weight === null) ? 'count' : mode;
}
