/**
 * Helpers for normalizing key/value lists (headers, query params, variables, …)
 * before persisting them to the session or sending them over the wire.
 *
 * The canonical rule used everywhere:
 *   "An entry is empty when its key (after trimming whitespace) is blank."
 *
 * We never silently mutate user input; callers receive a NEW array so that
 * editor state (e.g. an in-progress blank row at the bottom of a table)
 * is preserved while the persisted/sent payload stays clean.
 */

export type KvLike = {
  key?: string | null;
  value?: string | null;
};

/** Returns true when an entry has a non-blank key. */
export function hasKey<T extends KvLike>(item: T | null | undefined): item is T {
  return !!item && typeof item.key === 'string' && item.key.trim() !== '';
}

/** Drop entries with empty/whitespace-only keys. Returns a new array. */
export function pruneEmptyKv<T extends KvLike>(items: T[] | null | undefined): T[] {
  if (!items || items.length === 0) return [];
  return items.filter(hasKey);
}

/**
 * Like {@link pruneEmptyKv} but also normalizes whitespace around the key so
 * downstream consumers (URL builders, header maps, env maps) never see a
 * key with leading/trailing spaces.
 */
export function cleanKv<T extends KvLike>(items: T[] | null | undefined): T[] {
  if (!items || items.length === 0) return [];
  const out: T[] = [];
  for (const item of items) {
    if (!hasKey(item)) continue;
    out.push({ ...item, key: (item.key as string).trim() });
  }
  return out;
}
