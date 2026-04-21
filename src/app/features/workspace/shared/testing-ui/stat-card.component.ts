import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Compact metric tile used by the Load Test, Suite, and Contract tabs.
 * Designed to be cheap (OnPush, no lifecycle hooks) so dashboards can
 * stack dozens without measurable cost.
 */
@Component({
  selector: 'aw-stat-card',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stat-card" [class]="'tone-' + tone">
      <div class="label">{{ label }}</div>
      <div class="value">
        <span class="num">{{ value }}</span>
        <span class="unit" *ngIf="unit">{{ unit }}</span>
      </div>
      <div class="sub" *ngIf="sub">{{ sub }}</div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .stat-card {
      display: flex; flex-direction: column; gap: 6px;
      padding: 14px 16px; border-radius: 10px;
      background: var(--aw-surface);
      border: 1px solid var(--border-color);
      min-height: 86px;
    }
    .stat-card.tone-success { border-color: color-mix(in srgb, var(--aw-status-success) 35%, transparent); }
    .stat-card.tone-warn    { border-color: color-mix(in srgb, var(--aw-status-warning) 45%, transparent); }
    .stat-card.tone-error   { border-color: color-mix(in srgb, var(--aw-status-error) 45%, transparent); }
    .label {
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
      color: color-mix(in srgb, var(--text-color), transparent 45%); font-weight: 600;
    }
    .value { display: flex; align-items: baseline; gap: 6px; }
    .num   { font-size: 22px; font-weight: 700; color: var(--text-color); }
    .unit  { font-size: 11px; color: color-mix(in srgb, var(--text-color), transparent 45%); }
    .sub   { font-size: 11px; color: color-mix(in srgb, var(--text-color), transparent 45%); }
  `],
})
export class StatCardComponent {
  @Input() label = '';
  @Input() value: string | number = '–';
  @Input() unit = '';
  @Input() sub = '';
  @Input() tone: 'default' | 'success' | 'warn' | 'error' = 'default';
}
