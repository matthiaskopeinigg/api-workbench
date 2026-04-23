/**
 * Runtime placeholders in URLs, headers, params, and bodies. Applied after
 * `{{name}}` environment substitution. Each request send generates fresh values.
 *
 * - Bare:  `trace-$uuid`, `$randomInt(6)`, `$randomLong(12)`
 * - Braced: `{{$uuid}}`, `{{$randomInt(3)}}`
 */

const SIMPLE_NAMES = 'uuid|timestamp|isoTimestamp|isoDate' as const;
/**
 * After `$`: `randomInt(3)` / `randomLong(2)` first (no \\b after `)` — that broke matching),
 * then `uuid`… with \\b, then bare `randomInt` / `randomLong` with \\b.
 */
const AFTER_DOLLAR =
  '(?:(?:randomInt|randomLong)\\(\\d+\\)|(?:' +
  SIMPLE_NAMES +
  ')\\b|(?:randomInt|randomLong)\\b)';

export const DYNAMIC_BARE_SOURCE = `\\$(${AFTER_DOLLAR})`;
export const DYNAMIC_BARE_RE = new RegExp(DYNAMIC_BARE_SOURCE, 'g');
export const DYNAMIC_BRACED_RE = new RegExp(
  `\\{\\{\\s*\\$(${AFTER_DOLLAR})\\s*\\}\\}`,
  'g',
);

const KNOWN_NAMES = [
  'uuid',
  'timestamp',
  'isoTimestamp',
  'isoDate',
  'randomInt',
  'randomLong',
] as const;

const KNOWN_SIMPLE = new Set<string>([...KNOWN_NAMES]);

const PARAM_FORM = /^(randomInt|randomLong)\((\d+)\)$/;

export const DYNAMIC_PLACEHOLDER_TOOLTIPS: Record<string, string> = {
  uuid: 'A new random UUID (v4) is generated for each request send.',
  timestamp: 'Current time in milliseconds (Date.now()) when the request is sent.',
  isoTimestamp: 'Current time as ISO-8601 (UTC) when the request is sent.',
  isoDate: 'Same as $isoTimestamp.',
  randomInt:
    'Without (n): random 9-digit integer. With (n): $randomInt(5) → 5 random decimal digits (0–9 each). Length 1–20.',
  randomLong:
    'Without (n): same 9-digit default as $randomInt. With (n): $randomLong(8) → 8 random digits (same rules as $randomInt(n)).',
};

function randomUuid(): string {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** n random decimal digits (each 0–9), length n. Safe for n up to 20 (no float precision issues). */
export function randomDigitsOfLength(n: number): string {
  const len = Math.min(Math.max(1, Math.floor(n)), 20);
  let s = '';
  for (let i = 0; i < len; i++) {
    s += String(Math.floor(Math.random() * 10));
  }
  return s;
}

function valueForSimpleName(name: string): string | null {
  switch (name) {
    case 'uuid':
      return randomUuid();
    case 'timestamp':
      return String(Date.now());
    case 'isoTimestamp':
    case 'isoDate':
      return new Date().toISOString();
    case 'randomInt':
    case 'randomLong':
      return String(Math.floor(Math.random() * 900_000_000) + 100_000_000);
    default:
      return null;
  }
}

/** Text after `$` (no leading $), e.g. `uuid`, `randomInt(4)`. */
export function valueForBareDynamic(afterDollar: string): string | null {
  const trimmed = afterDollar.trim();
  const pm = PARAM_FORM.exec(trimmed);
  if (pm) {
    const digits = parseInt(pm[2], 10);
    if (digits < 1 || digits > 20) return null;
    return randomDigitsOfLength(digits);
  }
  return valueForSimpleName(trimmed);
}

export function isKnownDynamicName(name: string): boolean {
  if (KNOWN_SIMPLE.has(name)) return true;
  return PARAM_FORM.test(name.trim());
}

/** Tooltip HTML line for a dynamic token (after `$`). */
export function describeDynamicToken(afterDollar: string): string | null {
  const t = afterDollar.trim();
  const pm = PARAM_FORM.exec(t);
  if (pm) {
    const kind = pm[1] === 'randomLong' ? 'long' : 'integer';
    return `Random ${kind}: ${pm[2]} decimal digit(s) (each 0–9). Generated on each send.`;
  }
  return DYNAMIC_PLACEHOLDER_TOOLTIPS[t] ?? null;
}

export interface DynamicPlaceholderOption {
  name: string;
  label: string;
  description: string;
}

/** Completions for bare `$` tokens — `partial` is the part after `$.` */
export function getDynamicPlaceholderCompletions(
  partial: string,
  options?: { max?: number },
): DynamicPlaceholderOption[] {
  const max = options?.max ?? 20;
  const p = partial.toLowerCase();
  const out: DynamicPlaceholderOption[] = [];
  for (const name of KNOWN_NAMES) {
    if (!name.toLowerCase().startsWith(p)) continue;
    out.push({
      name,
      label: `$${name}`,
      description: DYNAMIC_PLACEHOLDER_TOOLTIPS[name] ?? '',
    });
    if (out.length >= max) break;
  }
  const snippet6 = 'randomint(6)';
  const snippetL = 'randomlong(12)';
  if (
    out.length < max &&
    (p === '' || snippet6.startsWith(p)) &&
    !out.some((o) => o.label === '$randomInt(6)')
  ) {
    out.push({
      name: 'randomInt(6)-snippet',
      label: '$randomInt(6)',
      description: 'Length in ( ): number of digits (1–20). E.g. $randomInt(1) → one digit.',
    });
  }
  if (
    out.length < max &&
    (p === '' || snippetL.startsWith(p)) &&
    !out.some((o) => o.label === '$randomLong(12)')
  ) {
    out.push({
      name: 'randomLong(12)-snippet',
      label: '$randomLong(12)',
      description: 'Same digit-length rules as $randomInt(n).',
    });
  }
  return out;
}

/**
 * Replaces `{{$token}}` and `$token` (known names only) with generated values.
 * Run after environment `{{name}}` substitution.
 */
export function applyDynamicPlaceholders(input: string): string {
  if (!input) return input;
  let s = input.replace(DYNAMIC_BRACED_RE, (full, afterDollar: string) => {
    const v = valueForBareDynamic(String(afterDollar).trim());
    return v != null ? v : full;
  });
  s = s.replace(DYNAMIC_BARE_RE, (full, afterDollar: string) => {
    const v = valueForBareDynamic(afterDollar);
    return v != null ? v : full;
  });
  return s;
}
