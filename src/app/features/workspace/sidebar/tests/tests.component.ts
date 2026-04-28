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

import { ConfirmDialogService } from '@core/ui/confirm-dialog.service';
import { TabService } from '@core/tabs/tab.service';
import { TestArtifactService } from '@core/testing/test-artifact.service';
import type { LoadTestArtifact } from '@models/testing/load-test';
import {
  appendEmptyLoadTestProfile,
  appendLoadTestProfileFromTemplate,
  DEFAULT_LOAD_CONFIG,
  ensureLoadTestProfiles,
  findLoadTestProfileTemplateById,
  loadTestProfileCoversTemplate,
  LOAD_TEST_PROFILE_PICKER_EMPTY,
  LOAD_TEST_PROFILE_PICKER_TEMPLATE_PREFIX,
  LOAD_TEST_PROFILE_TEMPLATES,
  type LoadTestProfileTemplate,
} from '@models/testing/load-test';

interface ArtifactBase {
  id: string;
  title: string;
  updatedAt: number;
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
  /** Load tests list (only artifact kind shown in this sidebar). */
  items: ArtifactBase[] = [];

  readonly loadTestTplPrefix = LOAD_TEST_PROFILE_PICKER_TEMPLATE_PREFIX;
  readonly loadTestEmptyVal = LOAD_TEST_PROFILE_PICKER_EMPTY;

  loadTestTemplatesAvailable(item: ArtifactBase): LoadTestProfileTemplate[] {
    const raw = this.artifacts.getById<LoadTestArtifact>('loadTests', item.id);
    if (!raw) {
      return LOAD_TEST_PROFILE_TEMPLATES;
    }
    const a = ensureLoadTestProfiles(JSON.parse(JSON.stringify(raw)) as LoadTestArtifact);
    return LOAD_TEST_PROFILE_TEMPLATES.filter(
      (t) => !(a.profiles || []).some((p) => loadTestProfileCoversTemplate(p, t)),
    );
  }

  editingId: string | null = null;
  editingTitle = '';
  contextMenuFor: string | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private artifacts: TestArtifactService,
    private tabService: TabService,
    private confirmDialog: ConfirmDialogService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.artifacts.loadTests$().pipe(takeUntil(this.destroy$)).subscribe((list) => {
      this.items = list as ArtifactBase[];
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  trackById = (_: number, a: ArtifactBase) => a.id;

  async createNewLoadTest(): Promise<void> {
    const artifact = this.makeLoadTest();
    await this.artifacts.create('loadTests', artifact);
    this.tabService.openLoadTestTab(artifact.id, artifact.title);
    this.editingId = artifact.id;
    this.editingTitle = artifact.title;
    this.cdr.markForCheck();
  }

  async openItem(item: ArtifactBase): Promise<void> {
    this.tabService.openLoadTestTab(item.id, item.title);
  }

  beginRename(item: ArtifactBase): void {
    this.editingId = item.id;
    this.editingTitle = item.title;
    this.contextMenuFor = null;
  }

  async commitRename(item: ArtifactBase): Promise<void> {
    if (this.editingId !== item.id) return;
    const next = (this.editingTitle || '').trim() || item.title;
    if (next === item.title) {
      this.editingId = null;
      return;
    }
    const updated = { ...item, title: next };
    await this.artifacts.update('loadTests', updated);
    this.editingId = null;
    this.cdr.markForCheck();
  }

  cancelRename(): void {
    this.editingId = null;
  }

  openContextMenu(event: MouseEvent, item: ArtifactBase): void {
    event.preventDefault();
    event.stopPropagation();
    this.contextMenuFor = item.id;
  }

  closeContextMenu(): void {
    this.contextMenuFor = null;
  }

  async onAddLoadTestProfile(event: Event, item: ArtifactBase): Promise<void> {
    const sel = event.target as HTMLSelectElement;
    const value = (sel.value || '').trim();
    sel.value = '';
    if (!value) {
      return;
    }
    const raw = this.artifacts.getById<LoadTestArtifact>('loadTests', item.id);
    if (!raw) {
      return;
    }
    const a = JSON.parse(JSON.stringify(raw)) as LoadTestArtifact;
    if (value.startsWith(LOAD_TEST_PROFILE_PICKER_TEMPLATE_PREFIX)) {
      const tid = value.slice(LOAD_TEST_PROFILE_PICKER_TEMPLATE_PREFIX.length);
      const t = findLoadTestProfileTemplateById(tid);
      if (!t) {
        return;
      }
      ensureLoadTestProfiles(a);
      appendLoadTestProfileFromTemplate(a, t);
    } else if (value === LOAD_TEST_PROFILE_PICKER_EMPTY) {
      ensureLoadTestProfiles(a);
      appendEmptyLoadTestProfile(a);
    } else {
      return;
    }
    await this.artifacts.update('loadTests', a);
    this.tabService.openLoadTestTab(a.id, a.title);
    this.cdr.markForCheck();
  }

  async duplicateItem(item: ArtifactBase): Promise<void> {
    this.closeContextMenu();
    await this.artifacts.duplicate('loadTests', item.id, uuidv4());
  }

  async deleteItem(item: ArtifactBase): Promise<void> {
    this.closeContextMenu();
    const ok = await this.confirmDialog.confirm({
      title: 'Delete',
      message: `Delete "${item.title}"? This cannot be undone.`,
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    await this.artifacts.remove('loadTests', item.id);
  }

  private makeLoadTest(): LoadTestArtifact {
    return ensureLoadTestProfiles({
      id: uuidv4(),
      title: 'New load test',
      updatedAt: Date.now(),
      config: { ...DEFAULT_LOAD_CONFIG, targets: [] },
    });
  }
}
