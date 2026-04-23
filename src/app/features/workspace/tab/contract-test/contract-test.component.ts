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

import type { TabItem } from '@core/tabs/tab.service';
import { TestArtifactService } from '@core/testing/test-artifact.service';
import { CollectionService } from '@core/collection/collection.service';
import { ContractValidatorService } from '@core/testing/contract-validator.service';
import { SettingsService } from '@core/settings/settings.service';
import type {
  ContractFinding,
  ContractRunResult,
  ContractTestArtifact,
  SpecSource,
} from '@models/testing/contract-test';
import type { Collection } from '@models/collection';
import { parseOpenApi, type ParsedSpec } from '@core/import-pipeline/openapi-parser';

import { StatCardComponent } from '../../shared/testing-ui/stat-card.component';
import { TreeResultsComponent, type TreeNode } from '../../shared/testing-ui/tree-results.component';
import { RunEnvironmentSelectComponent } from '../../shared/testing-ui/run-environment-select.component';
import { AwDatePipe } from '../../shared/pipes/aw-date.pipe';

type SeverityFilter = 'all' | 'error' | 'warning' | 'info';

@Component({
  selector: 'app-contract-test',
  standalone: true,
  imports: [CommonModule, FormsModule, StatCardComponent, TreeResultsComponent, RunEnvironmentSelectComponent, AwDatePipe],
  templateUrl: './contract-test.component.html',
  styleUrls: ['./contract-test.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContractTestComponent implements OnInit, OnDestroy {
  @Input() tab!: TabItem;

  artifact: ContractTestArtifact | null = null;

  collections: Collection[] = [];
  parsedSpec: ParsedSpec | null = null;
  specError: string | null = null;

  findings: ContractFinding[] = [];
  result: ContractRunResult | null = null;
  running = false;
  fetchingSpec = false;

  severityFilter: SeverityFilter = 'all';
  treeNodes: TreeNode[] = [];

  /** Selected finding, for the detail panel. */
  selectedFinding: ContractFinding | null = null;

  /** `null` = workspace default for `{{var}}` in request URLs. */
  runEnvironmentId: string | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private artifacts: TestArtifactService,
    private validator: ContractValidatorService,
    private collectionService: CollectionService,
    private cdr: ChangeDetectorRef,
    private settings: SettingsService,
  ) {}

  ngOnInit(): void {
    const id = stripPrefix(this.tab.id);
    this.artifacts.contractTests$().pipe(takeUntil(this.destroy$)).subscribe((all) => {
      const found = all.find((a) => a.id === id);
      if (!found) return;
      this.artifact = JSON.parse(JSON.stringify(found));
      this.reparseSpec();
      this.cdr.markForCheck();
    });

    this.collectionService.getCollectionsObservable().pipe(takeUntil(this.destroy$)).subscribe((cols) => {
      this.collections = cols;
      this.cdr.markForCheck();
    });
    this.collections = this.collectionService.getCollections() || [];

    this.validator.onFinding().pipe(takeUntil(this.destroy$)).subscribe(({ contractId, finding }) => {
      if (!this.artifact || contractId !== this.artifact.id) return;
      this.findings = [...this.findings, finding];
      this.rebuildTree();
      this.cdr.markForCheck();
    });

    this.validator.onFinished().pipe(takeUntil(this.destroy$)).subscribe((res) => {
      if (!this.artifact || res.contractId !== this.artifact.id) return;
      this.result = res;
      this.running = false;
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get specKind(): 'inline' | 'url' { return this.artifact?.spec.kind ?? 'inline'; }

  setSpecKind(kind: 'inline' | 'url'): void {
    if (!this.artifact) return;
    const current = this.artifact.spec;
    if (current.kind === kind) return;
    this.artifact.spec = kind === 'inline'
      ? { kind: 'inline', format: 'yaml', body: '', updatedAt: Date.now() }
      : { kind: 'url', url: '', lastFetchedAt: null };
    this.reparseSpec();
    this.persist();
  }

  get inlineSpec(): Extract<SpecSource, { kind: 'inline' }> | null {
    return this.artifact?.spec.kind === 'inline' ? this.artifact.spec : null;
  }
  get urlSpec(): Extract<SpecSource, { kind: 'url' }> | null {
    return this.artifact?.spec.kind === 'url' ? this.artifact.spec : null;
  }

  onSpecBodyChange(): void {
    if (!this.artifact || this.artifact.spec.kind !== 'inline') return;
    this.artifact.spec.updatedAt = Date.now();
    this.reparseSpec();
    this.persist();
  }

  onSpecFormatChange(format: 'json' | 'yaml'): void {
    if (!this.artifact || this.artifact.spec.kind !== 'inline') return;
    this.artifact.spec.format = format;
    this.reparseSpec();
    this.persist();
  }

  async fetchSpecUrl(): Promise<void> {
    if (!this.artifact || this.artifact.spec.kind !== 'url' || !this.artifact.spec.url) return;
    this.fetchingSpec = true;
    try {
      await this.settings.loadSettings();
      const ipc = this.settings.applyGlobalNetworkToIpc(
        {
          method: 'GET',
          url: this.artifact.spec.url,
          headers: { accept: 'application/json, application/yaml, text/yaml' },
          params: {},
          followRedirects: true,
          timeoutMs: 30000,
        },
        {},
      );
      const resp = await window.awElectron.httpRequest(ipc as never) as { status: number; body?: unknown; headers?: Record<string, string> };
      const body = typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body ?? '', null, 2);
      const ct = (resp.headers?.['content-type'] || resp.headers?.['Content-Type'] || '').toLowerCase();
      const format: 'json' | 'yaml' = ct.includes('yaml') ? 'yaml' : 'json';
      this.artifact.spec = {
        kind: 'url',
        url: this.artifact.spec.url,
        lastFetchedAt: Date.now(),
        cachedBody: body,
        cachedFormat: format,
      };
      this.reparseSpec();
      this.persist();
    } catch (err) {
      this.specError = err instanceof Error ? err.message : String(err);
    } finally {
      this.fetchingSpec = false;
      this.cdr.markForCheck();
    }
  }

  private reparseSpec(): void {
    if (!this.artifact) { this.parsedSpec = null; this.specError = null; return; }
    const spec = this.artifact.spec;
    const body = spec.kind === 'inline' ? spec.body : (spec.cachedBody || '');
    const format = spec.kind === 'inline' ? spec.format : (spec.cachedFormat || 'auto');
    if (!body.trim()) { this.parsedSpec = null; this.specError = null; return; }
    const parsed = parseOpenApi(body, format);
    this.parsedSpec = parsed;
    this.specError = parsed.errors.length ? parsed.errors.join('\n') : null;
  }

  onScopeChange(): void { this.persist(); }

  get folderPicks(): Array<{ id: string; label: string }> {
    if (!this.artifact?.scope.collectionId) return [];
    const col = this.collections.find((c) => c.id === this.artifact!.scope.collectionId);
    if (!col) return [];
    const out: Array<{ id: string; label: string }> = [];
    const walk = (folders: Collection['folders'], prefix: string) => {
      for (const f of folders) {
        const label = prefix ? `${prefix} / ${f.title}` : f.title;
        out.push({ id: f.id, label });
        if (f.folders?.length) walk(f.folders, label);
      }
    };
    walk(col.folders || [], '');
    return out;
  }

  async runAll(): Promise<void> { await this.startRun(false); }
  async runStaticOnly(): Promise<void> { await this.startRun(true); }

  onRunEnvironmentChange(id: string | null): void {
    this.runEnvironmentId = id;
    this.cdr.markForCheck();
  }

  private async startRun(staticOnly: boolean): Promise<void> {
    if (!this.artifact || this.running) return;
    if (!this.artifact.scope.collectionId) {
      alert('Pick a collection to validate.');
      return;
    }
    this.findings = [];
    this.result = null;
    this.selectedFinding = null;
    this.running = true;
    this.rebuildTree();
    this.cdr.markForCheck();
    try {
      await this.validator.run(this.artifact, {
        staticOnly,
        ...(this.runEnvironmentId != null ? { environmentId: this.runEnvironmentId } : {}),
      });
    } finally {
      this.running = false;
      this.cdr.markForCheck();
    }
  }

  setFilter(f: SeverityFilter): void {
    this.severityFilter = f;
    this.rebuildTree();
  }

  totals(): { error: number; warning: number; info: number; ok: number } {
    if (this.result) return this.result.totals;
    const t = { error: 0, warning: 0, info: 0, ok: 0 };
    for (const f of this.findings) {
      if (f.kind === 'ok') t.ok++;
      else if (f.severity === 'error') t.error++;
      else if (f.severity === 'warning') t.warning++;
      else t.info++;
    }
    return t;
  }

  private rebuildTree(): void {
    const filtered = this.findings.filter((f) =>
      this.severityFilter === 'all'
        ? true
        : this.severityFilter === 'info'
          ? f.severity === 'info' || f.kind === 'ok'
          : f.severity === this.severityFilter,
    );
    const groups = new Map<string, ContractFinding[]>();
    for (const f of filtered) {
      const key = `${f.method} ${f.path}`;
      const list = groups.get(key);
      if (list) list.push(f); else groups.set(key, [f]);
    }
    this.treeNodes = [...groups.entries()].map(([key, items]) => {
      const worst = worstSeverity(items);
      return {
        id: `g:${key}`,
        label: key,
        status: worst,
        meta: `${items.length} ${items.length === 1 ? 'finding' : 'findings'}`,
        children: items.map((f) => ({
          id: f.id,
          label: f.message,
          status: statusFor(f),
          meta: f.kind,
        })),
      } as TreeNode;
    });
  }

  onTreeClick(n: TreeNode): void {
    const match = this.findings.find((f) => f.id === n.id);
    if (match) this.selectedFinding = match;
  }

  exportJson(): void {
    if (!this.result && !this.findings.length) return;
    const payload = this.result ?? { findings: this.findings };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.artifact?.title || 'contract'}-findings.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  onTitleChange(): void { this.persist(); }

  private persist(): void {
    if (!this.artifact) return;
    void this.artifacts.update('contractTests', { ...this.artifact, updatedAt: Date.now() });
  }

  trackByFinding = (_: number, f: ContractFinding) => f.id;
}

function stripPrefix(tabId: string): string {
  return tabId.startsWith('ct:') ? tabId.slice(3) : tabId;
}

function statusFor(f: ContractFinding): TreeNode['status'] {
  if (f.kind === 'ok') return 'pass';
  if (f.severity === 'error') return 'fail';
  if (f.severity === 'warning') return 'warn';
  return 'info';
}

function worstSeverity(items: ContractFinding[]): TreeNode['status'] {
  let worst: TreeNode['status'] = 'pass';
  for (const f of items) {
    const s = statusFor(f);
    if (s === 'fail') return 'fail';
    if (s === 'warn') worst = 'warn';
    else if (s === 'info' && worst === 'pass') worst = 'info';
  }
  return worst;
}
