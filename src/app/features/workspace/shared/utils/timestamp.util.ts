import { formatDate } from '@angular/common';

/**
 * Normalizes mixed timestamp inputs to **epoch milliseconds** for display.
 *
 * Angular's `DatePipe` (and `new Date(n)`) interpret **numbers as ms** since 1970-01-01 UTC.
 * Data that stores **Unix seconds** (typical range ~1e9–1e10) would otherwise show dates
 * near 1970 — this corrects that case. ISO strings and `Date` instances are unchanged.
 */
export function coerceToEpochMs(
  v: string | number | Date | null | undefined,
): number | null {
  if (v == null || v === '') {
    return null;
  }
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v <= 0) {
      return v;
    }
    if (v >= 1e9 && v < 1e10) {
      return Math.round(v * 1000);
    }
    return v;
  }
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) {
      return null;
    }
    if (/^\d+(\.\d+)?$/.test(t)) {
      return coerceToEpochMs(Number(t));
    }
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  return null;
}

const UI_LOCALE = 'en-US';

/** Use from components when you can’t use `awDate` in a template. */
export function formatTimestampForUi(
  v: string | number | Date | null | undefined,
  fmt: string,
  locale: string = UI_LOCALE,
  timezone?: string,
): string {
  const ms = coerceToEpochMs(v);
  if (ms == null) {
    return '';
  }
  try {
    return formatDate(ms, fmt, locale, timezone) || '';
  } catch {
    return '';
  }
}
