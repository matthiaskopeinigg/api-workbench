import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { v4 as uuidv4 } from 'uuid';
import { Subject, takeUntil } from 'rxjs';
import { Collection, Folder } from '@models/collection';
import { AuthType, HttpMethod, Request } from '@models/request';
import type { WebSocketCollectionEntry } from '@models/websocket';
import { CollectionService, MIXED_LEAF_ORDER_APPEND_SENTINEL } from '@core/collection/collection.service';
import { CollectionWebSocketTabService } from '@core/collection/collection-websocket-tab.service';
import { SessionService } from '@core/session/session.service';
import { ViewStateService } from '@core/session/view-state.service';
import { RequestService } from '@core/http/request.service';
import { TabItem, tabPayloadId, TabService, TabType } from '@core/tabs/tab.service';
import { SettingsService } from '@core/settings/settings.service';
import { ImportService } from '@core/import-pipeline/import.service';
import { RunnerDialogService } from '@core/testing/runner-dialog.service';
import { ConfirmDialogService } from '@core/ui/confirm-dialog.service';
import { FormsModule } from '@angular/forms';

/** Drop target for reordering request/WebSocket rows (before a row, or at end of leaf list). */
type SidebarMixedLeafDragOver =
  | { mode: 'before'; beforeId: string; beforeKind: 'request' | 'websocket' }
  | { mode: 'append' };

const DEFAULT_HEADERS = [
  { key: 'Content-Type', value: 'application/json', description: '' },
  { key: 'Accept', value: 'application/json', description: '' }
];

@Component({
  selector: 'app-collection',
  templateUrl: './collection.component.html',
  styleUrls: ['./collection.component.scss'],
  imports: [CommonModule, FormsModule],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CollectionComponent implements OnInit, OnDestroy {
  TabType = TabType;

  get root(): Collection | undefined {
    return this.collections[0];
  }

  get isCompact(): boolean {
    return this.settingsService.getSettings().ui?.compactMode ?? false;
  }

  get hideRequestMethod(): boolean {
    return this.settingsService.getSettings().ui?.hideRequestMethod ?? false;
  }

  private COLLECTION_STATE_KEY = 'expandedCollections';
  private FOLDER_STATE_KEY = 'expandedFolders';

  collections: Collection[] = [];

  expandedCollections = new Set<string>();
  expandedFolders = new Set<string>();
  selectedRequestId: string | null = null;
  selectedFolderId: string | null = null;
  selectedWebSocketId: string | null = null;

  activeMenu: string | null = null;
  activeFolderMenu: string | null = null;
  activeRequestMenu: string | null = null;
  activeWebSocketMenu: string | null = null;

  editingCollectionId: string | null = null;
  editingFolderId: string | null = null;
  editingRequestId: string | null = null;
  editingWebSocketId: string | null = null;

  menuPositions: Record<string, { top: string; left: string }> = {};
  HttpMethod = HttpMethod;
  searchTerm = '';
  filteredCollections: Collection[] = [];

  private destroy$ = new Subject<void>();

  constructor(
    private collectionService: CollectionService,
    private collectionWebSocketTabService: CollectionWebSocketTabService,
    private sessionService: SessionService,
    private requestService: RequestService,
    private tabService: TabService,
    private settingsService: SettingsService,
    private importService: ImportService,
    private runnerDialogService: RunnerDialogService,
    private viewState: ViewStateService,
    private confirmDialog: ConfirmDialogService,
    private cdr: ChangeDetectorRef,
    private hostRef: ElementRef<HTMLElement>
  ) { }

  /**
   * Context-menu action: open the collection/folder runner for `parentId`. The
   * id maps to either the root collection or a nested folder — we look it up
   * via the existing in-memory maps instead of re-walking the tree.
   */
  runCollectionOrFolder(parentId: string) {
    this.activeMenu = null;
    this.activeFolderMenu = null;
    const collection = this.collections.find(c => c.id === parentId);
    if (collection) {
      this.runnerDialogService.open(collection, collection.title);
      return;
    }
    const folder = this.collectionService.findFolderById(parentId);
    if (folder) {
      this.runnerDialogService.open(folder, folder.title);
    }
  }

  async ngOnInit() {
    this.collectionService.getCollectionsObservable()
      .pipe(takeUntil(this.destroy$))
      .subscribe(collections => {
        this.collections = collections;
        this.updateFilteredCollections();
        this.cdr.markForCheck();
      });

    this.loadExpandedState();
    await this.loadSelectedTabState();
    await this.handleCreationRequests();
    await this.loadListeners();
    this.cdr.markForCheck();
  }

  private async loadSelectedTabState() {
    const selectedTab = this.tabService.getSelectedTab();
    if (!selectedTab) return;

    if (selectedTab.type === TabType.REQUEST) {
      this.selectedRequestId = tabPayloadId(selectedTab);
      this.selectedFolderId = null;
      this.selectedWebSocketId = null;
    } else if (selectedTab.type === TabType.FOLDER) {
      this.selectedFolderId = selectedTab.id;
      this.selectedRequestId = null;
      this.selectedWebSocketId = null;
    } else if (selectedTab.type === TabType.WEBSOCKET) {
      this.selectedWebSocketId = selectedTab.id;
      this.selectedRequestId = null;
      this.selectedFolderId = null;
    }
  }

  private async loadListeners() {
    this.requestService.getSelectedRequestAsObservable()
      .pipe(takeUntil(this.destroy$))
      .subscribe(request => {
        if (request) {
          this.selectedRequestId = tabPayloadId(request);
          this.selectedFolderId = null;
          this.selectedWebSocketId = null;
        } else {
          this.selectedRequestId = null;
        }
        this.cdr.markForCheck();
      });

    this.collectionService.getSelectedFolderAsObservable()
      .pipe(takeUntil(this.destroy$))
      .subscribe(folderTab => {
        if (folderTab) {
          this.selectedFolderId = folderTab.id;
          this.selectedRequestId = null;
          this.selectedWebSocketId = null;
        } else {
          this.selectedFolderId = null;
        }
        this.cdr.markForCheck();
      });

    this.collectionWebSocketTabService
      .getSelectedWebSocketTabAsObservable()
      .pipe(takeUntil(this.destroy$))
      .subscribe((wsTab) => {
        if (wsTab) {
          this.selectedWebSocketId = wsTab.id;
          this.selectedRequestId = null;
          this.selectedFolderId = null;
        } else {
          this.selectedWebSocketId = null;
        }
        this.cdr.markForCheck();
      });
  }

  private async handleCreationRequests() {
    if (this.collectionService.isCreationPending()) {
      this.collectionService.setCreationPending(false);
      await this.createCollection();
      this.cdr.markForCheck();
    }

    this.collectionService.getCreateNewCollectionObservable()
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.createCollection();
        this.cdr.markForCheck();
      });
  }

  trackById(index: number, item: any): string {
    return item.id;
  }

  /** Request + WebSocket rows in sidebar order (`order` when set; else requests then WebSockets). */
  orderedLeaves(parent: Collection | Folder): Array<
    { kind: 'request'; item: Request } | { kind: 'websocket'; item: WebSocketCollectionEntry }
  > {
    return this.collectionService.buildMergedRequestWebSocketLeaves(parent).map((l) =>
      l.isWs
        ? { kind: 'websocket' as const, item: l.item as WebSocketCollectionEntry }
        : { kind: 'request' as const, item: l.item as Request },
    );
  }

  trackSidebarLeaf = (
    _i: number,
    row: { kind: 'request'; item: Request } | { kind: 'websocket'; item: WebSocketCollectionEntry },
  ): string => `${row.kind}:${row.item.id}`;

  /** Top half of row = insert before this row; bottom half = insert before next row or append at end. */
  private resolveMixedLeafDropTarget(
    event: DragEvent,
    parent: Collection | Folder,
    rowKind: 'request' | 'websocket',
    rowId: string,
  ): SidebarMixedLeafDragOver | null {
    const leaves = this.orderedLeaves(parent);
    const idx = leaves.findIndex((l) => l.kind === rowKind && l.item.id === rowId);
    if (idx < 0) return null;
    const el = event.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const after = event.clientY >= rect.top + rect.height / 2;
    if (!after) {
      return { mode: 'before', beforeId: rowId, beforeKind: rowKind };
    }
    if (idx < leaves.length - 1) {
      const next = leaves[idx + 1];
      return { mode: 'before', beforeId: next.item.id, beforeKind: next.kind };
    }
    return { mode: 'append' };
  }

  isMixedLeafDragInsertBeforeTarget(kind: 'request' | 'websocket', rowId: string): boolean {
    const o = this.dragOverOrder;
    return o?.mode === 'before' && o.beforeId === rowId && o.beforeKind === kind;
  }

  private isMixedLeafAppendNoop(parent: Collection | Folder): boolean {
    if (!this.draggedItem || (this.draggedItem.type !== 'request' && this.draggedItem.type !== 'websocket')) {
      return false;
    }
    const leaves = this.orderedLeaves(parent);
    if (leaves.length === 0) return true;
    const last = leaves[leaves.length - 1];
    const dragWs = this.draggedItem.type === 'websocket';
    return last.item.id === this.draggedItem.id && (last.kind === 'websocket') === dragWs;
  }

  updateFilteredCollections() {
    if (!this.searchTerm) {
      this.filteredCollections = this.collections;
    } else {
      const term = this.searchTerm.toLowerCase();
      this.filteredCollections = this.collections.map(c => {
        const filteredRequests = c.requests.filter(r => r.title.toLowerCase().includes(term) || r.url.toLowerCase().includes(term));
        const filteredWs = (c.websocketRequests || []).filter(
          (w) => w.title.toLowerCase().includes(term) || (w.url || '').toLowerCase().includes(term),
        );
        const filteredFolders = this.filterFolders(c.folders, term);

        if (
          filteredRequests.length > 0 ||
          filteredWs.length > 0 ||
          filteredFolders.length > 0 ||
          c.title.toLowerCase().includes(term)
        ) {
          return {
            ...c,
            requests: filteredRequests,
            websocketRequests: filteredWs,
            folders: filteredFolders
          };
        }
        return null;
      }).filter(c => c !== null) as Collection[];

      if (this.searchTerm) {
        this.filteredCollections.forEach(c => {
          this.expandedCollections.add(c.id);
          this.expandAllFolders(c.folders);
        });
      }
    }
    this.cdr.markForCheck();
  }

  private filterFolders(folders: Folder[], term: string): Folder[] {
    return folders.map(f => {
      const filteredRequests = f.requests.filter(r => r.title.toLowerCase().includes(term) || r.url.toLowerCase().includes(term));
      const filteredWs = (f.websocketRequests || []).filter(
        (w) => w.title.toLowerCase().includes(term) || (w.url || '').toLowerCase().includes(term),
      );
      const filteredSubFolders = this.filterFolders(f.folders, term);

      if (
        filteredRequests.length > 0 ||
        filteredWs.length > 0 ||
        filteredSubFolders.length > 0 ||
        f.title.toLowerCase().includes(term)
      ) {
        return {
          ...f,
          requests: filteredRequests,
          websocketRequests: filteredWs,
          folders: filteredSubFolders
        };
      }
      return null;
    }).filter(f => f !== null) as Folder[];
  }

  private expandAllFolders(folders: Folder[]) {
    folders.forEach(f => {
      this.expandedFolders.add(f.id);
      this.expandAllFolders(f.folders);
    });
  }

  async importCollection() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event: any) => {
        const content = event.target.result;
        try {
          const collection = this.importService.importPostmanCollection(content);
          this.collections.push(collection);
          this.collections = [...this.collections];
          await this.saveCollections();
          this.updateFilteredCollections();
          this.cdr.markForCheck();
        } catch (err) {
          console.error('Import failed', err);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  async exportCollection(item: any) {
    let collectionToExport: Collection | null = null;
    if (this.isCollection(item)) {
      collectionToExport = item;
    } else {
      collectionToExport = {
        id: uuidv4(),
        title: item.title,
        order: 0,
        requests: item.requests || [item],
        folders: item.folders || []
      };
    }

    if (!collectionToExport) return;

    const content = this.importService.exportCollection(collectionToExport);
    const blob = new Blob([content], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${collectionToExport.title}.postman_collection.json`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  private isCollection(item: any): item is Collection {
    return 'id' in item && 'title' in item && 'requests' in item && 'folders' in item;
  }

  ngOnDestroy() {
    this.abandonSidebarNativeDrag();
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('document:visibilitychange')
  onDocumentVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
      this.abandonSidebarNativeDrag();
    }
  }

  /** Removes `aw-dragging` and any `.dragging` row chrome (safe if drag already ended). */
  private endSidebarNativeDragChrome(): void {
    document.body.classList.remove('aw-dragging');
    const root = this.hostRef?.nativeElement;
    if (!root) return;
    root.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
  }

  /** Clears drag model + UI when the tab is hidden or the component is destroyed. */
  private abandonSidebarNativeDrag(): void {
    this.draggedItem = null;
    this.dragOverOrder = null;
    this.dragOverId = null;
    this.dragOverDeniedId = null;
    this.endSidebarNativeDragChrome();
  }

  private loadExpandedState() {
    const collections = this.sessionService.get<Record<string, boolean>>(this.COLLECTION_STATE_KEY);
    const folders = this.sessionService.get<Record<string, boolean>>(this.FOLDER_STATE_KEY);

    if (collections) this.expandedCollections = new Set(Object.keys(collections).filter(k => collections[k]));
    if (folders) this.expandedFolders = new Set(Object.keys(folders).filter(k => folders[k]));
  }

  private async saveExpandedState() {
    await this.sessionService.save(this.COLLECTION_STATE_KEY, this.toBooleanRecord(this.expandedCollections));
    await this.sessionService.save(this.FOLDER_STATE_KEY, this.toBooleanRecord(this.expandedFolders));
  }

  private toBooleanRecord(set: Set<string>): Record<string, boolean> {
    const record: Record<string, boolean> = {};
    set.forEach(id => record[id] = true);
    return record;
  }

  isExpanded(id: string, type: 'collection' | 'folder' = 'collection'): boolean {
    return type === 'collection' ? this.expandedCollections.has(id) : this.expandedFolders.has(id);
  }

  async toggleCollection(collection: Collection) {
    if (this.editingCollectionId) return;
    if (collection.folders.length === 0 && collection.requests.length === 0) return;

    this.toggleSet(this.expandedCollections, collection.id);
    await this.saveExpandedState();
    this.cdr.markForCheck();
  }

  async toggleFolder(folder: Folder) {
    if (this.editingFolderId) return;
    this.toggleSet(this.expandedFolders, folder.id);
    await this.saveExpandedState();
    this.cdr.markForCheck();
  }

  async onFolderClick(folder: Folder, triggerExpansion = true, forceOpen = false) {
    if (this.editingFolderId) return;

    const settings = this.settingsService.getSettings();
    const behavior = settings.ui?.folderClickBehavior ?? 'both';

    const shouldExpand = (behavior === 'both' || behavior === 'expand') && triggerExpansion;

    if (
      shouldExpand &&
      (folder.folders.length > 0 ||
        folder.requests.length > 0 ||
        (folder.websocketRequests || []).length > 0)
    ) {
      this.toggleSet(this.expandedFolders, folder.id);
      await this.saveExpandedState();
    }

    const shouldOpen = (behavior === 'both' || behavior === 'open') || forceOpen;

    if (shouldOpen) {
      const tabItem: TabItem = {
        id: folder.id,
        title: folder.title,
        type: TabType.FOLDER
      };

      this.collectionService.selectFolder(tabItem);
    }

    this.cdr.markForCheck();
  }

  async openFolderAsTab(folderId: string) {
    this.closeMenu();
    const folder = this.collectionService.findFolderById(folderId);
    if (folder) {
      await this.onFolderClick(folder, false, true);
    }
  }

  private toggleSet(set: Set<string>, id: string) {
    set.has(id) ? set.delete(id) : set.add(id);
  }

  async selectRequest(request: Request, event?: MouseEvent) {
    this.selectedRequestId = request.id;

    const tabItem: TabItem = {
      id: request.id,
      title: request.title,
      type: TabType.REQUEST,
      ...(event?.altKey ? { openInPane: 'unfocused' as const } : {}),
    };

    await this.requestService.selectRequest(tabItem);
    this.cdr.markForCheck();
  }

  async selectWebSocket(ws: WebSocketCollectionEntry, event?: MouseEvent) {
    this.selectedWebSocketId = ws.id;
    const tabItem: TabItem = {
      id: ws.id,
      title: ws.title,
      type: TabType.WEBSOCKET,
      ...(event?.altKey ? { openInPane: 'unfocused' as const } : {}),
    };
    this.collectionWebSocketTabService.selectWebSocketTab(tabItem);
    this.cdr.markForCheck();
  }

  @HostListener('document:click', ['$event'])
  @HostListener('document:contextmenu', ['$event'])
  closeMenu() {
    this.activeMenu = null;
    this.activeFolderMenu = null;
    this.activeRequestMenu = null;
    this.activeWebSocketMenu = null;
    this.cdr.markForCheck();
  }

  private toggleMenuState(current: string | null, id: string): string | null {
    return current === id ? null : id;
  }

  toggleMenu(event: MouseEvent, collectionId: string) {
    this.preventEvent(event);
    this.activeMenu = this.toggleMenuState(this.activeMenu, collectionId);
    if (this.activeMenu) {
      this.activeFolderMenu = this.activeRequestMenu = this.activeWebSocketMenu = null;
      this.setPosition(collectionId, event);
    }
    this.cdr.markForCheck();
  }

  openMenu(event: MouseEvent, collectionId: string) {
    this.preventEvent(event);
    this.activeMenu = collectionId;
    this.activeFolderMenu = this.activeRequestMenu = this.activeWebSocketMenu = null;
    this.setPosition(collectionId, event);
    this.cdr.markForCheck();
  }

  toggleFolderMenu(event: MouseEvent, folderId: string) {
    this.preventEvent(event, false);
    this.activeFolderMenu = this.toggleMenuState(this.activeFolderMenu, folderId);
    if (this.activeFolderMenu) {
      this.activeMenu = this.activeRequestMenu = this.activeWebSocketMenu = null;
      this.setPosition(folderId, event);
    }
    this.cdr.markForCheck();
  }

  toggleRequestMenu(event: MouseEvent, requestId: string) {
    this.preventEvent(event, false);
    this.activeRequestMenu = this.toggleMenuState(this.activeRequestMenu, requestId);
    if (this.activeRequestMenu) {
      this.activeMenu = this.activeFolderMenu = this.activeWebSocketMenu = null;
      this.setPosition(requestId, event);
    }
    this.cdr.markForCheck();
  }

  activeFolderDepth = 0;

  openFolderMenu(event: MouseEvent, folderId: string) {
    this.preventEvent(event);
    this.activeFolderDepth = this.collectionService.getFolderDepth(folderId);
    this.activeFolderMenu = folderId;
    this.activeMenu = this.activeRequestMenu = this.activeWebSocketMenu = null;
    this.setPosition(folderId, event);
    this.cdr.markForCheck();
  }

  openRequestMenu(event: MouseEvent, requestId: string) {
    this.preventEvent(event);
    this.activeRequestMenu = requestId;
    this.activeMenu = this.activeFolderMenu = this.activeWebSocketMenu = null;
    this.setPosition(requestId, event);
    this.cdr.markForCheck();
  }

  toggleWebSocketMenu(event: MouseEvent, wsId: string) {
    this.preventEvent(event, false);
    this.activeWebSocketMenu = this.toggleMenuState(this.activeWebSocketMenu, wsId);
    if (this.activeWebSocketMenu) {
      this.activeMenu = this.activeFolderMenu = this.activeRequestMenu = null;
      this.setPosition(wsId, event);
    }
    this.cdr.markForCheck();
  }

  openWebSocketMenu(event: MouseEvent, wsId: string) {
    this.preventEvent(event);
    this.activeWebSocketMenu = wsId;
    this.activeMenu = this.activeFolderMenu = this.activeRequestMenu = null;
    this.setPosition(wsId, event);
    this.cdr.markForCheck();
  }

  private setPosition(id: string, event: MouseEvent) {
    const x = event.clientX;
    const y = event.clientY;
    this.menuPositions[id] = { top: `${y}px`, left: `${x}px` };
    this.cdr.markForCheck();
  }

  private preventEvent(event: MouseEvent, stopPropagation = true) {
    event.preventDefault();
    if (stopPropagation) event.stopPropagation();
  }

  getMenuPosition(id: string) {
    return this.menuPositions[id] || {};
  }

  startRenameCollection(collectionId: string) {
    this.editingCollectionId = collectionId;
    this.activeMenu = null;
    this.cdr.markForCheck();
  }
  startRenameFolder(folderId: string) {
    this.editingFolderId = folderId;
    this.activeFolderMenu = null;
    this.cdr.markForCheck();
  }
  startRenameRequest(requestId: string) {
    this.editingRequestId = requestId;
    this.activeRequestMenu = null;
    this.cdr.markForCheck();
  }

  startRenameWebSocket(wsId: string) {
    this.editingWebSocketId = wsId;
    this.activeWebSocketMenu = null;
    this.cdr.markForCheck();
  }

  async finishRenameCollection(collection: Collection, newName: string) {
    collection.title = newName;
    this.editingCollectionId = null;
    await this.saveCollections();
    this.cdr.markForCheck();
  }
  async finishRenameFolder(folder: Folder, newName: string) {
    folder.title = newName;
    this.editingFolderId = null;
    this.collectionService.updateFolder(folder);
    this.cdr.markForCheck();
  }
  async finishRenameRequest(request: Request, newName: string) {
    request.title = newName;
    this.editingRequestId = null;
    this.collectionService.updateRequest(request);
    this.cdr.markForCheck();
  }

  async finishRenameWebSocket(ws: WebSocketCollectionEntry, newName: string) {
    const title = (newName || '').trim() || ws.title;
    ws.title = title;
    this.editingWebSocketId = null;
    this.collectionService.updateWebSocketRequest({ ...ws, title });
    this.cdr.markForCheck();
  }

  private async saveCollections() { await this.collectionService.saveCollections(this.collections); }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (
      target.closest('.menu-button') ||
      target.closest('.request-menu') ||
      target.closest('.websocket-menu') ||
      target.closest('.folder-menu') ||
      target.closest('.collection-menu')
    ) {
      return;
    }

    this.autoFinishRename('collection', this.editingCollectionId, target);
    this.autoFinishRename('folder', this.editingFolderId, target);
    this.autoFinishRename('request', this.editingRequestId, target);
    this.autoFinishRename('websocket', this.editingWebSocketId, target);

    this.closeMenu();
  }

  private autoFinishRename(
    type: 'collection' | 'folder' | 'request' | 'websocket',
    editingId: string | null,
    target: HTMLElement,
  ) {
    if (!editingId) return;
    const input = document.querySelector<HTMLInputElement>(`input#${type}-${editingId}`);
    if (input && !input.contains(target)) {
      if (type === 'collection') {
        const col = this.collections.find(c => c.id === editingId);
        if (col) this.finishRenameCollection(col, input.value);
      } else if (type === 'folder') {
        const folder = this.findFolderById(editingId);
        if (folder) this.finishRenameFolder(folder, input.value);
      } else if (type === 'request') {
        const req = this.findRequestById(editingId);
        if (req) this.finishRenameRequest(req, input.value);
      } else if (type === 'websocket') {
        const ws = this.findWebSocketById(editingId);
        if (ws) this.finishRenameWebSocket(ws, input.value);
      }
    }
  }

  findFolderById(folderId: string, folders?: Folder[]): Folder | null {
    const list = folders ?? this.collections.flatMap(c => c.folders);
    for (const f of list) {
      if (f.id === folderId) return f;
      const nested = this.findFolderById(folderId, f.folders);
      if (nested) return nested;
    }
    return null;
  }

  findRequestById(requestId: string): Request | null {
    for (const c of this.collections) {
      const r = c.requests.find(r => r.id === requestId);
      if (r) return r;
      const nested = this.findRequestInFolders(requestId, c.folders);
      if (nested) return nested;
    }
    return null;
  }

  private findRequestInFolders(requestId: string, folders: Folder[]): Request | null {
    for (const f of folders) {
      const r = f.requests.find(r => r.id === requestId);
      if (r) return r;
      const nested = this.findRequestInFolders(requestId, f.folders);
      if (nested) return nested;
    }
    return null;
  }

  findWebSocketById(wsId: string): WebSocketCollectionEntry | null {
    for (const c of this.collections) {
      const w = (c.websocketRequests || []).find((x) => x.id === wsId);
      if (w) return w;
      const nested = this.findWebSocketInFolders(wsId, c.folders);
      if (nested) return nested;
    }
    return null;
  }

  private findWebSocketInFolders(wsId: string, folders: Folder[]): WebSocketCollectionEntry | null {
    for (const f of folders) {
      const w = (f.websocketRequests || []).find((x) => x.id === wsId);
      if (w) return w;
      const nested = this.findWebSocketInFolders(wsId, f.folders);
      if (nested) return nested;
    }
    return null;
  }

  async createRequestAtRoot() {
    if (this.root) {
      await this.createRequest(this.root.id);
    }
  }

  async createFolderAtRoot() {
    if (this.root) {
      await this.createFolder(this.root.id);
    }
  }

  async createCollection() {

    await this.createFolderAtRoot();
  }

  async duplicateCollection(collectionId: string) {
    this.closeMenu();

    const original = this.collectionService.findCollectionByCollectionId(collectionId);
    if (!original) return;

    const cloneFolders = (folders: Folder[]): Folder[] => {
      return folders.map(f => ({
        ...f,
        id: uuidv4(), // new unique folder ID
        requests: f.requests.map(r => ({ ...r, id: uuidv4() })),
        websocketRequests: (f.websocketRequests || []).map((w) => ({ ...w, id: uuidv4() })),
        folders: cloneFolders(f.folders)
      }));
    };

    const clone: Collection = {
      ...original,
      id: uuidv4(),
      title: original.title + ' Copy',
      folders: cloneFolders(original.folders),
      requests: original.requests.map(r => ({ ...r, id: uuidv4() })),
      websocketRequests: (original.websocketRequests || []).map((w) => ({ ...w, id: uuidv4() })),
    };

    this.collections.push(clone);
    this.collections = [...this.collections];
    this.expandedCollections.add(clone.id);
    this.editingCollectionId = clone.id;

    await this.saveCollections();
  }

  async createFolder(parentId: string) {
    this.closeMenu();

    const parentCollection = this.collectionService.findCollectionByCollectionId(parentId);
    const parentFolder = parentCollection ? parentCollection : this.collectionService.findFolderById(parentId);
    if (!parentFolder) return console.warn('Parent not found', parentId);

    const depth = parentCollection ? 0 : this.collectionService.getFolderDepth(parentId);
    if (depth >= 7) return console.warn('Cannot create folder: maximum depth reached');

    const maxOrder = parentFolder.folders.length ? Math.max(...parentFolder.folders.map(f => f.order)) : 0;
    const folder: Folder = {
      id: uuidv4(),
      order: maxOrder + 1,
      title: 'New Folder',
      folders: [],
      requests: [],
      websocketRequests: [],
    };

    parentFolder.folders.push(folder);
    this.editingFolderId = folder.id;
    this.expandedFolders.add(parentId);
    this.expandedFolders.add(folder.id);

    this.collections = [...this.collections];
    await this.saveCollections();
  }

  async createRequest(parentId: string) {

    const request: Request = {
      id: uuidv4(), title: 'New Request', url: '/', httpMethod: HttpMethod.GET, httpHeaders: [...DEFAULT_HEADERS], requestBody: '{}'
      , script: { postRequest: '', preRequest: '' }
    };
    this.closeMenu();

    const inserted = this.insertRequestInFolders(request, parentId) || this.insertRequestInCollections(request, parentId);
    if (!inserted) console.warn('Parent not found for request', parentId);

    console.warn('Parent found for request', parentId);

    this.collections = [...this.collections];
    await this.saveCollections();
  }

  async createWebSocketRequest(parentId: string) {
    const entry: WebSocketCollectionEntry = {
      id: uuidv4(),
      title: 'New WebSocket',
      mode: 'ws',
      url: '',
      protocols: [],
      headers: [],
      messageDraft: '',
      auth: { type: AuthType.NONE },
    };
    this.closeMenu();

    const inserted =
      this.insertWebSocketInFolders(entry, parentId) || this.insertWebSocketInCollections(entry, parentId);
    if (!inserted) console.warn('Parent not found for WebSocket entry', parentId);

    this.collections = [...this.collections];
    await this.saveCollections();
  }

  async duplicateRequest(requestId: string, parentId: string) {
    this.closeMenu();

    const original = this.findRequestById(requestId);
    if (!original) return;

    const newRequest: Request = {
      ...original,
      id: uuidv4(),
      title: original.title + ' Copy'
    };

    const collection = this.collections.find(c => c.id === parentId);
    if (collection) {
      collection.requests.push(newRequest);
      this.expandedCollections.add(collection.id);
    } else {
      const inserted = (folders: Folder[]): boolean => {
        for (const f of folders) {
          if (f.id === parentId) {
            f.requests.push(newRequest);
            this.expandedFolders.add(f.id);
            return true;
          }
          if (inserted(f.folders)) return true;
        }
        return false;
      };
      inserted(this.collections.flatMap(c => c.folders));
    }

    this.editingRequestId = newRequest.id;
    this.collections = [...this.collections];
    await this.collectionService.saveCollections(this.collections);
  }

  async toggleStarred(requestId: string, _parentId: string) {
    this.closeMenu();
    const request = this.findRequestById(requestId);
    if (!request) return;
    request.starred = !request.starred;
    this.collections = [...this.collections];
    await this.collectionService.saveCollections(this.collections);
    this.cdr.markForCheck();
  }

  private insertRequestInCollections(request: Request, collectionId: string): boolean {
    const collection = this.collections.find(c => c.id === collectionId);
    if (collection) { collection.requests.push(request); this.expandedCollections.add(collection.id); return true; }
    return false;
  }

  private insertRequestInFolders(request: Request, parentId: string, folders?: Folder[]): boolean {
    const list = folders ?? this.collections.flatMap(c => c.folders);
    for (const folder of list) {
      if (folder.id === parentId) { folder.requests.push(request); this.expandedFolders.add(folder.id); return true; }
      if (this.insertRequestInFolders(request, parentId, folder.folders)) return true;
    }
    return false;
  }

  private insertWebSocketInCollections(entry: WebSocketCollectionEntry, collectionId: string): boolean {
    const collection = this.collections.find(c => c.id === collectionId);
    if (collection) {
      if (!collection.websocketRequests) collection.websocketRequests = [];
      collection.websocketRequests.push(entry);
      this.expandedCollections.add(collection.id);
      return true;
    }
    return false;
  }

  private insertWebSocketInFolders(entry: WebSocketCollectionEntry, parentId: string, folders?: Folder[]): boolean {
    const list = folders ?? this.collections.flatMap(c => c.folders);
    for (const folder of list) {
      if (folder.id === parentId) {
        if (!folder.websocketRequests) folder.websocketRequests = [];
        folder.websocketRequests.push(entry);
        this.expandedFolders.add(folder.id);
        return true;
      }
      if (this.insertWebSocketInFolders(entry, parentId, folder.folders)) return true;
    }
    return false;
  }

  async duplicateWebSocketEntry(wsId: string, parentId: string) {
    this.closeMenu();

    const original = this.findWebSocketById(wsId);
    if (!original) return;

    const copy: WebSocketCollectionEntry = {
      ...original,
      id: uuidv4(),
      title: original.title + ' Copy',
    };

    const collection = this.collections.find(c => c.id === parentId);
    if (collection) {
      if (!collection.websocketRequests) collection.websocketRequests = [];
      collection.websocketRequests.push(copy);
      this.expandedCollections.add(collection.id);
    } else {
      const inserted = (folders: Folder[]): boolean => {
        for (const f of folders) {
          if (f.id === parentId) {
            if (!f.websocketRequests) f.websocketRequests = [];
            f.websocketRequests.push(copy);
            this.expandedFolders.add(f.id);
            return true;
          }
          if (inserted(f.folders)) return true;
        }
        return false;
      };
      inserted(this.collections.flatMap(c => c.folders));
    }

    this.editingWebSocketId = copy.id;
    this.collections = [...this.collections];
    await this.collectionService.saveCollections(this.collections);
  }

  async deleteFolder(folderId: string) {
    const folder = this.findFolderById(folderId) ?? this.collectionService.findFolderById(folderId);
    if (!folder) {
      this.closeMenu();
      return;
    }
    const label = folder.title || 'this folder';
    const ok = await this.confirmDialog.confirm({
      title: 'Delete folder',
      message: `Delete "${label}" and everything inside it (requests, WebSockets, and subfolders)? This cannot be undone.`,
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (!ok) {
      this.closeMenu();
      return;
    }

    const requestIds = this.getAllRequestIdsInFolder(folder);
    const websocketIds = this.getAllWebSocketIdsInFolder(folder);
    const childFolderIds = this.getAllFolderIdsRecursive(folder);

    this.collections.forEach(c => c.folders = this.removeFolderRecursive(c.folders, folderId));
    this.collections = [...this.collections];
    await this.saveCollections();

    requestIds.forEach(id => {
      this.viewState.clearRequestView(id);
      this.collectionService.triggerRequestDeleted(id);
    });
    websocketIds.forEach((id) => this.collectionService.triggerWebSocketEntryDeleted(id));
    childFolderIds.forEach(id => {
      this.viewState.clearFolderView(id);
      this.collectionService.triggerFolderDeleted(id);
    });

    this.closeMenu();
  }

  private getAllFolderIdsRecursive(folder: Folder): string[] {
    let ids = [folder.id];
    folder.folders.forEach(sub => {
      ids = [...ids, ...this.getAllFolderIdsRecursive(sub)];
    });
    return ids;
  }

  private getAllRequestIdsInFolder(folder: Folder): string[] {
    let ids: string[] = folder.requests.map(r => r.id);
    for (const sub of folder.folders) {
      ids = [...ids, ...this.getAllRequestIdsInFolder(sub)];
    }
    return ids;
  }

  private getAllWebSocketIdsInFolder(folder: Folder): string[] {
    let ids: string[] = (folder.websocketRequests || []).map((w) => w.id);
    for (const sub of folder.folders) {
      ids = [...ids, ...this.getAllWebSocketIdsInFolder(sub)];
    }
    return ids;
  }

  private getAllRequestIdsInCollection(c: Collection): string[] {
    const ids: string[] = c.requests.map(r => r.id);
    for (const f of c.folders) {
      ids.push(...this.getAllRequestIdsInFolder(f));
    }
    return ids;
  }

  private getAllWebSocketIdsInCollection(c: Collection): string[] {
    const ids: string[] = (c.websocketRequests || []).map((w) => w.id);
    for (const f of c.folders) {
      ids.push(...this.getAllWebSocketIdsInFolder(f));
    }
    return ids;
  }

  private removeFolderRecursive(folders: Folder[], folderId: string): Folder[] {
    return folders.filter(f => {
      f.folders = this.removeFolderRecursive(f.folders, folderId);
      return f.id !== folderId;
    });
  }

  async deleteRequest(requestId: string) {
    const req = this.findRequestById(requestId);
    if (!req) {
      this.activeRequestMenu = null;
      return;
    }
    const label = req.title || req.url || 'this request';
    const ok = await this.confirmDialog.confirm({
      title: 'Delete request',
      message: `Delete "${label}"? This cannot be undone.`,
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (!ok) {
      this.activeRequestMenu = null;
      return;
    }

    this.collections.forEach(c => {
      c.requests = c.requests.filter(r => r.id !== requestId);
      this.removeRequestRecursive(c.folders, requestId);
    });

    this.collections = [...this.collections];
    await this.saveCollections();
    this.collectionService.triggerRequestDeleted(requestId);
    this.activeRequestMenu = null;
  }

  private removeRequestRecursive(folders: Folder[], requestId: string) {
    folders.forEach(f => {
      f.requests = f.requests.filter(r => r.id !== requestId);
      this.removeRequestRecursive(f.folders, requestId);
    });
  }

  private removeWebSocketRecursive(folders: Folder[], wsId: string) {
    folders.forEach((f) => {
      f.websocketRequests = (f.websocketRequests || []).filter((w) => w.id !== wsId);
      this.removeWebSocketRecursive(f.folders, wsId);
    });
  }

  async deleteWebSocketEntry(wsId: string) {
    const ws = this.findWebSocketById(wsId);
    if (!ws) {
      this.activeWebSocketMenu = null;
      return;
    }
    const label = ws.title || ws.url || 'this WebSocket';
    const ok = await this.confirmDialog.confirm({
      title: 'Delete WebSocket',
      message: `Delete "${label}"? This cannot be undone.`,
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (!ok) {
      this.activeWebSocketMenu = null;
      return;
    }

    this.collections.forEach((c) => {
      c.websocketRequests = (c.websocketRequests || []).filter((w) => w.id !== wsId);
      this.removeWebSocketRecursive(c.folders, wsId);
    });

    this.collections = [...this.collections];
    await this.saveCollections();
    this.collectionService.triggerWebSocketEntryDeleted(wsId);
    this.activeWebSocketMenu = null;
  }

  async deleteCollection(collectionId: string) {
    const col = this.collections.find(c => c.id === collectionId);
    if (!col) {
      this.closeMenu();
      return;
    }
    const label = col.title || 'this collection';
    const ok = await this.confirmDialog.confirm({
      title: 'Delete collection',
      message: `Delete "${label}" and all folders and saved requests/WebSockets inside? This cannot be undone.`,
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (!ok) {
      this.closeMenu();
      return;
    }

    for (const id of this.getAllRequestIdsInCollection(col)) {
      this.viewState.clearRequestView(id);
      this.collectionService.triggerRequestDeleted(id);
    }
    for (const id of this.getAllWebSocketIdsInCollection(col)) {
      this.collectionService.triggerWebSocketEntryDeleted(id);
    }
    this.collections = this.collections.filter(c => c.id !== collectionId);
    await this.saveCollections();
    this.closeMenu();
  }

  draggedItem: { id: string; type: 'request' | 'websocket' | 'folder' | 'collection'; parentId?: string } | null = null;
  /** Drop target: insert before this row (request or WebSocket) in merged sidebar order. */
  dragOverOrder: SidebarMixedLeafDragOver | null = null;
  dragOverDeniedId: string | null = null;
  dragOverId: string | null = null;
  recentlyDroppedId: string | null = null;
  deniedTargetId: string | null = null;

  private triggerDropAnimation(targetId: string) {
    this.recentlyDroppedId = targetId;
    setTimeout(() => {
      if (this.recentlyDroppedId === targetId) {
        this.recentlyDroppedId = null;
      }
    }, 1000); 
  }

  private triggerDeniedAnimation(targetId: string) {
    this.deniedTargetId = targetId;
    setTimeout(() => {
      if (this.deniedTargetId === targetId) {
        this.deniedTargetId = null;
      }
    }, 500); 
  }

  onDragStart(
    event: DragEvent,
    id: string,
    type: 'request' | 'websocket' | 'folder' | 'collection',
    parentId?: string,
  ) {
    event.stopPropagation();
    this.draggedItem = { id, type, parentId };

    const row = event.currentTarget as HTMLElement | null;
    row?.classList.add('dragging');
    document.body.classList.add('aw-dragging');

    let label =
      type === 'request'
        ? 'Request'
        : type === 'websocket'
          ? 'WebSocket'
          : type === 'folder'
            ? 'Folder'
            : 'Collection';
    if (type === 'request') {
      const req = this.findRequestById(id);
      if (req?.title) label = req.title;
    } else if (type === 'websocket') {
      const ws = this.findWebSocketById(id);
      if (ws?.title) label = ws.title;
    } else if (type === 'folder') {
      const folder = this.findFolderById(id);
      if (folder?.title) label = folder.title;
    }

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', JSON.stringify({ id, type, parentId }));

      const ghost = document.createElement('div');
      ghost.classList.add('aw-drag-ghost');
      ghost.classList.add(`is-${type}`);
      const iconSvg =
        type === 'request'
          ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`
          : type === 'websocket'
            ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"></path></svg>`
            : `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8z"></path></svg>`;
      ghost.innerHTML = `
        <span class="aw-drag-icon">${iconSvg}</span>
        <span class="aw-drag-label">${this.escapeHtml(label)}</span>
      `;
      document.body.appendChild(ghost);
      event.dataTransfer.setDragImage(ghost, 12, 12);
      setTimeout(() => {
        if (ghost.parentNode) document.body.removeChild(ghost);
      }, 0);
    }
  }

  private escapeHtml(input: string): string {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  onDragOver(event: DragEvent, targetId: string, targetType: 'collection' | 'folder') {
    event.preventDefault();
    event.stopPropagation();

    this.dragOverOrder = null;
    if (!this.draggedItem) return;

    if (this.isValidDrop(targetId, targetType, event)) {
      this.dragOverId = targetId;
      this.dragOverDeniedId = null;
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    } else {
      this.dragOverId = null;
      this.dragOverDeniedId = targetId;
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    }
    this.cdr.markForCheck();
  }

  private isValidDrop(targetId: string, targetType: 'collection' | 'folder', event?: DragEvent): boolean {
    if (!this.draggedItem) return false;

    const { id, type, parentId } = this.draggedItem;

    if (id === targetId) return false;

    if (type === 'folder') {
      // Alt or Shift + drop on a sibling reorders only; a normal drop nests into the target (even if siblings).
      if (
        targetType === 'folder' &&
        this.areSameFolderSiblings(id, targetId) &&
        !!(event?.altKey || event?.shiftKey)
      ) {
        return true;
      }

      const folder = this.findFolderById(id);
      if (folder) {
        if (this.isFolderInOffspring(folder.folders, targetId)) {
          return false;
        }

        const targetDepth = targetType === 'collection' ? 0 : this.collectionService.getFolderDepth(targetId);
        const folderSubtreeDepth = this.getFolderSubtreeDepth(folder);

        if (targetDepth + 1 + folderSubtreeDepth > 7) {
          return false;
        }
      }
    } else {

    }

    return true;
  }

  /** Same `folders` array under a collection or parent folder (canonical tree). */
  private areSameFolderSiblings(folderIdA: string, folderIdB: string): boolean {
    const a = this.findFolderListContext(folderIdA);
    const b = this.findFolderListContext(folderIdB);
    return !!(a && b && a.siblings === b.siblings);
  }

  private findFolderListContext(folderId: string): { siblings: Folder[]; index: number } | null {
    for (const col of this.collections) {
      const idx = col.folders.findIndex(f => f.id === folderId);
      if (idx !== -1) {
        return { siblings: col.folders, index: idx };
      }
      const nested = this.findFolderListContextInList(col.folders, folderId);
      if (nested) return nested;
    }
    return null;
  }

  private findFolderListContextInList(folders: Folder[], folderId: string): { siblings: Folder[]; index: number } | null {
    for (const f of folders) {
      const idx = f.folders.findIndex(c => c.id === folderId);
      if (idx !== -1) {
        return { siblings: f.folders, index: idx };
      }
      const nested = this.findFolderListContextInList(f.folders, folderId);
      if (nested) return nested;
    }
    return null;
  }

  /** Move folder at `fromIdx` so it sits immediately before the folder that was at `toIdx` (same `siblings` list). */
  private reorderFolderBeforeTarget(siblings: Folder[], fromIdx: number, toIdx: number): boolean {
    if (fromIdx === toIdx) return false;
    const [item] = siblings.splice(fromIdx, 1);
    let insertAt = toIdx;
    if (fromIdx < toIdx) insertAt--;
    siblings.splice(insertAt, 0, item);
    siblings.forEach((f, i) => { f.order = i; });
    return true;
  }

  canReorderFolderUp(folderId: string): boolean {
    const ctx = this.findFolderListContext(folderId);
    return !!ctx && ctx.index > 0;
  }

  canReorderFolderDown(folderId: string): boolean {
    const ctx = this.findFolderListContext(folderId);
    return !!ctx && ctx.index < ctx.siblings.length - 1;
  }

  async moveFolderUpInList(folderId: string) {
    const ctx = this.findFolderListContext(folderId);
    if (!ctx || ctx.index <= 0) return;
    this.closeMenu();
    if (this.reorderFolderBeforeTarget(ctx.siblings, ctx.index, ctx.index - 1)) {
      await this.saveCollections();
    }
  }

  async moveFolderDownInList(folderId: string) {
    const ctx = this.findFolderListContext(folderId);
    if (!ctx || ctx.index >= ctx.siblings.length - 1) return;
    this.closeMenu();
    const toIdx = ctx.index + 2;
    if (this.reorderFolderBeforeTarget(ctx.siblings, ctx.index, toIdx)) {
      await this.saveCollections();
    }
  }

  private getFolderSubtreeDepth(folder: Folder): number {
    if (!folder.folders.length) return 0;
    return 1 + Math.max(...folder.folders.map(f => this.getFolderSubtreeDepth(f)));
  }

  private isFolderInOffspring(folders: Folder[], targetId: string): boolean {
    for (const f of folders) {
      if (f.id === targetId) return true;
      if (this.isFolderInOffspring(f.folders, targetId)) return true;
    }
    return false;
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();

    this.dragOverId = null;
    this.dragOverDeniedId = null;
    this.dragOverOrder = null;
    this.cdr.markForCheck();
  }

  onDragOverOrderableRow(
    event: DragEvent,
    rowKind: 'request' | 'websocket',
    rowId: string,
    parent: Collection | Folder,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.draggedItem) return;
    if (this.draggedItem.type !== 'request' && this.draggedItem.type !== 'websocket') {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      return;
    }
    const target = this.resolveMixedLeafDropTarget(event, parent, rowKind, rowId);
    if (!target) {
      this.dragOverOrder = null;
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      this.cdr.markForCheck();
      return;
    }
    if (
      target.mode === 'before' &&
      this.draggedItem.id === target.beforeId &&
      (this.draggedItem.type === 'websocket') === (target.beforeKind === 'websocket')
    ) {
      this.dragOverOrder = null;
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      this.cdr.markForCheck();
      return;
    }
    if (target.mode === 'append' && this.isMixedLeafAppendNoop(parent)) {
      this.dragOverOrder = null;
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      this.cdr.markForCheck();
      return;
    }
    this.dragOverOrder = target;
    this.dragOverId = null;
    this.dragOverDeniedId = null;
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.cdr.markForCheck();
  }

  onDragOverLeafTail(event: DragEvent, parent: Collection | Folder): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.draggedItem) return;
    if (this.draggedItem.type !== 'request' && this.draggedItem.type !== 'websocket') {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      return;
    }
    if (this.isMixedLeafAppendNoop(parent)) {
      this.dragOverOrder = null;
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      this.cdr.markForCheck();
      return;
    }
    this.dragOverOrder = { mode: 'append' };
    this.dragOverId = null;
    this.dragOverDeniedId = null;
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.cdr.markForCheck();
  }

  onDragLeaveOrderableRow(event: DragEvent): void {
    event.stopPropagation();
    const related = event.relatedTarget as Node | null;
    const current = event.currentTarget as HTMLElement;
    if (related && current.contains(related)) return;
    this.dragOverOrder = null;
    this.cdr.markForCheck();
  }

  async onDropOrderableRow(
    event: DragEvent,
    rowKind: 'request' | 'websocket',
    rowId: string,
    parent: Collection | Folder,
    parentType: 'collection' | 'folder',
  ): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const orderTarget =
      this.dragOverOrder ?? this.resolveMixedLeafDropTarget(event, parent, rowKind, rowId);
    this.dragOverOrder = null;
    this.dragOverId = null;
    this.dragOverDeniedId = null;
    if (!this.draggedItem || (this.draggedItem.type !== 'request' && this.draggedItem.type !== 'websocket')) {
      this.endSidebarNativeDragChrome();
      return;
    }
    const draggedId = this.draggedItem.id;
    const draggedIsWs = this.draggedItem.type === 'websocket';
    if (!orderTarget) {
      this.draggedItem = null;
      this.endSidebarNativeDragChrome();
      this.cdr.markForCheck();
      return;
    }
    if (
      orderTarget.mode === 'before' &&
      draggedId === orderTarget.beforeId &&
      draggedIsWs === (orderTarget.beforeKind === 'websocket')
    ) {
      this.draggedItem = null;
      this.endSidebarNativeDragChrome();
      this.cdr.markForCheck();
      return;
    }
    if (orderTarget.mode === 'append' && this.isMixedLeafAppendNoop(parent)) {
      this.draggedItem = null;
      this.endSidebarNativeDragChrome();
      this.cdr.markForCheck();
      return;
    }
    const parentId = parent.id;
    try {
      this.triggerDropAnimation(orderTarget.mode === 'before' ? orderTarget.beforeId : parentId);
      const isCol = parentType === 'collection';
      if (orderTarget.mode === 'append') {
        await this.collectionService.moveRequestOrWebSocketBeforeInMixedOrder(
          draggedId,
          draggedIsWs,
          parentId,
          isCol,
          MIXED_LEAF_ORDER_APPEND_SENTINEL,
          false,
        );
      } else {
        await this.collectionService.moveRequestOrWebSocketBeforeInMixedOrder(
          draggedId,
          draggedIsWs,
          parentId,
          isCol,
          orderTarget.beforeId,
          orderTarget.beforeKind === 'websocket',
        );
      }
      this.collections = this.collectionService.getCollections();
    } finally {
      this.draggedItem = null;
      this.endSidebarNativeDragChrome();
      this.cdr.markForCheck();
    }
  }

  async onDropLeafTail(event: DragEvent, parent: Collection | Folder, parentType: 'collection' | 'folder'): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    this.dragOverOrder = null;
    this.dragOverId = null;
    this.dragOverDeniedId = null;
    if (!this.draggedItem || (this.draggedItem.type !== 'request' && this.draggedItem.type !== 'websocket')) {
      this.endSidebarNativeDragChrome();
      return;
    }
    if (this.isMixedLeafAppendNoop(parent)) {
      this.draggedItem = null;
      this.endSidebarNativeDragChrome();
      this.cdr.markForCheck();
      return;
    }
    const draggedId = this.draggedItem.id;
    const draggedIsWs = this.draggedItem.type === 'websocket';
    const parentId = parent.id;
    try {
      this.triggerDropAnimation(parentId);
      const isCol = parentType === 'collection';
      await this.collectionService.moveRequestOrWebSocketBeforeInMixedOrder(
        draggedId,
        draggedIsWs,
        parentId,
        isCol,
        MIXED_LEAF_ORDER_APPEND_SENTINEL,
        false,
      );
      this.collections = this.collectionService.getCollections();
    } finally {
      this.draggedItem = null;
      this.endSidebarNativeDragChrome();
      this.cdr.markForCheck();
    }
  }

  async onDrop(event: DragEvent, targetId: string, targetType: 'collection' | 'folder') {
    event.preventDefault();
    event.stopPropagation();
    this.dragOverOrder = null;
    this.dragOverId = null;
    this.dragOverDeniedId = null;

    if (!this.draggedItem) {
      this.endSidebarNativeDragChrome();
      return;
    }

    try {
      if (!this.isValidDrop(targetId, targetType, event)) {
        this.triggerDeniedAnimation(targetId);
        this.draggedItem = null;
        return;
      }

      this.triggerDropAnimation(targetId);

      const { id, type, parentId } = this.draggedItem;

      if (type === 'folder' && targetType === 'folder' && (event.altKey || event.shiftKey)) {
        const srcCtx = this.findFolderListContext(id);
        const dstCtx = this.findFolderListContext(targetId);
        if (srcCtx && dstCtx && srcCtx.siblings === dstCtx.siblings) {
          if (this.reorderFolderBeforeTarget(srcCtx.siblings, srcCtx.index, dstCtx.index)) {
            await this.saveCollections();
          }
          this.collections = this.collectionService.getCollections();
          this.draggedItem = null;
          return;
        }
      }

      if (parentId === targetId) {
        this.draggedItem = null;
        return;
      }

      const isTargetCollection = targetType === 'collection';

      if (type === 'request') {
        await this.collectionService.moveRequest(id, targetId, isTargetCollection);
      } else if (type === 'websocket') {
        await this.collectionService.moveWebSocketRequest(id, targetId, isTargetCollection);
      } else if (type === 'folder') {
        await this.collectionService.moveFolder(id, targetId, isTargetCollection);
      } else if (type === 'collection' && isTargetCollection) {

        const collections = this.collectionService.getCollections();
        const fromIdx = collections.findIndex(c => c.id === id);
        const toIdx = collections.findIndex(c => c.id === targetId);

        if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
          const item = collections.splice(fromIdx, 1)[0];
          collections.splice(toIdx, 0, item);
          await this.collectionService.saveCollections(collections);
        }
      }

      this.collections = this.collectionService.getCollections();
      this.draggedItem = null;
    } finally {
      this.endSidebarNativeDragChrome();
    }
  }

  onDragEnd(_event: DragEvent) {
    this.draggedItem = null;
    this.dragOverOrder = null;
    this.dragOverId = null;
    this.dragOverDeniedId = null;
    this.endSidebarNativeDragChrome();
    this.cdr.markForCheck();
  }

  private findMixedLeafContextInTree(
    leafId: string,
    leafIsWs: boolean,
  ): { parentId: string; isCollection: boolean; index: number; length: number } | null {
    for (const col of this.collections) {
      const leaves = this.collectionService.buildMergedRequestWebSocketLeaves(col);
      const idx = leaves.findIndex((l) => l.item.id === leafId && l.isWs === leafIsWs);
      if (idx !== -1) {
        return { parentId: col.id, isCollection: true, index: idx, length: leaves.length };
      }
      const nested = this.findMixedLeafContextInFolders(col.folders, leafId, leafIsWs);
      if (nested) return nested;
    }
    return null;
  }

  private findMixedLeafContextInFolders(
    folders: Folder[],
    leafId: string,
    leafIsWs: boolean,
  ): { parentId: string; isCollection: boolean; index: number; length: number } | null {
    for (const f of folders) {
      const leaves = this.collectionService.buildMergedRequestWebSocketLeaves(f);
      const idx = leaves.findIndex((l) => l.item.id === leafId && l.isWs === leafIsWs);
      if (idx !== -1) {
        return { parentId: f.id, isCollection: false, index: idx, length: leaves.length };
      }
      const nested = this.findMixedLeafContextInFolders(f.folders, leafId, leafIsWs);
      if (nested) return nested;
    }
    return null;
  }

  canReorderRequestUp(requestId: string): boolean {
    const ctx = this.findMixedLeafContextInTree(requestId, false);
    return !!ctx && ctx.index > 0;
  }

  canReorderRequestDown(requestId: string): boolean {
    const ctx = this.findMixedLeafContextInTree(requestId, false);
    return !!ctx && ctx.index < ctx.length - 1;
  }

  async moveRequestUpInList(requestId: string): Promise<void> {
    const ctx = this.findMixedLeafContextInTree(requestId, false);
    if (!ctx || ctx.index <= 0) return;
    this.closeMenu();
    await this.collectionService.moveSidebarLeafStepInMixedOrder(
      requestId,
      false,
      ctx.parentId,
      ctx.isCollection,
      -1,
    );
    this.collections = this.collectionService.getCollections();
    this.cdr.markForCheck();
  }

  async moveRequestDownInList(requestId: string): Promise<void> {
    const ctx = this.findMixedLeafContextInTree(requestId, false);
    if (!ctx || ctx.index >= ctx.length - 1) return;
    this.closeMenu();
    await this.collectionService.moveSidebarLeafStepInMixedOrder(
      requestId,
      false,
      ctx.parentId,
      ctx.isCollection,
      1,
    );
    this.collections = this.collectionService.getCollections();
    this.cdr.markForCheck();
  }

  canReorderWebSocketUp(wsId: string): boolean {
    const ctx = this.findMixedLeafContextInTree(wsId, true);
    return !!ctx && ctx.index > 0;
  }

  canReorderWebSocketDown(wsId: string): boolean {
    const ctx = this.findMixedLeafContextInTree(wsId, true);
    return !!ctx && ctx.index < ctx.length - 1;
  }

  async moveWebSocketUpInList(wsId: string): Promise<void> {
    const ctx = this.findMixedLeafContextInTree(wsId, true);
    if (!ctx || ctx.index <= 0) return;
    this.closeMenu();
    await this.collectionService.moveSidebarLeafStepInMixedOrder(
      wsId,
      true,
      ctx.parentId,
      ctx.isCollection,
      -1,
    );
    this.collections = this.collectionService.getCollections();
    this.cdr.markForCheck();
  }

  async moveWebSocketDownInList(wsId: string): Promise<void> {
    const ctx = this.findMixedLeafContextInTree(wsId, true);
    if (!ctx || ctx.index >= ctx.length - 1) return;
    this.closeMenu();
    await this.collectionService.moveSidebarLeafStepInMixedOrder(
      wsId,
      true,
      ctx.parentId,
      ctx.isCollection,
      1,
    );
    this.collections = this.collectionService.getCollections();
    this.cdr.markForCheck();
  }
}

