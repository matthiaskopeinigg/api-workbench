import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';

import { TabService } from '@core/tab.service';
import { TestArtifactService } from '@core/test-artifact.service';
import type { LoadTestArtifact } from '@models/testing/load-test';
import { DEFAULT_LOAD_CONFIG } from '@models/testing/load-test';
import type { TestSuiteArtifact } from '@models/testing/test-suite';
import { NEW_TEST_SUITE } from '@models/testing/test-suite';
import type { ContractTestArtifact } from '@models/testing/contract-test';
import { NEW_CONTRACT_TEST } from '@models/testing/contract-test';
import type { FlowArtifact } from '@models/testing/flow';
import { NEW_FLOW } from '@models/testing/flow';

interface ArtifactBase { id: string; title: string; updatedAt: number; }

interface Section<T extends ArtifactBase> {
  key: 'loadTests' | 'testSuites' | 'contractTests' | 'flows';
  label: string;
  icon: string;
  /** SVG path for the activity-style icon shown at the top of each row. */
  items: T[];
  collapsed: boolean;
  /** Open by id. */
  open: (id: string, title: string) => void;
  /** Create a new artifact and return it (caller persists). */
  create: () => T;
}

@Component({
  selector: 'app-tests',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './tests.component.html',
  styleUrls: ['./tests.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TestsComponent implements OnInit, OnDestroy {
  sections: Section<ArtifactBase>[] = [];

  /** Inline rename state. */
  editingId: string | null = null;
  editingTitle = '';
  /** id of the row whose context menu is open. */
  contextMenuFor: string | null = null;
  contextMenuKind: Section<ArtifactBase>['key'] | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private artifacts: TestArtifactService,
    private tabService: TabService,
    private cdr: ChangeDetectorRef,
  ) {
    this.sections = [
      this.makeSection('loadTests', 'Load Tests',
        'M3 17l4-8 4 6 3-3 7 9',
        () => this.makeLoadTest(),
        (id, title) => this.tabService.openLoadTestTab(id, title)),
      this.makeSection('testSuites', 'Test Suites',
        'M5 4h14v4H5zM5 10h14v4H5zM5 16h14v4H5z',
        () => this.makeSuite(),
        (id, title) => this.tabService.openTestSuiteTab(id, title)),
      this.makeSection('contractTests', 'Contract Tests',
        'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 13h6 M9 17h6',
        () => this.makeContract(),
        (id, title) => this.tabService.openContractTestTab(id, title)),
      this.makeSection('flows', 'Flows',
        'M3 6a3 3 0 1 1 6 0 3 3 0 0 1-6 0zM15 6a3 3 0 1 1 6 0 3 3 0 0 1-6 0zM9 18a3 3 0 1 1 6 0 3 3 0 0 1-6 0zM6 9v6 M18 9v6 M9 6h6',
        () => this.makeFlow(),
        (id, title) => this.tabService.openFlowTab(id, title)),
    ];
  }

  ngOnInit(): void {
    this.artifacts.loadTests$().pipe(takeUntil(this.destroy$)).subscribe((items) => {
      this.sections[0].items = items as ArtifactBase[];
      this.cdr.markForCheck();
    });
    this.artifacts.testSuites$().pipe(takeUntil(this.destroy$)).subscribe((items) => {
      this.sections[1].items = items as ArtifactBase[];
      this.cdr.markForCheck();
    });
    this.artifacts.contractTests$().pipe(takeUntil(this.destroy$)).subscribe((items) => {
      this.sections[2].items = items as ArtifactBase[];
      this.cdr.markForCheck();
    });
    this.artifacts.flows$().pipe(takeUntil(this.destroy$)).subscribe((items) => {
      this.sections[3].items = items as ArtifactBase[];
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  trackById = (_: number, a: ArtifactBase) => a.id;

  toggle(section: Section<ArtifactBase>): void {
    section.collapsed = !section.collapsed;
  }

  async createNew(section: Section<ArtifactBase>): Promise<void> {
    const artifact = section.create();
    await this.artifacts.create(section.key, artifact);
    section.open(artifact.id, artifact.title);
    this.editingId = artifact.id;
    this.editingTitle = artifact.title;
    this.cdr.markForCheck();
  }

  async openItem(section: Section<ArtifactBase>, item: ArtifactBase): Promise<void> {
    section.open(item.id, item.title);
  }

  beginRename(item: ArtifactBase): void {
    this.editingId = item.id;
    this.editingTitle = item.title;
    this.contextMenuFor = null;
  }

  async commitRename(section: Section<ArtifactBase>, item: ArtifactBase): Promise<void> {
    if (this.editingId !== item.id) return;
    const next = (this.editingTitle || '').trim() || item.title;
    if (next === item.title) {
      this.editingId = null;
      return;
    }
    const updated = { ...item, title: next };
    await this.artifacts.update(section.key, updated);
    this.editingId = null;
    this.cdr.markForCheck();
  }

  cancelRename(): void {
    this.editingId = null;
  }

  openContextMenu(event: MouseEvent, section: Section<ArtifactBase>, item: ArtifactBase): void {
    event.preventDefault();
    event.stopPropagation();
    this.contextMenuFor = item.id;
    this.contextMenuKind = section.key;
  }

  closeContextMenu(): void {
    this.contextMenuFor = null;
    this.contextMenuKind = null;
  }

  async duplicateItem(section: Section<ArtifactBase>, item: ArtifactBase): Promise<void> {
    this.closeContextMenu();
    await this.artifacts.duplicate(section.key, item.id, uuidv4());
  }

  async deleteItem(section: Section<ArtifactBase>, item: ArtifactBase): Promise<void> {
    this.closeContextMenu();
    if (!confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
    await this.artifacts.remove(section.key, item.id);
  }

  private makeSection<T extends ArtifactBase>(
    key: Section<T>['key'],
    label: string,
    icon: string,
    create: () => T,
    open: (id: string, title: string) => void,
  ): Section<ArtifactBase> {
    return { key, label, icon, items: [], collapsed: false, create: create as () => ArtifactBase, open };
  }

  private makeLoadTest(): LoadTestArtifact {
    return {
      id: uuidv4(),
      title: 'New load test',
      updatedAt: Date.now(),
      config: { ...DEFAULT_LOAD_CONFIG, targets: [] },
    };
  }

  private makeSuite(): TestSuiteArtifact {
    const s = NEW_TEST_SUITE(uuidv4());
    s.title = 'New test suite';
    return s;
  }

  private makeContract(): ContractTestArtifact {
    const c = NEW_CONTRACT_TEST(uuidv4());
    c.title = 'New contract test';
    return c;
  }

  private makeFlow(): FlowArtifact {
    const f = NEW_FLOW(uuidv4());
    f.title = 'New flow';
    return f;
  }
}
