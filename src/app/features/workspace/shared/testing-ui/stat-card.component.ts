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
  templateUrl: './stat-card.component.html',

  styleUrl: './stat-card.component.scss',
})
export class StatCardComponent {
  @Input() label = '';
  @Input() value: string | number = '–';
  @Input() unit = '';
  @Input() sub = '';
  @Input() tone: 'default' | 'success' | 'warn' | 'error' = 'default';
}
