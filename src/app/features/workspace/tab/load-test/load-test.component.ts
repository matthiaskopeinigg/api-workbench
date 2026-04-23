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

import { TabItem } from '@core/tabs/tab.service';
import { TestArtifactService } from '@core/testing/test-artifact.service';
import { LoadTestService } from '@core/testing/load-test.service';
import { CollectionService } from '@core/collection/collection.service';
import { SessionService } from '@core/session/session.service';
import {
  LOAD_TEST_SESSION_RUNS_KEY,
  type LoadTestSessionRunsMap,
} from '@core/testing/load-test-session.keys';
import {
  appendEmptyLoadTestProfile,
  appendLoadTestProfileCloningFromActive,
  appendLoadTestProfileFromTemplate,
  cloneConfig,
  DEFAULT_LOAD_CONFIG,
  ensureLoadTestProfiles,
  findLoadTestProfileTemplateById,
  LOAD_TEST_PROFILE_PICKER_EMPTY,
  LOAD_TEST_PROFILE_PICKER_TEMPLATE_PREFIX,
  LOAD_TEST_PROFILE_TEMPLATES,
  type LoadProgressEvent,
  type LoadRunResult,
  type LoadRunSummary,
  type LoadSample,
  type LoadTestArtifact,
  type LoadTestConfig,
  type LoadTestProfile,
  type LoadTestTarget,
} from '@models/testing/load-test';
import { v4 as uuidv4 } from 'uuid';
import type { Collection, Folder } from '@models/collection';
import { HttpMethod, type Request } from '@models/request';

import { StatCardComponent } from '../../shared/testing-ui/stat-card.component';
import { RunEnvironmentSelectComponent } from '../../shared/testing-ui/run-environment-select.component';
import {
  TimeSeriesChartComponent,
  type TimeSeriesSeries,
  type TimeSeriesViewRange,
} from '../../shared/testing-ui/time-series-chart.component';
import { DropdownComponent, type DropdownOption } from '../../shared/dropdown/dropdown.component';
import { AwDatePipe } from '../../shared/pipes/aw-date.pipe';

interface RequestPick {
  id: string;
  method: string;
  lineLabel: string;
  titleAttr: string;
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

/**
 * Heuristic latency bands (ms) for “good / fair / slow” UI labels.
 * Tail percentiles (p90+) allow higher numbers than median/mean.
 */
const LAT_MS_BANDS: Record<string, { good: number; warn: number }> = {
  mean: { good: 80, warn: 300 },
  p50: { good: 50, warn: 200 },
  p90: { good: 120, warn: 450 },
  p95: { good: 180, warn: 650 },
  p99: { good: 350, warn: 1200 },
};

const GRADE_TEXT: Record<'good' | 'warn' | 'bad', string> = {
  good: 'Good',
  warn: 'Fair',
  bad: 'Slow',
};

@Component({
  selector: 'app-load-test',
  standalone: true,
  imports: [CommonModule, FormsModule, StatCardComponent, TimeSeriesChartComponent, RunEnvironmentSelectComponent, DropdownComponent, AwDatePipe],
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
  p99Series: TimeSeriesSeries = { label: 'p99 (ms)', color: '#9333ea', values: [] };

  rpsChartSeries: TimeSeriesSeries[] = [this.rpsSeries, this.errorSeries];
  latencyChartSeries: TimeSeriesSeries[] = [this.p50Series, this.p95Series, this.p99Series];

  /** Catalog of saved requests for the picker. */
  requestPicks: RequestPick[] = [];
  requestDdOptions: DropdownOption[] = [];
  addRequestValue: string | null = null;

  /** Inline editor toggle for adding an inline target. */
  showInlineEditor = false;
  inlineDraft = { method: 'GET', url: '', body: '' };

  /** `null` = use workspace default (active / single env). */
  runEnvironmentId: string | null = null;

  /** Built-in profile presets (smoke, stress, …) — copies only; not linked after add. */
  readonly profileTemplates = LOAD_TEST_PROFILE_TEMPLATES;

  /** Collapsible “New profile from current” block in the sidebar (hidden by default). */
  profilesSectionOpen = false;
  /** Draft name for the next “New profile from current” (optional; default name if left blank). */
  newProfileFromCurrentName = '';

  /** Inclusive point indices in `chartXs`; `null` = full run. */
  chartViewRange: TimeSeriesViewRange | null = null;

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
      const next = ensureLoadTestProfiles(JSON.parse(JSON.stringify(found)) as LoadTestArtifact);
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
      this.rebuildRequestDropdown();
      this.cdr.markForCheck();
    });
    this.requestPicks = flattenRequests(this.collections.getCollections() || []);
    this.rebuildRequestDropdown();
  }

  private rebuildRequestDropdown(): void {
    this.requestDdOptions = this.requestPicks.map((r) => ({
      value: r.id,
      label: `${r.method} · ${r.lineLabel}`,
      title: r.titleAttr,
    }));
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
    this.chartViewRange = null;
    this.chartXs = result.series.map((p) => p.t);
    this.rpsSeries = { ...this.rpsSeries, values: result.series.map((p) => p.rps) };
    this.errorSeries = { ...this.errorSeries, values: result.series.map((p) => p.errors) };
    this.p50Series = { ...this.p50Series, values: result.series.map((p) => p.p50) };
    this.p95Series = { ...this.p95Series, values: result.series.map((p) => p.p95) };
    this.p99Series = {
      ...this.p99Series,
      values: result.series.map((p) => p.p99 ?? p.p95),
    };
    this.rpsChartSeries = [this.rpsSeries, this.errorSeries];
    this.latencyChartSeries = [this.p50Series, this.p95Series, this.p99Series];
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
    this.p99Series = { ...this.p99Series, values: [...this.p99Series.values, event.point.p99] };
    if (this.chartXs.length > 600) {
      this.chartXs = this.chartXs.slice(-600);
      this.rpsSeries = { ...this.rpsSeries, values: this.rpsSeries.values.slice(-600) };
      this.errorSeries = { ...this.errorSeries, values: this.errorSeries.values.slice(-600) };
      this.p50Series = { ...this.p50Series, values: this.p50Series.values.slice(-600) };
      this.p95Series = { ...this.p95Series, values: this.p95Series.values.slice(-600) };
      this.p99Series = { ...this.p99Series, values: this.p99Series.values.slice(-600) };
    }
    this.rpsChartSeries = [this.rpsSeries, this.errorSeries];
    this.latencyChartSeries = [this.p50Series, this.p95Series, this.p99Series];
  }

  onTitleChange(): void { this.persist(); }
  /** Profile name / notes only (does not fork off a preset). */
  onProfileMetaChange(): void { this.persist(); }
  /** VUs, targets, stop mode, and other load fields — will fork a “Custom” profile if needed. */
  onLoadConfigChange(): void {
    if (!this.artifact) return;
    this.ensureCustomWorkProfile(this.artifact);
    this.persist();
  }
  onRpsCapChange(a: LoadTestArtifact, value: number | string | null): void {
    this.ensureCustomWorkProfile(a);
    a.config.rpsCap = value === '' || value == null ? null : Number(value);
    this.persist();
  }

  onSelectProfile(a: LoadTestArtifact, profileId: string | null): void {
    if (!profileId || !a.profiles?.some((p) => p.id === profileId)) {
      return;
    }
    a.activeProfileId = profileId;
    const p = a.profiles.find((x) => x.id === profileId);
    if (p) {
      a.config = p.config;
    }
    this.persist();
    this.cdr.markForCheck();
  }

  /**
   * Header profile dropdown: switch active profile, or add from catalog / empty.
   */
  onProfileHeaderPick(a: LoadTestArtifact, value: string | null): void {
    if (value == null || value === '') {
      return;
    }
    if (value.startsWith(LOAD_TEST_PROFILE_PICKER_TEMPLATE_PREFIX)) {
      const tid = value.slice(LOAD_TEST_PROFILE_PICKER_TEMPLATE_PREFIX.length);
      const t = findLoadTestProfileTemplateById(tid);
      if (!t) {
        return;
      }
      ensureLoadTestProfiles(a);
      appendLoadTestProfileFromTemplate(a, t);
      this.artifact = a;
      this.persist();
      this.cdr.markForCheck();
      return;
    }
    if (value === LOAD_TEST_PROFILE_PICKER_EMPTY) {
      ensureLoadTestProfiles(a);
      appendEmptyLoadTestProfile(a);
      this.artifact = a;
      this.persist();
      this.cdr.markForCheck();
      return;
    }
    this.onSelectProfile(a, value);
  }

  toggleProfilesSection(): void {
    this.profilesSectionOpen = !this.profilesSectionOpen;
    this.cdr.markForCheck();
  }

  /** Save the active profile’s current load settings as a new profile and switch to it. */
  addProfileCloningCurrent(a: LoadTestArtifact): void {
    ensureLoadTestProfiles(a);
    appendLoadTestProfileCloningFromActive(a, this.newProfileFromCurrentName);
    this.newProfileFromCurrentName = '';
    this.artifact = a;
    this.persist();
    this.cdr.markForCheck();
  }

  removeActiveProfile(a: LoadTestArtifact): void {
    if (!a.profiles || a.profiles.length < 2) {
      return;
    }
    const cur = a.activeProfileId;
    const active = a.profiles.find((p) => p.id === cur);
    if (active?.isTemplate) {
      return;
    }
    a.profiles = a.profiles.filter((p) => p.id !== cur);
    a.activeProfileId = a.profiles[0].id;
    a.config = a.profiles[0].config;
    this.persist();
    this.cdr.markForCheck();
  }

  onChartViewChange(r: TimeSeriesViewRange | null): void {
    this.chartViewRange = r;
    this.cdr.markForCheck();
  }

  resetChartView(): void {
    this.chartViewRange = null;
    this.cdr.markForCheck();
  }

  activeProfile(a: LoadTestArtifact | null) {
    if (!a?.profiles) {
      return null;
    }
    return a.profiles.find((p) => p.id === a.activeProfileId) ?? a.profiles[0] ?? null;
  }

  /** True when the active profile can be removed (not a template, and not the only row). */
  canRemoveActiveProfile(a: LoadTestArtifact | null): boolean {
    if (!a?.profiles || a.profiles.length < 2) {
      return false;
    }
    const p = this.activeProfile(a);
    return !p?.isTemplate;
  }

  setStopMode(mode: 'duration' | 'iterations'): void {
    if (!this.artifact) return;
    this.ensureCustomWorkProfile(this.artifact);
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

  onPickedAddTarget(v: string | null): void {
    if (v == null || v === '') return;
    this.addSavedTarget(v);
    this.addRequestValue = null;
    this.cdr.markForCheck();
  }

  addSavedTarget(requestId: string): void {
    if (!this.artifact || !requestId) return;
    this.ensureCustomWorkProfile(this.artifact);
    this.artifact.config.targets = [{ kind: 'saved', requestId }];
    this.persist();
  }

  addInlineTarget(): void {
    if (!this.artifact) return;
    if (!this.inlineDraft.url.trim()) return;
    this.ensureCustomWorkProfile(this.artifact);
    this.artifact.config.targets = [{
      kind: 'inline',
      method: this.inlineDraft.method,
      url: this.inlineDraft.url,
      body: this.inlineDraft.body || undefined,
    }];
    this.inlineDraft = { method: 'GET', url: '', body: '' };
    this.showInlineEditor = false;
    this.persist();
  }

  clearTarget(): void {
    if (!this.artifact) return;
    this.ensureCustomWorkProfile(this.artifact);
    this.artifact.config.targets = [];
    this.persist();
  }

  targetLabel(target: LoadTestTarget): string {
    if (target.kind === 'inline') return `${target.method} ${target.url}`;
    const req = this.collections.findRequestById(target.requestId);
    if (!req) return `(deleted request) ${target.requestId.slice(0, 6)}`;
    return `${HTTP_METHOD_LABELS[req.httpMethod] || 'GET'} ${req.title || req.url || '(untitled)'}`;
  }

  /** At most one target per config — used for the Target row in the template. */
  activeTarget(a: LoadTestArtifact | null): LoadTestTarget | null {
    const t = a?.config?.targets;
    return t && t[0] ? t[0] : null;
  }

  trackByIndex = (i: number) => i;

  onRunEnvironmentChange(id: string | null): void {
    this.runEnvironmentId = id;
    this.cdr.markForCheck();
  }

  async start(event?: Event): Promise<void> {
    event?.preventDefault();
    event?.stopPropagation();
    if (!this.artifact || this.running) return;
    if (this.artifact.config.targets.length === 0) {
      alert('Choose a target (saved request or inline URL) before starting.');
      return;
    }
    this.result = null;
    this.progress = null;
    this.chartXs = [];
    this.rpsSeries = { ...this.rpsSeries, values: [] };
    this.errorSeries = { ...this.errorSeries, values: [] };
    this.p50Series = { ...this.p50Series, values: [] };
    this.p95Series = { ...this.p95Series, values: [] };
    this.p99Series = { ...this.p99Series, values: [] };
    this.rpsChartSeries = [this.rpsSeries, this.errorSeries];
    this.latencyChartSeries = [this.p50Series, this.p95Series, this.p99Series];
    this.chartViewRange = null;

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

  /** Live or final aggregate stats (for overview + analysis). */
  activeSummary(): LoadRunSummary | null {
    return this.result?.summary ?? this.progress?.summary ?? null;
  }

  successRatePct(s: LoadRunSummary): number {
    if (!s.total) {
      return 100;
    }
    return Math.round((s.successful / s.total) * 1000) / 10;
  }

  errorRatePct(s: LoadRunSummary): number {
    if (!s.total) {
      return 0;
    }
    return Math.round((s.failed / s.total) * 1000) / 10;
  }

  runStateLabel(): string {
    if (this.running) {
      return 'Running';
    }
    if (!this.result) {
      return 'Idle';
    }
    if (this.result.status === 'finished') {
      return 'Finished';
    }
    if (this.result.status === 'cancelled') {
      return 'Stopped';
    }
    if (this.result.status === 'error') {
      return 'Error';
    }
    return 'Idle';
  }

  runHealthClass(): 'ok' | 'warn' | 'bad' {
    const s = this.activeSummary();
    if (!s || !s.total) {
      return 'ok';
    }
    const e = s.failed / s.total;
    if (e > 0.05) {
      return 'bad';
    }
    if (e > 0.005) {
      return 'warn';
    }
    return 'ok';
  }

  /**
   * Plain-language result when a run is done (not shown while still running).
   * Complements the state pill (Finished / Stopped / …) with good / issues / fail copy.
   */
  runOutcomeLine():
    | { text: string; kind: 'good' | 'warn' | 'bad' | 'neutral' }
    | null {
    if (this.running || !this.result) {
      return null;
    }
    const r = this.result;
    const s = r.summary;
    if (r.status === 'error') {
      const msg = r.errors[0]?.message;
      if (msg) {
        const t = msg.length > 160 ? `${msg.slice(0, 157)}…` : msg;
        return { text: `Run failed: ${t}`, kind: 'bad' };
      }
      return { text: 'Run failed', kind: 'bad' };
    }
    if (r.status === 'cancelled') {
      if (!s.total) {
        return { text: 'Stopped before any requests completed', kind: 'neutral' };
      }
      if (s.failed > 0) {
        return {
          text: `Stopped with issues — ${s.failed} failed, ${s.successful} succeeded (partial)`,
          kind: 'warn',
        };
      }
      return {
        text: `Stopped early — all ${s.successful} request(s) succeeded (partial run)`,
        kind: 'good',
      };
    }
    if (r.status === 'finished') {
      if (!s.total) {
        return { text: 'No requests completed', kind: 'neutral' };
      }
      if (s.failed === 0) {
        return {
          text: `Good — all ${s.total} request(s) succeeded`,
          kind: 'good',
        };
      }
      const health = this.runHealthClass();
      const kind: 'bad' | 'warn' = health === 'bad' ? 'bad' : 'warn';
      return {
        text: `Issues — ${s.failed} of ${s.total} request(s) failed (${this.errorRatePct(s)}% error rate)`,
        kind,
      };
    }
    return null;
  }

  /**
   * Classify a latency sample (ms) for a given metric (mean, p50, …).
   * Used in latency analysis rows and stat cards.
   */
  latencyTimingGrade(ms: number, key: string): 'good' | 'warn' | 'bad' {
    const t = LAT_MS_BANDS[key] ?? { good: 180, warn: 650 };
    if (ms <= t.good) {
      return 'good';
    }
    if (ms <= t.warn) {
      return 'warn';
    }
    return 'bad';
  }

  /** Map row grade to `aw-stat-card` tone. */
  latencyStatTone(ms: number, key: string): 'default' | 'success' | 'warn' | 'error' {
    const g = this.latencyTimingGrade(ms, key);
    if (g === 'good') {
      return 'success';
    }
    if (g === 'warn') {
      return 'warn';
    }
    return 'error';
  }

  /**
   * One-line verdict for the latency panel (heuristic; not a custom SLO).
   */
  latencyPanelVerdict(
    s: LoadRunSummary,
    live: boolean,
  ): { text: string; kind: 'good' | 'warn' | 'bad' } {
    const rows = this.latencyRows(s);
    const order: Record<'good' | 'warn' | 'bad', number> = { good: 0, warn: 1, bad: 2 };
    const kind = rows.reduce(
      (w, r) => (order[r.grade] > order[w] ? r.grade : w),
      'good' as 'good' | 'warn' | 'bad',
    );
    const prefix = live ? 'Approximate: ' : '';
    if (kind === 'good') {
      return {
        text: prefix + (live ? 'timings look good so far' : 'Timings look good (mean and tail in a healthy range)'),
        kind: 'good',
      };
    }
    if (kind === 'warn') {
      return {
        text: prefix + (live ? 'moderate latency on the rolling window' : 'Moderate latency — check p95 / p99 if SLOs are tight'),
        kind: 'warn',
      };
    }
    return {
      text: prefix + (live ? 'high latency on the rolling window' : 'High latency — consider scaling, caching, or lighter work per request'),
      kind: 'bad',
    };
  }

  /**
   * Rows for the latency table + bar widths (max normalized to 100% width)
   * and per-metric good/fair/slow labels.
   */
  latencyRows(s: LoadRunSummary): {
    key: string;
    label: string;
    detail: string;
    ms: number;
    widthPct: number;
    grade: 'good' | 'warn' | 'bad';
    gradeLabel: string;
  }[] {
    const rows: { key: string; label: string; detail: string; ms: number }[] = [
      { key: 'mean', label: 'Mean', detail: 'Average across all requests', ms: s.meanMs },
      { key: 'p50', label: 'p50', detail: 'Half of requests faster than this', ms: s.p50 },
      { key: 'p90', label: 'p90', detail: '90% of requests faster than this', ms: s.p90 },
      { key: 'p95', label: 'p95', detail: 'Common SLO line', ms: s.p95 },
      { key: 'p99', label: 'p99', detail: 'Tail latency — worst 1% slower than this', ms: s.p99 },
    ];
    const max = Math.max(...rows.map((r) => r.ms), 1);
    return rows.map((r) => {
      const grade = this.latencyTimingGrade(r.ms, r.key);
      return {
        ...r,
        widthPct: Math.min(100, (r.ms / max) * 100),
        grade,
        gradeLabel: GRADE_TEXT[grade],
      };
    });
  }

  /** One line describing the current load profile (for the config card). */
  configSummaryLine(a: LoadTestArtifact): string {
    const c = a.config;
    const parts: string[] = [`${c.vus} VUs`];
    if (c.rampUpSec) {
      parts.push(`${c.rampUpSec}s ramp-up`);
    }
    if (c.iterations != null) {
      parts.push(`${c.iterations} total iterations`);
    } else {
      parts.push(`${c.durationSec ?? 0}s duration`);
    }
    if (c.thinkMs) {
      parts.push(`${c.thinkMs}ms think`);
    }
    if (c.rpsCap) {
      parts.push(`≤${c.rpsCap} RPS cap`);
    }
    return parts.join(' · ');
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

  /**
   * When editing load settings on a built-in / template row (`!userCustom`), copy the
   * in‑progress values into a new “Custom” profile and leave the preset reset.
   */
  private ensureCustomWorkProfile(a: LoadTestArtifact): void {
    ensureLoadTestProfiles(a);
    const ap = a.profiles?.find((p) => p.id === a.activeProfileId);
    if (!ap || ap.userCustom !== false) {
      return;
    }
    const edited = cloneConfig(a.config);
    ap.config = this.configResetForNonCustomProfile(ap);
    const id = `p-${uuidv4()}`;
    const created: LoadTestProfile = {
      id,
      name: this.nextCustomProfileName(a),
      description: 'Your load settings (forked from a preset). The preset is unchanged.',
      userCustom: true,
      isTemplate: false,
      config: edited,
    };
    a.profiles = [...(a.profiles || []), created];
    a.activeProfileId = id;
    a.config = created.config;
  }

  private configResetForNonCustomProfile(p: LoadTestProfile): LoadTestConfig {
    const t = this.profileTemplates.find((x) => x.name === p.name);
    if (t) {
      return t.factory();
    }
    return cloneConfig({ ...DEFAULT_LOAD_CONFIG });
  }

  private nextCustomProfileName(a: LoadTestArtifact): string {
    const names = new Set((a.profiles || []).map((p) => p.name));
    if (!names.has('Custom')) {
      return 'Custom';
    }
    let n = 2;
    while (names.has(`Custom ${n}`)) {
      n += 1;
    }
    return `Custom ${n}`;
  }

  headerProfileOptions(a: LoadTestArtifact): DropdownOption[] {
    const existing: DropdownOption[] = (a.profiles || []).map((p) => ({
      value: p.id,
      label: p.isTemplate ? `${p.name} (template)` : p.name,
      title: p.description,
      description: p.description,
    }));
    const fromCatalog: DropdownOption[] = LOAD_TEST_PROFILE_TEMPLATES.map((t) => ({
      value: LOAD_TEST_PROFILE_PICKER_TEMPLATE_PREFIX + t.id,
      label: t.name,
      title: t.description,
      description: t.description,
    }));
    const emptyRow: DropdownOption[] = [
      {
        value: LOAD_TEST_PROFILE_PICKER_EMPTY,
        label: 'Empty profile',
        description: 'New profile with default load fields; set VUs, duration, and target as needed.',
      },
    ];
    return [...existing, ...fromCatalog, ...emptyRow];
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

function toPick(req: Request, pathPrefix: string): RequestPick {
  const t = req.title?.trim() || req.url || '(untitled)';
  const full = `${pathPrefix} / ${t}`.replace(/\s*\/\s*\/\s*/g, ' / ');
  return {
    id: req.id,
    method: HTTP_METHOD_LABELS[req.httpMethod] || 'GET',
    lineLabel: t,
    titleAttr: full,
  };
}

function flattenRequests(cols: Collection[]): RequestPick[] {
  const out: RequestPick[] = [];
  const walk = (folders: Folder[] = [], parentLabel: string) => {
    for (const f of folders) {
      const label = parentLabel ? `${parentLabel} / ${f.title}` : f.title;
      for (const req of f.requests || []) {
        out.push(toPick(req, label));
      }
      if (f.folders?.length) {
        walk(f.folders, label);
      }
    }
  };
  for (const c of cols) {
    for (const req of c.requests || []) {
      out.push(toPick(req, c.title));
    }
    walk(c.folders || [], c.title);
  }
  return out;
}
