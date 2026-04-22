import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

import { TabItem } from '@core/tab.service';
import { TestArtifactService } from '@core/test-artifact.service';
import { LoadTestService } from '@core/load-test.service';
import { CollectionService } from '@core/collection.service';
import { SessionService } from '@core/session.service';
import {
  LOAD_TEST_SESSION_RUNS_KEY,
  type LoadTestSessionRunsMap,
} from '@core/load-test-session.keys';
import type {
  LoadProgressEvent,
  LoadRunResult,
  LoadSample,
  LoadTestArtifact,
  LoadTestTarget,
} from '@models/testing/load-test';
import type { Collection, Folder } from '@models/collection';
import { HttpMethod, type Request } from '@models/request';

import { StatCardComponent } from '../../shared/testing-ui/stat-card.component';
import { RunEnvironmentSelectComponent } from '../../shared/testing-ui/run-environment-select.component';
import {
  TimeSeriesChartComponent,
  type TimeSeriesSeries,
} from '../../shared/testing-ui/time-series-chart.component';

interface RequestPick {
  id: string;
  label: string;
  method: string;
}

const HTTP_METHOD_LABELS: Record<number, string> = {
  [HttpMethod.GET]: 'GET',
  [HttpMethod.POST]: 'POST',
  [HttpMethod.PUT]: 'PUT',
  [HttpMethod.DELETE]: 'DELETE',
  [HttpMethod.PATCH]: 'PATCH',
  [HttpMethod.HEAD]: 'HEAD',
  [HttpMethod.OPTIONS]: 'OPTIONS',
};

@Component({
  selector: 'app-load-test',
  standalone: true,
  imports: [CommonModule, FormsModule, StatCardComponent, TimeSeriesChartComponent, RunEnvironmentSelectComponent],
  templateUrl: './load-test.component.html',
  styleUrls: ['./load-test.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoadTestComponent implements OnInit, OnDestroy {
  @Input() tab!: TabItem;

  artifact: LoadTestArtifact | null = null;

  /** Live state. */
  runId: string | null = null;
  running = false;
  cancelling = false;
  /** Latest progress payload from the engine. */
  progress: LoadProgressEvent | null = null;
  /** Final result, populated after run completion. */
  result: LoadRunResult | null = null;
  /** Sample shown in the response-details overlay (slowest list or error sample). */
  detailSample: LoadSample | null = null;

  /** Time-series data sliced for the chart. */
  chartXs: number[] = [];
  rpsSeries: TimeSeriesSeries = { label: 'RPS', color: '#2563eb', values: [] };
  errorSeries: TimeSeriesSeries = { label: 'Errors/s', color: '#dc2626', values: [] };
  p50Series: TimeSeriesSeries = { label: 'p50 (ms)', color: '#16a34a', values: [] };
  p95Series: TimeSeriesSeries = { label: 'p95 (ms)', color: '#d97706', values: [] };

  rpsChartSeries: TimeSeriesSeries[] = [this.rpsSeries, this.errorSeries];
  latencyChartSeries: TimeSeriesSeries[] = [this.p50Series, this.p95Series];

  /** Catalog of saved requests for the picker. */
  requestPicks: RequestPick[] = [];

  /** Inline editor toggle for adding an inline target. */
  showInlineEditor = false;
  inlineDraft = { method: 'GET', url: '', body: '' };

  /** `null` = use workspace default (active / single env). */
  runEnvironmentId: string | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private artifacts: TestArtifactService,
    private loadTest: LoadTestService,
    private collections: CollectionService,
    private session: SessionService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.bindArtifact();
    this.bindCollections();
    this.bindRunStreams();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private bindArtifact(): void {
    const id = stripPrefix(this.tab.id);
    this.artifacts.loadTests$().pipe(takeUntil(this.destroy$)).subscribe((all) => {
      const found = all.find((a) => a.id === id);
      if (!found) return;
      const wasNull = !this.artifact;
      const next = JSON.parse(JSON.stringify(found)) as LoadTestArtifact;
      if (next.config.captureResponseDetails == null) {
        next.config.captureResponseDetails = false;
      }
      this.artifact = next;
      if (wasNull) this.cdr.markForCheck();
      void this.restoreLastRunFromSession();
    });
  }

  private bindCollections(): void {
    this.collections.getCollectionsObservable().pipe(takeUntil(this.destroy$)).subscribe((cols) => {
      this.requestPicks = flattenRequests(cols);
      this.cdr.markForCheck();
    });
    this.requestPicks = flattenRequests(this.collections.getCollections() || []);
  }

  private bindRunStreams(): void {
    this.loadTest.onProgress().pipe(takeUntil(this.destroy$)).subscribe((event) => {
      if (event.runId !== this.runId) return;
      this.progress = event;
      this.appendChartPoint(event);
      this.cdr.markForCheck();
    });
    this.loadTest.onDone().pipe(takeUntil(this.destroy$)).subscribe((result) => {
      if (result.runId !== this.runId) return;
      this.result = result;
      this.running = false;
      this.cancelling = false;
      this.applyResultToCharts(result);
      void this.persistResultToSession(result);
      this.cdr.markForCheck();
    });
  }

  private applyResultToCharts(result: LoadRunResult): void {
    this.chartXs = result.series.map((p) => p.t);
    this.rpsSeries = { ...this.rpsSeries, values: result.series.map((p) => p.rps) };
    this.errorSeries = { ...this.errorSeries, values: result.series.map((p) => p.errors) };
    this.p50Series = { ...this.p50Series, values: result.series.map((p) => p.p50) };
    this.p95Series = { ...this.p95Series, values: result.series.map((p) => p.p95) };
    this.rpsChartSeries = [this.rpsSeries, this.errorSeries];
    this.latencyChartSeries = [this.p50Series, this.p95Series];
  }

  private async restoreLastRunFromSession(): Promise<void> {
    if (!this.artifact || this.running) {
      return;
    }
    await this.session.load(LOAD_TEST_SESSION_RUNS_KEY);
    const map = this.session.get<LoadTestSessionRunsMap>(LOAD_TEST_SESSION_RUNS_KEY);
    const entry = map?.[this.artifact.id];
    if (!entry?.result) {
      return;
    }
    this.result = entry.result;
    this.applyResultToCharts(entry.result);
    this.cdr.markForCheck();
  }

  private async persistResultToSession(result: LoadRunResult): Promise<void> {
    if (!this.artifact) {
      return;
    }
    await this.session.load(LOAD_TEST_SESSION_RUNS_KEY);
    const prev = this.session.get<LoadTestSessionRunsMap>(LOAD_TEST_SESSION_RUNS_KEY) || {};
    const next: LoadTestSessionRunsMap = { ...prev, [this.artifact.id]: { result, savedAt: Date.now() } };
    await this.session.save(LOAD_TEST_SESSION_RUNS_KEY, next);
  }

  private appendChartPoint(event: LoadProgressEvent): void {
    this.chartXs = [...this.chartXs, event.point.t];
    this.rpsSeries = { ...this.rpsSeries, values: [...this.rpsSeries.values, event.point.rps] };
    this.errorSeries = { ...this.errorSeries, values: [...this.errorSeries.values, event.point.errors] };
    this.p50Series = { ...this.p50Series, values: [...this.p50Series.values, event.point.p50] };
    this.p95Series = { ...this.p95Series, values: [...this.p95Series.values, event.point.p95] };
    if (this.chartXs.length > 600) {
      this.chartXs = this.chartXs.slice(-600);
      this.rpsSeries = { ...this.rpsSeries, values: this.rpsSeries.values.slice(-600) };
      this.errorSeries = { ...this.errorSeries, values: this.errorSeries.values.slice(-600) };
      this.p50Series = { ...this.p50Series, values: this.p50Series.values.slice(-600) };
      this.p95Series = { ...this.p95Series, values: this.p95Series.values.slice(-600) };
    }
    this.rpsChartSeries = [this.rpsSeries, this.errorSeries];
    this.latencyChartSeries = [this.p50Series, this.p95Series];
  }

  onTitleChange(): void { this.persist(); }
  onConfigChange(): void { this.persist(); }
  onRpsCapChange(a: LoadTestArtifact, value: number | string | null): void {
    a.config.rpsCap = value === '' || value == null ? null : Number(value);
    this.persist();
  }

  setStopMode(mode: 'duration' | 'iterations'): void {
    if (!this.artifact) return;
    if (mode === 'duration') {
      this.artifact.config.iterations = null;
      if (!this.artifact.config.durationSec) this.artifact.config.durationSec = 30;
    } else {
      this.artifact.config.durationSec = null;
      if (!this.artifact.config.iterations) this.artifact.config.iterations = 100;
    }
    this.persist();
  }

  get stopMode(): 'duration' | 'iterations' {
    if (!this.artifact) return 'duration';
    return this.artifact.config.iterations != null ? 'iterations' : 'duration';
  }

  addSavedTarget(requestId: string): void {
    if (!this.artifact || !requestId) return;
    this.artifact.config.targets = [...this.artifact.config.targets, { kind: 'saved', requestId }];
    this.persist();
  }

  addInlineTarget(): void {
    if (!this.artifact) return;
    if (!this.inlineDraft.url.trim()) return;
    this.artifact.config.targets = [...this.artifact.config.targets, {
      kind: 'inline',
      method: this.inlineDraft.method,
      url: this.inlineDraft.url,
      body: this.inlineDraft.body || undefined,
    }];
    this.inlineDraft = { method: 'GET', url: '', body: '' };
    this.showInlineEditor = false;
    this.persist();
  }

  removeTarget(index: number): void {
    if (!this.artifact) return;
    this.artifact.config.targets = this.artifact.config.targets.filter((_, i) => i !== index);
    this.persist();
  }

  targetLabel(target: LoadTestTarget): string {
    if (target.kind === 'inline') return `${target.method} ${target.url}`;
    const req = this.collections.findRequestById(target.requestId);
    if (!req) return `(deleted request) ${target.requestId.slice(0, 6)}`;
    return `${HTTP_METHOD_LABELS[req.httpMethod] || 'GET'} ${req.title || req.url || '(untitled)'}`;
  }

  trackByIndex = (i: number) => i;

  onRunEnvironmentChange(id: string | null): void {
    this.runEnvironmentId = id;
    this.cdr.markForCheck();
  }

  async start(): Promise<void> {
    if (!this.artifact || this.running) return;
    if (this.artifact.config.targets.length === 0) {
      alert('Add at least one request before starting.');
      return;
    }
    this.result = null;
    this.progress = null;
    this.chartXs = [];
    this.rpsSeries = { ...this.rpsSeries, values: [] };
    this.errorSeries = { ...this.errorSeries, values: [] };
    this.p50Series = { ...this.p50Series, values: [] };
    this.p95Series = { ...this.p95Series, values: [] };
    this.rpsChartSeries = [this.rpsSeries, this.errorSeries];
    this.latencyChartSeries = [this.p50Series, this.p95Series];

    const runId = await this.loadTest.start(
      this.artifact.config,
      this.runEnvironmentId != null ? { environmentId: this.runEnvironmentId } : undefined,
    );
    if (!runId) {
      alert('Failed to start load run. Check the console for details.');
      return;
    }
    this.runId = runId;
    this.running = true;
    this.cdr.markForCheck();
  }

  async cancel(): Promise<void> {
    if (!this.runId || !this.running) return;
    this.cancelling = true;
    this.cdr.markForCheck();
    try {
      await this.loadTest.cancel(this.runId);
    } finally {
      this.cdr.markForCheck();
    }
  }

  exportResultJson(): void {
    if (!this.result) return;
    const blob = new Blob([JSON.stringify(this.result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.artifact?.title || 'load-test'}-${this.result.runId.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Status code → CSS tone. */
  bucketTone(code: string): 'success' | 'warn' | 'error' | 'default' {
    if (code === 'error') return 'error';
    const n = Number(code);
    if (!n) return 'default';
    if (n < 300) return 'success';
    if (n < 400) return 'default';
    if (n < 500) return 'warn';
    return 'error';
  }

  formatDuration(ms: number | undefined | null): string {
    if (!ms) return '0 ms';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
  }

  bucketPct(_code: string, count: number): number {
    const src = this.result?.summary?.statusBuckets ?? this.progress?.summary?.statusBuckets ?? {};
    const total = Object.values(src).reduce((a, b) => a + b, 0) || 1;
    return Math.round((count / total) * 1000) / 10;
  }

  trackBySampleIndex = (i: number, _: LoadSample) => i;

  openSampleDetails(s: LoadSample): void {
    this.detailSample = s;
    this.cdr.markForCheck();
  }

  closeSampleDetails(): void {
    this.detailSample = null;
    this.cdr.markForCheck();
  }

  sampleHasCapturedResponse(s: LoadSample | null | undefined): boolean {
    if (!s) {
      return false;
    }
    return !!(
      (s.responseHeaders && s.responseHeaders.length > 0) ||
      (s.responseBodyPreview != null && s.responseBodyPreview.length > 0) ||
      (s.responseStatusText != null && s.responseStatusText.length > 0)
    );
  }

  sampleTargetLabel(s: LoadSample): string {
    if (!this.artifact?.config?.targets?.length) {
      return `Target #${s.targetIndex + 1}`;
    }
    const t = this.artifact.config.targets[s.targetIndex];
    return t ? this.targetLabel(t) : `Target #${s.targetIndex + 1}`;
  }

  private persist(): void {
    if (!this.artifact) return;
    const next = { ...this.artifact, updatedAt: Date.now() };
    void this.artifacts.update('loadTests', next);
  }
}

function stripPrefix(tabId: string): string {
  return tabId.startsWith('lt:') ? tabId.slice(3) : tabId;
}

function flattenRequests(cols: Collection[]): RequestPick[] {
  const out: RequestPick[] = [];
  const walk = (folders: Folder[] = [], parentLabel: string) => {
    for (const f of folders) {
      const label = parentLabel ? `${parentLabel} / ${f.title}` : f.title;
      for (const req of f.requests || []) out.push(toPick(req, label));
      if (f.folders?.length) walk(f.folders, label);
    }
  };
  for (const c of cols) {
    for (const req of c.requests || []) out.push(toPick(req, c.title));
    walk(c.folders || [], c.title);
  }
  return out;
}

function toPick(req: Request, parentLabel: string): RequestPick {
  return {
    id: req.id,
    label: `${parentLabel} / ${req.title || req.url || '(untitled)'}`,
    method: HTTP_METHOD_LABELS[req.httpMethod] || 'GET',
  };
}
