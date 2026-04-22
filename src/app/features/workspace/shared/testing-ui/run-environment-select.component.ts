import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';

import { EnvironmentsService } from '@core/environments.service';
import type { Environment } from '@models/environment';
import { DropdownComponent, type DropdownOption } from '../dropdown/dropdown.component';

/**
 * Picks which environment supplies variables for a test run. Uses the shared
 * themed dropdown (not a native select element) so the menu matches the app UI.
 */
@Component({
  selector: 'app-run-environment-select',
  standalone: true,
  imports: [CommonModule, DropdownComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="run-env"
      role="group"
      aria-label="Environment for this run"
      title="Which environment supplies variables (URL, headers, placeholders)">
      <span class="run-env-cue" aria-hidden="true">Environment</span>
      <div class="run-env-pick">
        <app-dropdown
          [options]="ddOptions"
          [value]="value"
          align="right"
          (valueChange)="onSelect($event)"
        />
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: inline-flex;
      align-items: center;
      flex-shrink: 0;
    }
    .run-env {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: var(--aw-control-height, 34px);
    }
    .run-env-cue {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.01em;
      color: color-mix(in srgb, var(--text-color), transparent 40%);
      white-space: nowrap;
      line-height: 1.2;
      user-select: none;
    }
    .run-env-pick {
      flex: 0 1 auto;
      width: clamp(9.5rem, 12vw, 15rem);
      min-width: 8.5rem;
    }
    .run-env-pick app-dropdown {
      display: block;
      width: 100%;
    }
  `],
})
export class RunEnvironmentSelectComponent implements OnInit, OnDestroy {
  @Input() value: string | null = null;
  @Output() valueChange = new EventEmitter<string | null>();
  envList: Environment[] = [];
  ddOptions: DropdownOption[] = [{ label: 'Workspace default', value: null }];

  private destroy$ = new Subject<void>();

  constructor(
    private environments: EnvironmentsService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    void this.environments.loadEnvironments();
    this.environments
      .getEnvironmentsObservable()
      .pipe(takeUntil(this.destroy$))
      .subscribe((list) => {
        this.envList = list;
        this.ddOptions = this.buildOptions(list);
        this.cdr.markForCheck();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private buildOptions(list: Environment[]): DropdownOption[] {
    return [
      { label: 'Workspace default', value: null },
      ...list.map((e) => ({
        label: (e.title && e.title.trim()) ? e.title : 'Untitled',
        value: e.id,
      })),
    ];
  }

  onSelect(v: string | null): void {
    this.valueChange.emit(v);
  }
}
