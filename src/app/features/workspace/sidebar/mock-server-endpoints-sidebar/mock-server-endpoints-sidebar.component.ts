import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, combineLatest, takeUntil } from 'rxjs';

import { HttpMethod, Request as RequestModel } from '@models/request';
import type { StandaloneMockEndpoint } from '@models/electron';
import {
  MockServerUiStateService,
  type MockEndpointGroup,
  type MockSelectionKind,
} from '@core/mock-server/mock-server-ui-state.service';

@Component({
  selector: 'app-mock-server-endpoints-sidebar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './mock-server-endpoints-sidebar.component.html',
  styleUrl: './mock-server-endpoints-sidebar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MockServerEndpointsSidebarComponent implements OnInit, OnDestroy {
  groups: MockEndpointGroup[] = [];
  standalones: StandaloneMockEndpoint[] = [];
  selectionKind: MockSelectionKind = null;
  selectedRequestId: string | null = null;
  selectedStandaloneId: string | null = null;

  private readonly destroy$ = new Subject<void>();

  constructor(
    private mockUi: MockServerUiStateService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.mockUi.groups$.pipe(takeUntil(this.destroy$)).subscribe((g) => {
      this.groups = g;
      this.cdr.markForCheck();
    });
    this.mockUi.standalones$.pipe(takeUntil(this.destroy$)).subscribe((s) => {
      this.standalones = s;
      this.cdr.markForCheck();
    });
    combineLatest([
      this.mockUi.selectionKind$,
      this.mockUi.selectedRequestId$,
      this.mockUi.selectedStandaloneId$,
    ])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([kind, reqId, stId]) => {
        this.selectionKind = kind;
        this.selectedRequestId = reqId;
        this.selectedStandaloneId = stId;
        this.cdr.markForCheck();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  trackByStandalone = (_i: number, e: StandaloneMockEndpoint) => e.id;
  trackByEntry = (_i: number, e: { request: RequestModel }) => e.request.id;
  trackByGroup = (_i: number, g: MockEndpointGroup) => g.collectionId;

  totalRegistered(): number {
    const fromCollections = this.groups.reduce((sum, g) => sum + g.entries.length, 0);
    return fromCollections + this.standalones.length;
  }

  methodLabel(request: RequestModel | null | undefined): string {
    if (!request) return '';
    const value = request.httpMethod as unknown;
    if (typeof value === 'number') return HttpMethod[value] || '';
    return String(value || '');
  }

  standalonePrimaryLabel(e: StandaloneMockEndpoint): string {
    const n = e.name.trim();
    return n || e.path;
  }

  standaloneEntryTitle(e: StandaloneMockEndpoint): string {
    const n = e.name.trim();
    return n ? `${n} — ${e.method} ${e.path}` : `${e.method} ${e.path}`;
  }

  selectRequest(request: RequestModel): void {
    this.mockUi.selectRequest(request);
  }

  selectStandalone(endpoint: StandaloneMockEndpoint): void {
    this.mockUi.selectStandalone(endpoint);
  }

  async addStandalone(): Promise<void> {
    await this.mockUi.addStandalone();
  }

  async removeStandalone(endpoint: StandaloneMockEndpoint, evt?: MouseEvent): Promise<void> {
    if (evt) {
      evt.stopPropagation();
      evt.preventDefault();
    }
    await this.mockUi.removeStandalone(endpoint);
  }
}
