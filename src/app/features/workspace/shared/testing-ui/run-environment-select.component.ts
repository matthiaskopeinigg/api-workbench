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

import { EnvironmentsService } from '@core/environments/environments.service';
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
  templateUrl: './run-environment-select.component.html',

  styleUrl: './run-environment-select.component.scss',
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
