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
import { v4 as uuidv4 } from 'uuid';

import type { TabItem } from '@core/tab.service';
import { TestArtifactService } from '@core/test-artifact.service';
import { TestSuiteRunnerService } from '@core/test-suite-runner.service';
import { CollectionService } from '@core/collection.service';
import type {
  Assertion,
  CaseRunResult,
  StatusAssertion,
  LatencyAssertion,
  HeaderAssertion,
  BodyAssertion,
  SnapshotAssertion,
  SnapshotRecord,
  SuiteRunResult,
  TestCase,
  TestSuiteArtifact,
} from '@models/testing/test-suite';
import { snapshotKey } from '@models/testing/test-suite';
import type { Collection, Folder } from '@models/collection';
import { HttpMethod, type Request as RequestModel } from '@models/request';

import { TreeResultsComponent, type TreeNode } from '../../shared/testing-ui/tree-results.component';
import { StatCardComponent } from '../../shared/testing-ui/stat-card.component';

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

type AssertionKind = Assertion['kind'];

@Component({
  selector: 'app-test-suite',
  standalone: true,
  imports: [CommonModule, FormsModule, TreeResultsComponent, StatCardComponent],
  templateUrl: './test-suite.component.html',
  styleUrls: ['./test-suite.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TestSuiteComponent implements OnInit, OnDestroy {
  @Input() tab!: TabItem;

  artifact: TestSuiteArtifact | null = null;
  selectedCaseId: string | null = null;

  /** Latest run output. Cleared on every Run All / Run Case. */
  results: Map<string, CaseRunResult> = new Map();
  finalResult: SuiteRunResult | null = null;
  running = false;

  requestPicks: RequestPick[] = [];
  treeNodes: TreeNode[] = [];

  showAddInline = false;
  inlineDraft = { method: 'GET', url: '' };

  private destroy$ = new Subject<void>();

  constructor(
    private artifacts: TestArtifactService,
    private runner: TestSuiteRunnerService,
    private collections: CollectionService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    const id = stripPrefix(this.tab.id);
    this.artifacts.testSuites$().pipe(takeUntil(this.destroy$)).subscribe((all) => {
      const found = all.find((a) => a.id === id);
      if (!found) return;
      this.artifact = JSON.parse(JSON.stringify(found));
      if (!this.selectedCaseId && this.artifact!.cases.length > 0) {
        this.selectedCaseId = this.artifact!.cases[0].id;
      }
      this.rebuildTree();
      this.cdr.markForCheck();
    });

    this.collections.getCollectionsObservable().pipe(takeUntil(this.destroy$)).subscribe((cols) => {
      this.requestPicks = flattenRequests(cols);
      this.cdr.markForCheck();
    });
    this.requestPicks = flattenRequests(this.collections.getCollections() || []);

    this.runner.onCaseResult().pipe(takeUntil(this.destroy$)).subscribe(({ suiteId, caseResult }) => {
      if (!this.artifact || suiteId !== this.artifact.id) return;
      this.results.set(caseResult.caseId, caseResult);
      this.rebuildTree();
      this.cdr.markForCheck();
    });

    this.runner.onFinished().pipe(takeUntil(this.destroy$)).subscribe((res) => {
      if (!this.artifact || res.suiteId !== this.artifact.id) return;
      this.finalResult = res;
      this.running = false;
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get selectedCase(): TestCase | null {
    if (!this.artifact || !this.selectedCaseId) return null;
    return this.artifact.cases.find((c) => c.id === this.selectedCaseId) || null;
  }

  get selectedCaseResult(): CaseRunResult | null {
    if (!this.selectedCaseId) return null;
    return this.results.get(this.selectedCaseId) || null;
  }

  trackById = (_: number, x: { id: string }) => x.id;

  caseStatus(caseId: string): TreeNode['status'] {
    const r = this.results.get(caseId);
    if (!r) return this.running ? 'running' : 'idle';
    return r.status === 'pass' ? 'pass'
      : r.status === 'fail' ? 'fail'
      : r.status === 'warn' ? 'warn'
      : 'skip';
  }

  totals(): { pass: number; fail: number; warn: number; skip: number; total: number } {
    let pass = 0, fail = 0, warn = 0, skip = 0;
    for (const r of this.results.values()) {
      if (r.status === 'pass') pass++;
      else if (r.status === 'fail') fail++;
      else if (r.status === 'warn') warn++;
      else if (r.status === 'skip') skip++;
    }
    return { pass, fail, warn, skip, total: this.artifact?.cases.length ?? 0 };
  }

  async runAll(): Promise<void> { await this.startRun({}); }
  async runFromHere(): Promise<void> {
    if (!this.selectedCaseId) return;
    await this.startRun({ fromCaseId: this.selectedCaseId });
  }
  async runOnly(caseId: string): Promise<void> { await this.startRun({ onlyCaseId: caseId }); }

  private async startRun(opts: { fromCaseId?: string; onlyCaseId?: string }): Promise<void> {
    if (!this.artifact || this.running) return;
    this.results.clear();
    this.finalResult = null;
    this.running = true;
    this.rebuildTree();
    try {
      await this.runner.run(this.artifact, opts);
    } finally {
      this.running = false;
      this.cdr.markForCheck();
    }
  }

  addSavedCase(requestId: string): void {
    if (!this.artifact || !requestId) return;
    const req = this.collections.findRequestById(requestId);
    const tc: TestCase = {
      id: uuidv4(),
      name: req?.title || 'New case',
      enabled: true,
      target: { kind: 'saved', requestId },
      assertions: [{ kind: 'status', expected: '2xx' } as StatusAssertion],
      extracts: [],
    };
    this.artifact.cases = [...this.artifact.cases, tc];
    this.selectedCaseId = tc.id;
    this.persist();
  }

  addInlineCase(): void {
    if (!this.artifact || !this.inlineDraft.url.trim()) return;
    const tc: TestCase = {
      id: uuidv4(),
      name: `${this.inlineDraft.method} ${this.inlineDraft.url}`,
      enabled: true,
      target: { kind: 'inline', method: this.inlineDraft.method, url: this.inlineDraft.url },
      assertions: [{ kind: 'status', expected: '2xx' } as StatusAssertion],
      extracts: [],
    };
    this.artifact.cases = [...this.artifact.cases, tc];
    this.selectedCaseId = tc.id;
    this.inlineDraft = { method: 'GET', url: '' };
    this.showAddInline = false;
    this.persist();
  }

  removeCase(caseId: string): void {
    if (!this.artifact) return;
    if (!confirm('Delete this case?')) return;
    this.artifact.cases = this.artifact.cases.filter((c) => c.id !== caseId);
    if (this.selectedCaseId === caseId) {
      this.selectedCaseId = this.artifact.cases[0]?.id ?? null;
    }
    this.persist();
  }

  duplicateCase(caseId: string): void {
    if (!this.artifact) return;
    const idx = this.artifact.cases.findIndex((c) => c.id === caseId);
    if (idx < 0) return;
    const copy: TestCase = JSON.parse(JSON.stringify(this.artifact.cases[idx]));
    copy.id = uuidv4();
    copy.name = `${copy.name} (copy)`;
    const next = [...this.artifact.cases];
    next.splice(idx + 1, 0, copy);
    this.artifact.cases = next;
    this.selectedCaseId = copy.id;
    this.persist();
  }

  toggleCaseEnabled(caseId: string): void {
    if (!this.artifact) return;
    const c = this.artifact.cases.find((c) => c.id === caseId);
    if (!c) return;
    c.enabled = !c.enabled;
    this.persist();
  }

  selectCase(caseId: string): void {
    this.selectedCaseId = caseId;
  }

  addAssertion(kind: AssertionKind): void {
    const tc = this.selectedCase;
    if (!tc) return;
    const a: Assertion =
      kind === 'status' ? { kind: 'status', expected: '2xx' } as StatusAssertion :
      kind === 'latency' ? { kind: 'latency', failAboveMs: 1000 } as LatencyAssertion :
      kind === 'header' ? { kind: 'header', name: '', op: 'exists' } as HeaderAssertion :
      kind === 'snapshot' ? {
        kind: 'snapshot',
        id: uuidv4(),
        matchStatus: true,
        includeHeaders: ['content-type'],
        ignorePaths: [],
      } as SnapshotAssertion :
      { kind: 'body', path: '', op: 'contains', value: '' } as BodyAssertion;
    tc.assertions = [...(tc.assertions || []), a];
    this.persist();
  }

  removeAssertion(idx: number): void {
    const tc = this.selectedCase;
    if (!tc) return;
    tc.assertions = tc.assertions.filter((_, i) => i !== idx);
    this.persist();
  }

  asStatus(a: Assertion): StatusAssertion { return a as StatusAssertion; }
  asLatency(a: Assertion): LatencyAssertion { return a as LatencyAssertion; }
  asHeader(a: Assertion): HeaderAssertion { return a as HeaderAssertion; }
  asBody(a: Assertion): BodyAssertion { return a as BodyAssertion; }
  asSnapshot(a: Assertion): SnapshotAssertion { return a as SnapshotAssertion; }

  /** Comma-separated UI binding for ignorePaths. */
  snapshotIgnorePathsText(a: SnapshotAssertion): string {
    return (a.ignorePaths || []).join(', ');
  }
  setSnapshotIgnorePaths(a: SnapshotAssertion, text: string): void {
    a.ignorePaths = text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    this.persist();
  }
  snapshotIncludeHeadersText(a: SnapshotAssertion): string {
    return (a.includeHeaders || []).join(', ');
  }
  setSnapshotIncludeHeaders(a: SnapshotAssertion, text: string): void {
    a.includeHeaders = text
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    this.persist();
  }

  /**
   * Delete the stored baseline so the next run re-captures it. Uses the
   * shared artifact store directly (snapshots aren't visible in the sidebar).
   */
  async clearBaseline(a: SnapshotAssertion): Promise<void> {
    const tc = this.selectedCase;
    if (!tc || !this.artifact) return;
    const key = snapshotKey(this.artifact.id, tc.id, a.id);
    const remaining = this.artifacts.testSuiteSnapshots().filter((s: SnapshotRecord) => s.id !== key);
    await this.artifacts.bulkReplace('testSuiteSnapshots', remaining);
  }

  /** Ask the runner to overwrite the stored baseline on the next run. */
  markForAccept(a: SnapshotAssertion): void {
    a.pendingAccept = true;
    this.persist();
  }

  /** True if a baseline already exists for this assertion. */
  hasBaseline(a: SnapshotAssertion): boolean {
    const tc = this.selectedCase;
    if (!tc || !this.artifact) return false;
    const key = snapshotKey(this.artifact.id, tc.id, a.id);
    return this.artifacts.testSuiteSnapshots().some((s: SnapshotRecord) => s.id === key);
  }

  onCaseEdit(): void { this.persist(); }
  onTitleChange(): void { this.persist(); }

  toggleRegressionMode(): void {
    if (!this.artifact) return;
    this.artifact.regressionMode = !this.artifact.regressionMode;
    this.persist();
  }

  /**
   * Accept the current run's snapshot for a given case/assertion as the new
   * baseline. Flags the assertion in-memory; the *next* run will write the
   * captured snapshot to the store. This keeps the storage write-path
   * single-sourced in the runner.
   */
  async acceptBaselineFromResult(caseId: string, assertionId: string): Promise<void> {
    if (!this.artifact) return;
    const tc = this.artifact.cases.find((c) => c.id === caseId);
    if (!tc) return;
    const a = tc.assertions.find(
      (x) => x.kind === 'snapshot' && (x as SnapshotAssertion).id === assertionId,
    ) as SnapshotAssertion | undefined;
    if (!a) return;
    a.pendingAccept = true;
    this.persist();
    await this.startRun({ onlyCaseId: caseId });
  }

  addVariable(): void {
    if (!this.artifact) return;
    this.artifact.variables = [...this.artifact.variables, { key: '', value: '' }];
    this.persist();
  }
  removeVariable(idx: number): void {
    if (!this.artifact) return;
    this.artifact.variables = this.artifact.variables.filter((_, i) => i !== idx);
    this.persist();
  }

  addExtraction(): void {
    const tc = this.selectedCase;
    if (!tc) return;
    tc.extracts = [...(tc.extracts || []), { as: '', source: '$.' }];
    this.persist();
  }
  removeExtraction(idx: number): void {
    const tc = this.selectedCase;
    if (!tc) return;
    tc.extracts = tc.extracts.filter((_, i) => i !== idx);
    this.persist();
  }

  private rebuildTree(): void {
    if (!this.artifact) { this.treeNodes = []; return; }
    this.treeNodes = this.artifact.cases.map((c) => {
      const r = this.results.get(c.id);
      const status = r ? this.caseStatus(c.id) : (this.running ? 'running' : 'idle');
      const meta = r ? `${r.durationMs} ms` : (c.enabled ? '' : 'disabled');
      return {
        id: c.id,
        label: c.name || '(unnamed)',
        status,
        meta,
        children: r?.assertions.map((a, i) => ({
          id: `${c.id}:a${i}`,
          label: a.label,
          status: a.status,
          meta: a.actual,
        })),
      };
    });
  }

  caseLabelFor(c: TestCase): string {
    if (c.target.kind === 'inline') return `${c.target.method} ${c.target.url}`;
    const req = this.collections.findRequestById(c.target.requestId);
    return req ? `${HTTP_METHOD_LABELS[req.httpMethod] || 'GET'} ${req.title || req.url}` : '(missing request)';
  }

  formatStatusList(): string[] {
    return ['1xx', '2xx', '3xx', '4xx', '5xx'];
  }

  onTreeNodeClick(n: TreeNode): void {
    const baseId = n.id.split(':')[0];
    if (!this.artifact?.cases.some((c) => c.id === baseId)) return;
    this.selectedCaseId = baseId;
  }

  private persist(): void {
    if (!this.artifact) return;
    void this.artifacts.update('testSuites', { ...this.artifact, updatedAt: Date.now() });
  }

  trackByIndex = (i: number, _: unknown) => i;
}

function stripPrefix(tabId: string): string {
  return tabId.startsWith('ts:') ? tabId.slice(3) : tabId;
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

function toPick(req: RequestModel, parentLabel: string): RequestPick {
  return {
    id: req.id,
    label: `${parentLabel} / ${req.title || req.url || '(untitled)'}`,
    method: HTTP_METHOD_LABELS[req.httpMethod] || 'GET',
  };
}
