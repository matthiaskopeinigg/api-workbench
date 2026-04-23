import { formatDate } from '@angular/common';
import { inject, LOCALE_ID, Pipe, PipeTransform } from '@angular/core';
import { coerceToEpochMs } from '../utils/timestamp.util';

/**
 * Like Angular `date`, but coerces **Unix second** values (1e9–1e10) to milliseconds
 * so persisted JSON and IPC payloads display correctly in local time.
 */
@Pipe({ name: 'awDate', standalone: true, pure: true })
export class AwDatePipe implements PipeTransform {
  private readonly locale = inject(LOCALE_ID);

  transform(
    value: string | number | Date | null | undefined,
    format?: string,
    timezone?: string,
  ): string | null {
    if (value == null || value === '') {
      return null;
    }
    if (typeof value === 'number' && value !== value) {
      return null;
    }
    const ms = coerceToEpochMs(value);
    if (ms == null) {
      return null;
    }
    try {
      return formatDate(ms, format ?? 'medium', this.locale, timezone);
    } catch {
      return null;
    }
  }
}
