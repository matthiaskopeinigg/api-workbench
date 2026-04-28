export interface SnapshotFieldDiff {
  path: string;
  change: 'added' | 'removed' | 'changed';
  expected?: string;
  actual?: string;
}

/**
 * Structural diff between two JSON-ish values. Returns a flat list of
 * field-level changes so the UI can render them as a table without walking
 * the trees again.
 *
 * Design choices:
 *  - Object keys are compared set-wise (key order never triggers drift).
 *  - Array indices matter; reordering counts as a change. Tracking by key
 *    would need a hint we don't have, and for regression tests a reordered
 *    array usually *is* a behaviour change worth flagging.
 *  - Ignore paths accept optional leading `$.` and dot segments only; they
 *    can match a specific index too (e.g. `$.items.0.id`) or a wildcard
 *    segment (`$.items.*.id`).
 *  - Depth capped at 12 to guarantee termination on pathological inputs.
 */
export function diffJson(
  expected: unknown,
  actual: unknown,
  options: { ignorePaths?: string[] } = {},
): SnapshotFieldDiff[] {
  const ignore = compileIgnore(options.ignorePaths || []);
  const out: SnapshotFieldDiff[] = [];
  walk('$', expected, actual, ignore, out, 0);
  return out;
}

type IgnoreMatcher = { segments: string[] };

function compileIgnore(paths: string[]): IgnoreMatcher[] {
  const out: IgnoreMatcher[] = [];
  for (const raw of paths) {
    if (!raw) continue;
    let p = raw.trim();
    if (!p) continue;
    if (p.startsWith('$.')) p = p.slice(2);
    else if (p.startsWith('$')) p = p.slice(1);
    if (!p) continue;
    out.push({ segments: p.split('.').filter(Boolean) });
  }
  return out;
}

function isIgnored(path: string, matchers: IgnoreMatcher[]): boolean {
  if (!matchers.length) return false;
  const segs = path.startsWith('$.') ? path.slice(2).split('.') : path === '$' ? [] : path.split('.');
  for (const m of matchers) {
    if (segmentsMatch(m.segments, segs)) return true;
  }
  return false;
}

function segmentsMatch(pattern: string[], actual: string[]): boolean {
  if (pattern.length !== actual.length) return false;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '*') continue;
    if (pattern[i] !== actual[i]) return false;
  }
  return true;
}

function walk(
  path: string,
  a: unknown,
  b: unknown,
  ignore: IgnoreMatcher[],
  out: SnapshotFieldDiff[],
  depth: number,
): void {
  if (isIgnored(path, ignore)) return;
  if (depth > 12) return;

  if (a === undefined && b === undefined) return;
  if (a === undefined) {
    out.push({ path, change: 'added', actual: stringifyValue(b) });
    return;
  }
  if (b === undefined) {
    out.push({ path, change: 'removed', expected: stringifyValue(a) });
    return;
  }

  const ta = typeOf(a);
  const tb = typeOf(b);
  if (ta !== tb) {
    out.push({ path, change: 'changed', expected: stringifyValue(a), actual: stringifyValue(b) });
    return;
  }

  if (ta === 'array') {
    const aa = a as unknown[];
    const bb = b as unknown[];
    const n = Math.max(aa.length, bb.length);
    for (let i = 0; i < n; i++) {
      walk(`${path}.${i}`, aa[i], bb[i], ignore, out, depth + 1);
    }
    return;
  }

  if (ta === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
    for (const k of keys) {
      walk(`${path}.${k}`, ao[k], bo[k], ignore, out, depth + 1);
    }
    return;
  }

  if (!primitiveEquals(a, b)) {
    out.push({ path, change: 'changed', expected: stringifyValue(a), actual: stringifyValue(b) });
  }
}

function typeOf(value: unknown): 'null' | 'string' | 'number' | 'boolean' | 'array' | 'object' | 'other' {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return t;
  if (t === 'object') return 'object';
  return 'other';
}

function primitiveEquals(a: unknown, b: unknown): boolean {
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  return a === b;
}

export function stringifyValue(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return '(undefined)';
  if (typeof v === 'string') return v.length > 200 ? `${v.slice(0, 200)}…` : v;
  try {
    const s = JSON.stringify(v);
    return s.length > 200 ? `${s.slice(0, 200)}…` : s;
  } catch { return String(v); }
}

/** Text-diff fallback used when the body isn't JSON. Returns a single "changed" entry. */
export function diffText(path: string, expected: string, actual: string): SnapshotFieldDiff[] {
  if (expected === actual) return [];
  return [{ path, change: 'changed', expected: truncate(expected), actual: truncate(actual) }];
}

function truncate(s: string): string {
  return s.length > 400 ? `${s.slice(0, 400)}…` : s;
}
