import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable, Subject, takeUntil } from 'rxjs';
import { distinctUntilChanged, filter } from 'rxjs/operators';
import {
  duplicateRequestTabSurface,
  sanitizeTabForStorage,
  TabItem,
  tabIdForTestArtifact,
  tabPayloadId,
  TabService,
} from '@core/tabs/tab.service';
import {
  type SplitOrientation,
  type WorkspacePaneId,
  type WorkspaceTabsState,
} from '@core/tabs/workspace-tabs.model';
import { WORKBENCH_TAB_DND_MIME } from '@core/tabs/workbench-tab-dnd.mime';
import { TestArtifactService } from '@core/testing/test-artifact.service';
import { ViewStateService } from '@core/session/view-state.service';
import { TabPaneComponent } from './tab-pane/tab-pane.component';
import { EnvironmentsService } from '@core/environments/environments.service';
import { RequestHistoryService } from '@core/http/request-history.service';
import { RequestService } from '@core/http/request.service';
import { CollectionService } from '@core/collection/collection.service';

@Component({
  selector: 'app-tab',
  imports: [CommonModule, TabPaneComponent],
  templateUrl: './tab.component.html',
  styleUrls: ['./tab.component.scss'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabComponent implements OnInit, OnDestroy {
  @Output() tabSizeChange = new EventEmitter<number>();

  private readonly destroy$ = new Subject<void>();

  splitMode = false;
  splitRatio = 0.5;
  splitOrientation: SplitOrientation = 'horizontal';
  /** Enables flex-grow + splitter enter transitions when opening a new split. */
  splitOpening = false;
  /** True while a workbench-tab drag is active (unsplit) — shows wide viewport dock strips. */
  tabStripDragActive = false;
  /** Visual hint for which split edge the pointer is near (unsplit). */
  splitDropHint: 'left' | 'right' | null = null;
  /** Null = use global active environment for that pane. */
  paneEnvironmentIds: { primary: string | null; secondary: string | null } = {
    primary: null,
    secondary: null,
  };
  focusedPane: WorkspacePaneId = 'primary';

  primaryTabs: TabItem[] = [];
  primarySelected = 0;

  secondaryTabs: TabItem[] = [];
  secondarySelected = 0;

  private splitResizeArmed = false;
  private splitMoveHandler?: (e: MouseEvent) => void;
  private splitUpHandler?: () => void;
  private splitOpeningClearHandle?: ReturnType<typeof setTimeout>;

  /**
   * While > 0, `select*` is pushing into BehaviorSubjects; `addNewTabToWorkspace` must ignore
   * "tab already open" replays or we recurse (distinctUntilChanged is not enough if emissions reorder).
   */
  private syncingGlobalSelectionDepth = 0;

  constructor(
    private environmentsService: EnvironmentsService,
    private tabService: TabService,
    private requestHistoryService: RequestHistoryService,
    private requestService: RequestService,
    private collectionService: CollectionService,
    private testArtifacts: TestArtifactService,
    private viewState: ViewStateService,
    private cdr: ChangeDetectorRef,
    private hostRef: ElementRef<HTMLElement>,
  ) {}

  async ngOnInit() {
    await this.viewState.load();
    await this.loadWorkspace();
    this.viewState.retainOnly(this.allOpenTabIds());
    await this.syncGlobalSelection(this.getSelectedTabInPane(this.focusedPane));
    await this.startListeners();
    setTimeout(() => this.cdr.markForCheck(), 0);
  }

  ngOnDestroy() {
    this.teardownSplitResize();
    if (this.splitOpeningClearHandle) {
      clearTimeout(this.splitOpeningClearHandle);
      this.splitOpeningClearHandle = undefined;
    }
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('document:dragend')
  onDocumentDragEnd(): void {
    this.clearWorkbenchTabDragUi();
  }

  @HostListener('document:dragover', ['$event'])
  onDocumentWorkbenchTabDragOver(event: DragEvent): void {
    if (this.splitMode) {
      this.clearWorkbenchTabDragUi();
      return;
    }
    const types = event.dataTransfer?.types;
    if (!types || !Array.from(types).includes(WORKBENCH_TAB_DND_MIME)) {
      this.clearWorkbenchTabDragUi();
      return;
    }
    /** Reorder happens on the strip; do not show split docks / hint (they steal hit-testing). */
    if (this.isPointerOverWorkbenchTabStrip(event.clientX, event.clientY)) {
      let dirty = false;
      if (this.tabStripDragActive) {
        this.tabStripDragActive = false;
        dirty = true;
      }
      if (this.splitDropHint !== null) {
        this.splitDropHint = null;
        dirty = true;
      }
      if (dirty) {
        this.cdr.markForCheck();
      }
      return;
    }
    let dirty = false;
    if (!this.tabStripDragActive) {
      this.tabStripDragActive = true;
      dirty = true;
    }
    const hint = this.computeSplitDropHint(event.clientX, event.clientY);
    if (hint !== this.splitDropHint) {
      this.splitDropHint = hint;
      dirty = true;
    }
    if (dirty) {
      this.cdr.markForCheck();
    }
    if (hint !== null) {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
    }
  }

  @HostListener('window:resize')
  onWindowResize() {
    this.cdr.markForCheck();
  }

  onSplitDockStripDragOver(event: DragEvent, edge: 'left' | 'right'): void {
    const types = event.dataTransfer?.types;
    if (!types || !Array.from(types).includes(WORKBENCH_TAB_DND_MIME)) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    let dirty = false;
    if (!this.tabStripDragActive) {
      this.tabStripDragActive = true;
      dirty = true;
    }
    if (this.splitDropHint !== edge) {
      this.splitDropHint = edge;
      dirty = true;
    }
    if (dirty) {
      this.cdr.markForCheck();
    }
  }

  private isPointerOverWorkbenchTabStrip(clientX: number, clientY: number): boolean {
    try {
      const strips = this.hostRef.nativeElement.querySelectorAll<HTMLElement>('.tabs-container');
      for (let i = 0; i < strips.length; i++) {
        const r = strips[i].getBoundingClientRect();
        const pad = 6;
        if (
          clientX >= r.left - pad &&
          clientX <= r.right + pad &&
          clientY >= r.top - pad &&
          clientY <= r.bottom + pad
        ) {
          return true;
        }
      }
    } catch {
      /* noop */
    }
    return false;
  }

  /**
   * Postman-style: which side of the split the drop targets follows which half of the
   * viewport the pointer is in (wide dock strips still accept drops at the edges).
   */
  private computeSplitDropHint(clientX: number, _clientY: number): 'left' | 'right' | null {
    const w = typeof window !== 'undefined' ? window.innerWidth : 0;
    if (w <= 0) {
      return null;
    }
    const mid = w * 0.5;
    return clientX < mid ? 'left' : 'right';
  }

  private clearWorkbenchTabDragUi(): void {
    const had = this.splitDropHint !== null || this.tabStripDragActive;
    this.splitDropHint = null;
    this.tabStripDragActive = false;
    if (had) {
      this.cdr.markForCheck();
    }
  }

  onUnsplitEdgeDrop(event: DragEvent, edge: 'left' | 'right'): void {
    void this.handleUnsplitEdgeDrop(event, edge);
  }

  private async handleUnsplitEdgeDrop(event: DragEvent, edge: 'left' | 'right'): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    this.clearWorkbenchTabDragUi();
    const raw = event.dataTransfer?.getData(WORKBENCH_TAB_DND_MIME);
    if (!raw) return;
    let data: { paneId: WorkspacePaneId; index: number };
    try {
      data = JSON.parse(raw) as { paneId: WorkspacePaneId; index: number };
    } catch {
      return;
    }
    if (data.paneId !== 'primary') return;
    if (edge === 'left') {
      await this.onSplitLeft('primary', data.index);
    } else {
      await this.onSplitRight('primary', data.index);
    }
  }

  private beginSplitOpeningTransition(): void {
    if (this.splitOpeningClearHandle) {
      clearTimeout(this.splitOpeningClearHandle);
      this.splitOpeningClearHandle = undefined;
    }
    this.splitOpening = true;
    this.splitOpeningClearHandle = setTimeout(() => {
      this.splitOpening = false;
      this.splitOpeningClearHandle = undefined;
      this.cdr.markForCheck();
    }, 420);
  }

  private yieldDoubleRaf(): Promise<void> {
    return new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  }

  private async loadWorkspace() {
    const ws = await this.tabService.getWorkspaceTabsState();
    if (!ws) {
      this.splitMode = false;
      this.splitRatio = 0.5;
      this.splitOrientation = 'horizontal';
      this.paneEnvironmentIds = { primary: null, secondary: null };
      this.primaryTabs = [];
      this.secondaryTabs = [];
      this.primarySelected = 0;
      this.secondarySelected = 0;
      this.emitTabSize();
      return;
    }
    this.splitMode = ws.split;
    this.splitRatio = ws.ratio;
    this.splitOrientation = ws.orientation === 'vertical' ? 'vertical' : 'horizontal';
    this.paneEnvironmentIds = {
      primary: ws.paneEnvironmentIds?.primary ?? null,
      secondary: ws.paneEnvironmentIds?.secondary ?? null,
    };
    this.primaryTabs = [...ws.primary.tabs];
    this.secondaryTabs = [...ws.secondary.tabs];
    this.primarySelected = this.indexFromPaneState(ws.primary);
    this.secondarySelected = this.indexFromPaneState(ws.secondary);
    if (this.splitMode && this.secondaryTabs.length === 0 && this.primaryTabs.length > 0) {
      this.splitMode = false;
    }
    if (this.splitMode && this.primaryTabs.length === 0 && this.secondaryTabs.length > 0) {
      this.primaryTabs = [...this.secondaryTabs];
      this.primarySelected = Math.min(this.secondarySelected, this.primaryTabs.length - 1);
      this.secondaryTabs = [];
      this.secondarySelected = 0;
      this.splitMode = false;
    }
    if (!this.splitMode) {
      this.secondaryTabs = [];
      this.secondarySelected = 0;
    }
    this.focusedPane = 'primary';
    this.emitTabSize();
  }

  private indexFromPaneState(pane: { tabs: TabItem[]; selectedTabId: string | null }): number {
    if (pane.tabs.length === 0) return 0;
    if (!pane.selectedTabId) return 0;
    const i = pane.tabs.findIndex(t => t.id === pane.selectedTabId);
    return i === -1 ? 0 : i;
  }

  private allOpenTabIds(): string[] {
    const ids = new Set<string>();
    for (const t of this.primaryTabs) ids.add(t.id);
    for (const t of this.secondaryTabs) ids.add(t.id);
    return [...ids];
  }

  private emitTabSize() {
    this.tabSizeChange.emit(this.primaryTabs.length + this.secondaryTabs.length);
  }

  private getSelectedTabInPane(pane: WorkspacePaneId): TabItem | null {
    const tabs = pane === 'primary' ? this.primaryTabs : this.secondaryTabs;
    const idx = pane === 'primary' ? this.primarySelected : this.secondarySelected;
    return tabs[idx] ?? null;
  }

  private sortPaneTabs(tabs: TabItem[]): TabItem[] {
    const pinned = tabs.filter(t => t.pinned);
    const unpinned = tabs.filter(t => !t.pinned);
    return [...pinned, ...unpinned];
  }

  private async persistWorkspace() {
    const primarySelId = this.primaryTabs[this.primarySelected]?.id ?? null;
    const secondarySelId = this.secondaryTabs[this.secondarySelected]?.id ?? null;
    const primarySorted = this.sortPaneTabs(this.primaryTabs).map(sanitizeTabForStorage);
    const secondarySorted = this.sortPaneTabs(this.secondaryTabs).map(sanitizeTabForStorage);
    const nextPrimarySelected =
      primarySelId !== null
        ? (() => {
            const i = primarySorted.findIndex(t => t.id === primarySelId);
            return i === -1 ? 0 : i;
          })()
        : 0;
    const nextSecondarySelected =
      secondarySelId !== null
        ? (() => {
            const i = secondarySorted.findIndex(t => t.id === secondarySelId);
            return i === -1 ? 0 : i;
          })()
        : 0;
    this.primaryTabs = primarySorted;
    this.secondaryTabs = secondarySorted;
    this.primarySelected =
      primarySorted.length === 0 ? 0 : nextPrimarySelected >= 0 ? nextPrimarySelected : 0;
    this.secondarySelected =
      secondarySorted.length === 0 ? 0 : nextSecondarySelected >= 0 ? nextSecondarySelected : 0;

    const state: WorkspaceTabsState = {
      split: this.splitMode,
      ratio: Math.min(0.85, Math.max(0.15, this.splitRatio)),
      orientation: this.splitOrientation,
      paneEnvironmentIds: { ...this.paneEnvironmentIds },
      primary: {
        tabs: [...this.primaryTabs],
        selectedTabId: this.primaryTabs[this.primarySelected]?.id ?? null,
      },
      secondary: {
        tabs: [...this.secondaryTabs],
        selectedTabId: this.secondaryTabs[this.secondarySelected]?.id ?? null,
      },
    };
    await this.tabService.saveWorkspaceTabsState(state);
    const sel = this.getSelectedTabInPane(this.focusedPane);
    if (sel) {
      await this.tabService.saveSelectTab(sel);
    } else {
      await this.tabService.saveUnselectTab();
    }
  }

  private async syncGlobalSelection(newSelectedTab: TabItem | null) {
    this.syncingGlobalSelectionDepth++;
    try {
      this.emitTabSize();
      if (!newSelectedTab) {
        await this.tabService.saveUnselectTab();
        await this.requestService.removeSelectedRequest();
        await this.environmentsService.removeSelectedEnvironment();
        await this.requestHistoryService.removeSelectedHistoryEntry();
        this.collectionService.selectFolder(null as any);
        return;
      }

      if (this.tabService.isEnvironmentTab(newSelectedTab)) {
        this.environmentsService.selectEnvironment(newSelectedTab);
      } else {
        this.environmentsService.removeSelectedEnvironment();
      }

      if (this.tabService.isRequestHistoryEntryTab(newSelectedTab)) {
        this.requestHistoryService.selectHistoryEntry(newSelectedTab);
      } else {
        this.requestHistoryService.removeSelectedHistoryEntry();
      }

      if (this.tabService.isRequestTab(newSelectedTab)) {
        this.requestService.selectRequest(newSelectedTab);
      } else {
        this.requestService.removeSelectedRequest();
      }

      if (this.tabService.isFolderTab(newSelectedTab)) {
        this.collectionService.selectFolder(newSelectedTab);
      } else {
        this.collectionService.selectFolder(null as any);
      }

      await this.tabService.saveSelectTab(newSelectedTab);
    } finally {
      this.syncingGlobalSelectionDepth--;
    }
  }

  private async startListeners() {
    /** Dedupe by surface tab id: syncGlobalSelection calls select* which replays BehaviorSubjects and would otherwise recurse. */
    const selectionOpensTab = (source: Observable<TabItem | null>) =>
      source.pipe(
        filter((t: TabItem | null): t is TabItem => t != null),
        distinctUntilChanged((a, b) => a.id === b.id),
        takeUntil(this.destroy$),
      );

    selectionOpensTab(this.environmentsService.getSelectedEnvironmentAsObservable()).subscribe(
      newEnvironmentTab => {
        void this.addNewTabToWorkspace(newEnvironmentTab);
        this.cdr.markForCheck();
      },
    );

    selectionOpensTab(this.requestHistoryService.getSelectedHistoryEntryAsObservable()).subscribe(
      newRequestHistoryEntryTab => {
        void this.addNewTabToWorkspace(newRequestHistoryEntryTab);
        this.cdr.markForCheck();
      },
    );

    selectionOpensTab(this.requestService.getSelectedRequestAsObservable()).subscribe(newRequestTab => {
      void this.addNewTabToWorkspace(newRequestTab);
      this.cdr.markForCheck();
    });

    this.collectionService
      .getSelectedFolderAsObservable()
      .pipe(takeUntil(this.destroy$))
      .subscribe(newFolderTab => {
        if (!newFolderTab) return;
        void this.addNewTabToWorkspace(newFolderTab);
        this.cdr.markForCheck();
      });

    this.tabService
      .getOpenTabAsObservable()
      .pipe(takeUntil(this.destroy$))
      .subscribe(newTab => {
        if (!newTab) return;
        void this.addNewTabToWorkspace(newTab);
        this.cdr.markForCheck();
      });

    this.collectionService
      .getRequestDeletedObservable()
      .pipe(takeUntil(this.destroy$))
      .subscribe(deletedRequestId => {
        void this.removeTabByIdEverywhere(deletedRequestId);
        this.cdr.markForCheck();
      });

    this.collectionService
      .getRequestUpdatedObservable()
      .pipe(takeUntil(this.destroy$))
      .subscribe(updatedRequest => {
        void this.applyTitlePatchEverywhere(updatedRequest.id, updatedRequest.title);
        this.cdr.markForCheck();
      });

    this.collectionService
      .getFolderDeletedObservable()
      .pipe(takeUntil(this.destroy$))
      .subscribe(deletedFolderId => {
        void this.removeTabByIdEverywhere(deletedFolderId);
        this.cdr.markForCheck();
      });

    this.collectionService
      .getFolderUpdatedObservable()
      .pipe(takeUntil(this.destroy$))
      .subscribe(updatedFolder => {
        void this.applyTitlePatchEverywhere(updatedFolder.id, updatedFolder.title);
        this.cdr.markForCheck();
      });

    this.testArtifacts
      .getTestArtifactDeletedObservable()
      .pipe(takeUntil(this.destroy$))
      .subscribe(ev => {
        const tabId = tabIdForTestArtifact(ev.kind, ev.id);
        if (!tabId) return;
        void this.removeTabByIdEverywhere(tabId);
        this.cdr.markForCheck();
      });

    this.environmentsService
      .getEnvironmentDeletedObservable()
      .pipe(takeUntil(this.destroy$))
      .subscribe(environmentId => {
        void this.removeTabByIdEverywhere(environmentId);
        this.cdr.markForCheck();
      });
  }

  private async applyTitlePatchEverywhere(id: string, title: string) {
    let changed = false;
    const patch = (tabs: TabItem[]) => {
      const i = tabs.findIndex(t => tabPayloadId(t) === id);
      if (i !== -1 && tabs[i].title !== title) {
        tabs[i] = { ...tabs[i], title };
        changed = true;
      }
    };
    patch(this.primaryTabs);
    patch(this.secondaryTabs);
    if (changed) {
      this.primaryTabs = [...this.primaryTabs];
      this.secondaryTabs = [...this.secondaryTabs];
      await this.persistWorkspace();
    }
  }

  private tabMatchesEntityClose(t: TabItem, entityId: string): boolean {
    return t.id === entityId || tabPayloadId(t) === entityId;
  }

  private async removeTabByIdEverywhere(id: string) {
    for (;;) {
      const pi = this.primaryTabs.findIndex(t => this.tabMatchesEntityClose(t, id));
      if (pi !== -1) {
        await this.closeTabAt('primary', pi);
        continue;
      }
      const si = this.secondaryTabs.findIndex(t => this.tabMatchesEntityClose(t, id));
      if (si !== -1) {
        await this.closeTabAt('secondary', si);
        continue;
      }
      break;
    }
  }

  private resolveTargetPaneForNewTab(newTab: TabItem): WorkspacePaneId {
    if (newTab.openInPane === 'unfocused' && this.splitMode) {
      return this.focusedPane === 'primary' ? 'secondary' : 'primary';
    }
    return this.focusedPane;
  }

  private normalizeIncomingTab(tab: TabItem): TabItem {
    const next: TabItem = { ...tab };
    delete next.openInPane;
    delete next.dirty;
    return next;
  }

  async addNewTabToWorkspace(newTab: TabItem) {
    const incoming = this.normalizeIncomingTab(newTab);
    const inPrimary = this.primaryTabs.findIndex(t => t.id === incoming.id);
    const inSecondary = this.secondaryTabs.findIndex(t => t.id === incoming.id);
    if (inPrimary !== -1) {
      if (this.syncingGlobalSelectionDepth > 0) {
        return;
      }
      this.focusedPane = 'primary';
      this.primarySelected = inPrimary;
      await this.syncGlobalSelection(this.primaryTabs[inPrimary]);
      await this.persistWorkspace();
      return;
    }
    if (inSecondary !== -1) {
      if (this.syncingGlobalSelectionDepth > 0) {
        return;
      }
      this.focusedPane = 'secondary';
      this.secondarySelected = inSecondary;
      await this.syncGlobalSelection(this.secondaryTabs[inSecondary]);
      await this.persistWorkspace();
      return;
    }

    const pane = this.resolveTargetPaneForNewTab(newTab);
    this.focusedPane = pane;
    if (pane === 'primary') {
      this.primaryTabs = this.sortPaneTabs([...this.primaryTabs, incoming]);
      this.primarySelected = Math.max(0, this.primaryTabs.findIndex(t => t.id === incoming.id));
    } else {
      this.secondaryTabs = this.sortPaneTabs([...this.secondaryTabs, incoming]);
      this.secondarySelected = Math.max(0, this.secondaryTabs.findIndex(t => t.id === incoming.id));
    }
    await this.syncGlobalSelection(incoming);
    await this.persistWorkspace();
    this.cdr.markForCheck();
  }

  onPaneMouseDown(pane: WorkspacePaneId) {
    this.focusedPane = pane;
    void this.syncGlobalSelection(this.getSelectedTabInPane(pane));
    this.cdr.markForCheck();
  }

  onSelectTab(pane: WorkspacePaneId, index: number) {
    this.focusedPane = pane;
    if (pane === 'primary') {
      this.primarySelected = index;
    } else {
      this.secondarySelected = index;
    }
    void this.syncGlobalSelection(this.getSelectedTabInPane(pane));
    this.cdr.markForCheck();
  }

  async onCloseTab(pane: WorkspacePaneId, index: number) {
    await this.closeTabAt(pane, index);
    this.cdr.markForCheck();
  }

  private async closeTabAt(pane: WorkspacePaneId, index: number) {
    const tabs = pane === 'primary' ? this.primaryTabs : this.secondaryTabs;
    const tab = tabs[index];
    if (!tab) return;
    this.viewState.clear(tab.id);

    if (pane === 'primary') {
      const next = [...this.primaryTabs];
      next.splice(index, 1);
      this.primaryTabs = next;
      if (this.primaryTabs.length === 0) {
        this.primarySelected = 0;
      } else if (this.primarySelected > index) {
        this.primarySelected--;
      } else if (this.primarySelected === index) {
        this.primarySelected = Math.max(0, index - 1);
      }
    } else {
      const next = [...this.secondaryTabs];
      next.splice(index, 1);
      this.secondaryTabs = next;
      if (this.secondaryTabs.length === 0) {
        this.secondarySelected = 0;
      } else if (this.secondarySelected > index) {
        this.secondarySelected--;
      } else if (this.secondarySelected === index) {
        this.secondarySelected = Math.max(0, index - 1);
      }
    }

    this.viewState.retainOnly(this.allOpenTabIds());

    const total = this.primaryTabs.length + this.secondaryTabs.length;
    if (total === 0) {
      this.splitMode = false;
      await this.syncGlobalSelection(null);
      await this.persistWorkspace();
      return;
    }

    if (this.splitMode && this.secondaryTabs.length === 0) {
      this.splitMode = false;
    }

    if (this.primaryTabs.length === 0 && this.secondaryTabs.length > 0) {
      this.focusedPane = 'secondary';
    }
    if (this.secondaryTabs.length === 0 && this.primaryTabs.length > 0) {
      this.focusedPane = 'primary';
    }

    await this.syncGlobalSelection(this.getSelectedTabInPane(this.focusedPane));
    await this.persistWorkspace();
  }

  onTabsReorder(pane: WorkspacePaneId, ev: { tabs: TabItem[]; selectedTabIndex: number }) {
    const sorted = this.sortPaneTabs(ev.tabs);
    const selId = ev.tabs[ev.selectedTabIndex]?.id;
    const nextSel = selId ? Math.max(0, sorted.findIndex(t => t.id === selId)) : 0;
    if (pane === 'primary') {
      this.primaryTabs = sorted;
      this.primarySelected = sorted.length === 0 ? 0 : nextSel;
    } else {
      this.secondaryTabs = sorted;
      this.secondarySelected = sorted.length === 0 ? 0 : nextSel;
    }
    this.cdr.markForCheck();
  }

  async onPersistReorder() {
    await this.persistWorkspace();
  }

  async onCloseOtherTabs(pane: WorkspacePaneId, index: number) {
    const tabs = pane === 'primary' ? this.primaryTabs : this.secondaryTabs;
    const keep = tabs[index];
    if (!keep) return;
    const keepIds = new Set<string>([keep.id]);
    for (const t of tabs) {
      if (t.pinned) keepIds.add(t.id);
    }
    const removeIds = tabs.filter(t => !keepIds.has(t.id)).map(t => t.id);
    for (const id of removeIds) {
      this.viewState.clear(id);
    }
    const next = tabs.filter(t => keepIds.has(t.id));
    if (pane === 'primary') {
      this.primaryTabs = this.sortPaneTabs(next);
      this.primarySelected = Math.max(0, this.primaryTabs.findIndex(t => t.id === keep.id));
    } else {
      this.secondaryTabs = this.sortPaneTabs(next);
      this.secondarySelected = Math.max(0, this.secondaryTabs.findIndex(t => t.id === keep.id));
    }
    this.focusedPane = pane;
    this.viewState.retainOnly(this.allOpenTabIds());
    await this.syncGlobalSelection(keep);
    await this.persistWorkspace();
    this.cdr.markForCheck();
  }

  async onCloseTabsToRight(pane: WorkspacePaneId, index: number) {
    const tabs = pane === 'primary' ? [...this.primaryTabs] : [...this.secondaryTabs];
    const removed = tabs.slice(index + 1);
    for (const t of removed) {
      this.viewState.clear(t.id);
    }
    const next = tabs.slice(0, index + 1);
    const wasSel = pane === 'primary' ? this.primarySelected : this.secondarySelected;
    if (pane === 'primary') {
      this.primaryTabs = next;
      if (wasSel > index) {
        this.primarySelected = index;
      }
    } else {
      this.secondaryTabs = next;
      if (wasSel > index) {
        this.secondarySelected = index;
      }
    }
    this.viewState.retainOnly(this.allOpenTabIds());
    await this.syncGlobalSelection(this.getSelectedTabInPane(this.focusedPane));
    await this.persistWorkspace();
    this.cdr.markForCheck();
  }

  async onCloseAllTabsInPane(pane: WorkspacePaneId) {
    const tabs = pane === 'primary' ? this.primaryTabs : this.secondaryTabs;
    for (const t of tabs) {
      this.viewState.clear(t.id);
    }
    if (pane === 'primary') {
      this.primaryTabs = [];
      this.primarySelected = 0;
    } else {
      this.secondaryTabs = [];
      this.secondarySelected = 0;
    }
    if (this.splitMode && this.secondaryTabs.length === 0) {
      this.splitMode = false;
    }
    this.viewState.retainOnly(this.allOpenTabIds());
    const total = this.primaryTabs.length + this.secondaryTabs.length;
    if (total === 0) {
      await this.syncGlobalSelection(null);
    } else {
      if (pane === this.focusedPane) {
        this.focusedPane = this.primaryTabs.length > 0 ? 'primary' : 'secondary';
      }
      await this.syncGlobalSelection(this.getSelectedTabInPane(this.focusedPane));
    }
    await this.persistWorkspace();
    this.cdr.markForCheck();
  }

  async onMergeSplit() {
    if (!this.splitMode) return;
    const seen = new Set<string>();
    const merged: TabItem[] = [];
    for (const t of [...this.primaryTabs, ...this.secondaryTabs]) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        merged.push(t);
      }
    }
    this.primaryTabs = merged;
    const prevSel = this.getSelectedTabInPane(this.focusedPane);
    let nextIdx = prevSel ? merged.findIndex(t => t.id === prevSel.id) : 0;
    if (nextIdx < 0) nextIdx = 0;
    this.primarySelected = merged.length > 0 ? nextIdx : 0;
    this.secondaryTabs = [];
    this.secondarySelected = 0;
    this.splitMode = false;
    this.focusedPane = 'primary';
    this.viewState.retainOnly(this.allOpenTabIds());
    await this.syncGlobalSelection(merged[this.primarySelected] ?? null);
    await this.persistWorkspace();
    this.cdr.markForCheck();
  }

  async onSplitRight(sourcePane: WorkspacePaneId, tabIndex: number) {
    const tabs = sourcePane === 'primary' ? this.primaryTabs : this.secondaryTabs;
    const tab = tabs[tabIndex];
    if (!tab) return;

    if (!this.splitMode) {
      this.splitMode = true;
      /* Start with secondary narrow (splitRatio near 1); animate toward 0.5. */
      this.splitRatio = 0.92;
      if (sourcePane === 'primary') {
        const nextPrimary = this.primaryTabs.filter((_, i) => i !== tabIndex);
        this.primaryTabs = nextPrimary;
        this.primarySelected = nextPrimary.length > 0 ? Math.min(this.primarySelected, nextPrimary.length - 1) : 0;
        this.secondaryTabs = [tab];
        this.secondarySelected = 0;
        this.focusedPane = 'secondary';
      }
      this.beginSplitOpeningTransition();
      await this.syncGlobalSelection(tab);
      this.cdr.markForCheck();
      await this.yieldDoubleRaf();
      this.splitRatio = 0.5;
      this.cdr.markForCheck();
      await this.persistWorkspace();
      this.cdr.markForCheck();
      return;
    }

    if (sourcePane === 'primary') {
      const nextPrimary = [...this.primaryTabs];
      nextPrimary.splice(tabIndex, 1);
      this.primaryTabs = nextPrimary;
      this.primarySelected = nextPrimary.length > 0 ? Math.min(this.primarySelected, nextPrimary.length - 1) : 0;
      const inSec = this.secondaryTabs.findIndex(t => t.id === tab.id);
      if (inSec === -1) {
        this.secondaryTabs = [...this.secondaryTabs, tab];
        this.secondarySelected = this.secondaryTabs.length - 1;
      } else {
        this.secondarySelected = inSec;
      }
      this.focusedPane = 'secondary';
      await this.syncGlobalSelection(tab);
    } else {
      const nextSec = [...this.secondaryTabs];
      nextSec.splice(tabIndex, 1);
      this.secondaryTabs = nextSec;
      this.secondarySelected = nextSec.length > 0 ? Math.min(this.secondarySelected, nextSec.length - 1) : 0;
      const inPri = this.primaryTabs.findIndex(t => t.id === tab.id);
      if (inPri === -1) {
        this.primaryTabs = [...this.primaryTabs, tab];
        this.primarySelected = this.primaryTabs.length - 1;
      } else {
        this.primarySelected = inPri;
      }
      this.focusedPane = 'primary';
      await this.syncGlobalSelection(tab);
    }
    await this.persistWorkspace();
    this.cdr.markForCheck();
  }

  async onSplitLeft(sourcePane: WorkspacePaneId, tabIndex: number) {
    const tabs = sourcePane === 'primary' ? this.primaryTabs : this.secondaryTabs;
    const tab = tabs[tabIndex];
    if (!tab) return;

    if (!this.splitMode) {
      this.splitMode = true;
      this.splitRatio = 0.92;
      const others = this.primaryTabs.filter((_, i) => i !== tabIndex);
      this.primaryTabs = [tab];
      this.primarySelected = 0;
      this.secondaryTabs = others;
      this.secondarySelected = others.length > 0 ? 0 : 0;
      this.focusedPane = 'primary';
      this.beginSplitOpeningTransition();
      await this.syncGlobalSelection(tab);
      this.cdr.markForCheck();
      await this.yieldDoubleRaf();
      this.splitRatio = 0.5;
      this.cdr.markForCheck();
      await this.persistWorkspace();
      this.cdr.markForCheck();
      return;
    }

    if (sourcePane === 'secondary') {
      const nextSec = [...this.secondaryTabs];
      nextSec.splice(tabIndex, 1);
      this.secondaryTabs = nextSec;
      this.secondarySelected = nextSec.length > 0 ? Math.min(this.secondarySelected, nextSec.length - 1) : 0;
      const inPri = this.primaryTabs.findIndex(t => t.id === tab.id);
      if (inPri === -1) {
        this.primaryTabs = [tab, ...this.primaryTabs];
        this.primarySelected = 0;
      } else {
        this.primarySelected = inPri;
      }
      this.focusedPane = 'primary';
      await this.syncGlobalSelection(tab);
    } else {
      const nextPrimary = [...this.primaryTabs];
      nextPrimary.splice(tabIndex, 1);
      this.primaryTabs = [tab];
      this.primarySelected = 0;
      this.secondaryTabs = [...nextPrimary, ...this.secondaryTabs];
      this.secondarySelected = this.secondaryTabs.length > 0 ? 0 : 0;
      this.focusedPane = 'primary';
      await this.syncGlobalSelection(tab);
    }
    await this.persistWorkspace();
    this.cdr.markForCheck();
  }

  onSplitResizeStart(event: MouseEvent) {
    if (!this.splitMode || this.splitResizeArmed) return;
    event.preventDefault();
    this.splitResizeArmed = true;
    const el = this.hostRef.nativeElement;
    const rect = el.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startRatio = this.splitRatio;
    const vertical = this.splitOrientation === 'vertical';

    this.splitMoveHandler = (e: MouseEvent) => {
      if (vertical) {
        const height = rect.height || 1;
        const dy = e.clientY - startY;
        const delta = dy / height;
        this.splitRatio = Math.min(0.85, Math.max(0.15, startRatio + delta));
      } else {
        const width = rect.width || 1;
        const dx = e.clientX - startX;
        const delta = dx / width;
        this.splitRatio = Math.min(0.85, Math.max(0.15, startRatio + delta));
      }
      this.cdr.markForCheck();
    };

    this.splitUpHandler = () => {
      this.teardownSplitResize();
      void this.persistWorkspace();
      this.cdr.markForCheck();
    };

    window.addEventListener('mousemove', this.splitMoveHandler, true);
    window.addEventListener('mouseup', this.splitUpHandler, true);
    window.addEventListener('blur', this.splitUpHandler, true);
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(ev: KeyboardEvent) {
    const el = ev.target as HTMLElement | null;
    if (el?.closest?.('input, textarea, select, [contenteditable="true"]')) {
      return;
    }
    if (ev.ctrlKey && ev.altKey && (ev.key === '1' || ev.key === 'Digit1')) {
      if (!this.splitMode) return;
      ev.preventDefault();
      void this.focusWorkspacePane('primary');
    } else if (ev.ctrlKey && ev.altKey && (ev.key === '2' || ev.key === 'Digit2')) {
      if (!this.splitMode) return;
      ev.preventDefault();
      void this.focusWorkspacePane('secondary');
    } else if (ev.ctrlKey && ev.altKey && ev.key.toLowerCase() === 'o') {
      if (!this.splitMode) return;
      ev.preventDefault();
      this.toggleSplitOrientation();
      void this.persistWorkspace();
      this.cdr.markForCheck();
    }
  }

  private async focusWorkspacePane(pane: WorkspacePaneId) {
    this.focusedPane = pane;
    await this.syncGlobalSelection(this.getSelectedTabInPane(pane));
    this.cdr.markForCheck();
  }

  toggleSplitOrientation() {
    this.splitOrientation = this.splitOrientation === 'horizontal' ? 'vertical' : 'horizontal';
  }

  async onCrossPaneTabMove(ev: { fromPane: WorkspacePaneId; fromIndex: number; toPane: WorkspacePaneId }) {
    if (!this.splitMode || ev.fromPane === ev.toPane) return;
    const fromTabs = ev.fromPane === 'primary' ? this.primaryTabs : this.secondaryTabs;
    const tab = fromTabs[ev.fromIndex];
    if (!tab) return;

    if (ev.fromPane === 'primary') {
      this.primaryTabs = this.primaryTabs.filter((_, i) => i !== ev.fromIndex);
      if (this.primarySelected > ev.fromIndex) this.primarySelected--;
      else if (this.primarySelected === ev.fromIndex) {
        this.primarySelected = Math.max(0, this.primarySelected - 1);
      }
      if (this.primaryTabs.length === 0) this.primarySelected = 0;
    } else {
      this.secondaryTabs = this.secondaryTabs.filter((_, i) => i !== ev.fromIndex);
      if (this.secondarySelected > ev.fromIndex) this.secondarySelected--;
      else if (this.secondarySelected === ev.fromIndex) {
        this.secondarySelected = Math.max(0, this.secondarySelected - 1);
      }
      if (this.secondaryTabs.length === 0) this.secondarySelected = 0;
    }

    if (ev.toPane === 'primary') {
      this.primaryTabs = this.sortPaneTabs([...this.primaryTabs, tab]);
      this.primarySelected = Math.max(0, this.primaryTabs.findIndex(t => t.id === tab.id));
    } else {
      this.secondaryTabs = this.sortPaneTabs([...this.secondaryTabs, tab]);
      this.secondarySelected = Math.max(0, this.secondaryTabs.findIndex(t => t.id === tab.id));
    }

    this.focusedPane = ev.toPane;
    this.viewState.retainOnly(this.allOpenTabIds());
    await this.syncGlobalSelection(tab);
    await this.persistWorkspace();
    this.cdr.markForCheck();
  }

  async onPaneEnvironmentOverride(ev: { paneId: WorkspacePaneId; environmentId: string | null }) {
    this.paneEnvironmentIds = { ...this.paneEnvironmentIds, [ev.paneId]: ev.environmentId };
    await this.persistWorkspace();
    this.cdr.markForCheck();
  }

  onTabDirtyChange(ev: { tabId: string; dirty: boolean }) {
    const patch = (tabs: TabItem[]): TabItem[] | null => {
      const i = tabs.findIndex(t => t.id === ev.tabId);
      if (i === -1) return null;
      if (tabs[i].dirty === ev.dirty) return null;
      const next = [...tabs];
      next[i] = { ...next[i], dirty: ev.dirty };
      return next;
    };
    const p = patch(this.primaryTabs);
    const s = patch(this.secondaryTabs);
    if (p) this.primaryTabs = p;
    if (s) this.secondaryTabs = s;
    if (p || s) {
      this.cdr.markForCheck();
    }
  }

  async onDuplicateRequestTab(pane: WorkspacePaneId, index: number) {
    const tabs = pane === 'primary' ? this.primaryTabs : this.secondaryTabs;
    const tab = tabs[index];
    if (!tab || !this.tabService.isRequestTab(tab)) return;
    const dup = duplicateRequestTabSurface(tab);
    this.focusedPane = pane;
    if (pane === 'primary') {
      this.primaryTabs = this.sortPaneTabs([...this.primaryTabs, dup]);
      this.primarySelected = this.primaryTabs.findIndex(t => t.id === dup.id);
    } else {
      this.secondaryTabs = this.sortPaneTabs([...this.secondaryTabs, dup]);
      this.secondarySelected = this.secondaryTabs.findIndex(t => t.id === dup.id);
    }
    await this.syncGlobalSelection(dup);
    await this.persistWorkspace();
    this.cdr.markForCheck();
  }

  async onPinToggleTab(pane: WorkspacePaneId, index: number) {
    const tabs = pane === 'primary' ? [...this.primaryTabs] : [...this.secondaryTabs];
    const tab = tabs[index];
    if (!tab) return;
    tabs[index] = { ...tab, pinned: !tab.pinned };
    const sorted = this.sortPaneTabs(tabs);
    const selId = tab.id;
    if (pane === 'primary') {
      this.primaryTabs = sorted;
      this.primarySelected = Math.max(0, sorted.findIndex(t => t.id === selId));
    } else {
      this.secondaryTabs = sorted;
      this.secondarySelected = Math.max(0, sorted.findIndex(t => t.id === selId));
    }
    await this.persistWorkspace();
    this.cdr.markForCheck();
  }

  private teardownSplitResize() {
    if (this.splitMoveHandler) {
      window.removeEventListener('mousemove', this.splitMoveHandler, true);
      this.splitMoveHandler = undefined;
    }
    if (this.splitUpHandler) {
      window.removeEventListener('mouseup', this.splitUpHandler, true);
      window.removeEventListener('blur', this.splitUpHandler, true);
      this.splitUpHandler = undefined;
    }
    this.splitResizeArmed = false;
  }

}
