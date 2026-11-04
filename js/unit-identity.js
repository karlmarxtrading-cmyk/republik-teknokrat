// Unit identity comes from the canon, never its current position or title.
// Keep `number` stable when moving/editing a unit; give a new unit a new number.
export const DEFAULT_PACKAGE_ID = 'filsafat-1';
export const isSourceNumber = (number) => Number.isSafeInteger(number) && number > 0;
export const isUnitId = (id) => typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{1,79}$/i.test(id);

export function numberedUnitId(number, packageId = DEFAULT_PACKAGE_ID) {
  if (!isSourceNumber(number)) return null;
  const prefix = isUnitId(packageId) && packageId.length <= 50 ? packageId : DEFAULT_PACKAGE_ID;
  return `${prefix}-u${String(number).padStart(3, '0')}`;
}

/** An optional authored id, otherwise the stable authored number. */
export function sourceUnitId(entry, packageId = DEFAULT_PACKAGE_ID) {
  return isUnitId(entry?.id) ? entry.id : numberedUnitId(entry?.number, packageId);
}

// Resolve historical route/storage/backup IDs without deriving new identities.
export function resolveUnitId(id, units) {
  const direct = units.find((u) => u.id === id);
  if (direct) return direct.id;
  const matches = units.filter((u) => u.legacyIds?.includes(id));
  // A historical alias shared by different units must not select one arbitrarily.
  return matches.length === 1 ? matches[0].id : null;
}
