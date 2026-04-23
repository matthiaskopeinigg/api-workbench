import { ChangeDetectionStrategy, ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { v4 as uuidv4 } from 'uuid';
import { Subject, takeUntil } from 'rxjs';
import { Collection, Folder } from '@models/collection';
import { HttpMethod, Request } from '@models/request';
import { CollectionService } from '@core/collection/collection.service';
import { SessionService } from '@core/session/session.service';
import { ViewStateService } from '@core/session/view-state.service';
import { RequestService } from '@core/http/request.service';
import { TabItem, TabService, TabType } from '@core/tabs/tab.service';
import { SettingsService } from '@core/settings/settings.service';
import { ImportService } from '@core/import-pipeline/import.service';
import { RunnerDialogService } from '@core/testing/runner-dialog.service';
import { FormsModule } from '@angular/forms';

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

  activeMenu: string | null = null;
  activeFolderMenu: string | null = null;
  activeRequestMenu: string | null = null;

  editingCollectionId: string | null = null;
  editingFolderId: string | null = null;
  editingRequestId: string | null = null;

  menuPositions: Record<string, { top: string; left: string }> = {};
  HttpMethod = HttpMethod;
  searchTerm = '';
  filteredCollections: Collection[] = [];

  private destroy$ = new Subject<void>();

  constructor(
    private collectionService: CollectionService,
    private sessionService: SessionService,
    private requestService: RequestService,
    private tabService: TabService,
    private settingsService: SettingsService,
    private importService: ImportService,
    private runnerDialogService: RunnerDialogService,
    private viewState: ViewStateService,
    private cdr: ChangeDetectorRef
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
      this.selectedRequestId = selectedTab.id;
      this.selectedFolderId = null;
    } else if (selectedTab.type === TabType.FOLDER) {
      this.selectedFolderId = selectedTab.id;
      this.selectedRequestId = null;
    }
  }

  private async loadListeners() {
    this.requestService.getSelectedRequestAsObservable()
      .pipe(takeUntil(this.destroy$))
      .subscribe(request => {
        if (request) {
          this.selectedRequestId = request.id;
          this.selectedFolderId = null;
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
        } else {
          this.selectedFolderId = null;
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

  updateFilteredCollections() {
    if (!this.searchTerm) {
      this.filteredCollections = this.collections;
    } else {
      const term = this.searchTerm.toLowerCase();
      this.filteredCollections = this.collections.map(c => {
        const filteredRequests = c.requests.filter(r => r.title.toLowerCase().includes(term) || r.url.toLowerCase().includes(term));
        const filteredFolders = this.filterFolders(c.folders, term);

        if (filteredRequests.length > 0 || filteredFolders.length > 0 || c.title.toLowerCase().includes(term)) {
          return {
            ...c,
            requests: filteredRequests,
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
      const filteredSubFolders = this.filterFolders(f.folders, term);

      if (filteredRequests.length > 0 || filteredSubFolders.length > 0 || f.title.toLowerCase().includes(term)) {
        return {
          ...f,
          requests: filteredRequests,
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
    this.destroy$.next();
    this.destroy$.complete();
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

    if (shouldExpand && (folder.folders.length > 0 || folder.requests.length > 0)) {
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

  async selectRequest(request: Request) {
    this.selectedRequestId = request.id;

    const tabItem: TabItem = {
      id: request.id,
      title: request.title,
      type: TabType.REQUEST
    };

    await this.requestService.selectRequest(tabItem);
    this.cdr.markForCheck();
  }

  @HostListener('document:click', ['$event'])
  @HostListener('document:contextmenu', ['$event'])
  closeMenu() {
    this.activeMenu = null;
    this.activeFolderMenu = null;
    this.activeRequestMenu = null;
    this.cdr.markForCheck();
  }

  private toggleMenuState(current: string | null, id: string): string | null {
    return current === id ? null : id;
  }

  toggleMenu(event: MouseEvent, collectionId: string) {
    this.preventEvent(event);
    this.activeMenu = this.toggleMenuState(this.activeMenu, collectionId);
    if (this.activeMenu) {
      this.activeFolderMenu = this.activeRequestMenu = null;
      this.setPosition(collectionId, event);
    }
    this.cdr.markForCheck();
  }

  openMenu(event: MouseEvent, collectionId: string) {
    this.preventEvent(event);
    this.activeMenu = collectionId;
    this.activeFolderMenu = this.activeRequestMenu = null;
    this.setPosition(collectionId, event);
    this.cdr.markForCheck();
  }

  toggleFolderMenu(event: MouseEvent, folderId: string) {
    this.preventEvent(event, false);
    this.activeFolderMenu = this.toggleMenuState(this.activeFolderMenu, folderId);
    if (this.activeFolderMenu) {
      this.activeMenu = this.activeRequestMenu = null;
      this.setPosition(folderId, event);
    }
    this.cdr.markForCheck();
  }

  toggleRequestMenu(event: MouseEvent, requestId: string) {
    this.preventEvent(event, false);
    this.activeRequestMenu = this.toggleMenuState(this.activeRequestMenu, requestId);
    if (this.activeRequestMenu) {
      this.activeMenu = this.activeFolderMenu = null;
      this.setPosition(requestId, event);
    }
    this.cdr.markForCheck();
  }

  activeFolderDepth = 0;

  openFolderMenu(event: MouseEvent, folderId: string) {
    this.preventEvent(event);
    this.activeFolderDepth = this.collectionService.getFolderDepth(folderId);
    this.activeFolderMenu = folderId;
    this.activeMenu = this.activeRequestMenu = null;
    this.setPosition(folderId, event);
    this.cdr.markForCheck();
  }

  openRequestMenu(event: MouseEvent, requestId: string) {
    this.preventEvent(event);
    this.activeRequestMenu = requestId;
    this.activeMenu = this.activeFolderMenu = null;
    this.setPosition(requestId, event);
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

  private async saveCollections() { await this.collectionService.saveCollections(this.collections); }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (target.closest('.menu-button') || target.closest('.request-menu') || target.closest('.folder-menu') || target.closest('.collection-menu')) return;

    this.autoFinishRename('collection', this.editingCollectionId, target);
    this.autoFinishRename('folder', this.editingFolderId, target);
    this.autoFinishRename('request', this.editingRequestId, target);

    this.closeMenu();
  }

  private autoFinishRename(type: 'collection' | 'folder' | 'request', editingId: string | null, target: HTMLElement) {
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
        folders: cloneFolders(f.folders)
      }));
    };

    const clone: Collection = {
      ...original,
      id: uuidv4(),
      title: original.title + ' Copy',
      folders: cloneFolders(original.folders),
      requests: original.requests.map(r => ({ ...r, id: uuidv4() }))
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
    const folder: Folder = { id: uuidv4(), order: maxOrder + 1, title: 'New Folder', folders: [], requests: [] };

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

  async deleteFolder(folderId: string) {
    const folder = this.findFolderById(folderId);

    let requestIds: string[] = [];
    let childFolderIds: string[] = [folderId];

    if (folder) {
      requestIds = this.getAllRequestIdsInFolder(folder);
      childFolderIds = this.getAllFolderIdsRecursive(folder);
    } else {
      const serviceFolder = this.collectionService.findFolderById(folderId);
      if (serviceFolder) {
        requestIds = this.getAllRequestIdsInFolder(serviceFolder);
        childFolderIds = this.getAllFolderIdsRecursive(serviceFolder);
      }
    }

    this.collections.forEach(c => c.folders = this.removeFolderRecursive(c.folders, folderId));
    this.collections = [...this.collections];
    await this.saveCollections();

    requestIds.forEach(id => {
      this.viewState.clearRequestView(id);
      this.collectionService.triggerRequestDeleted(id);
    });
    childFolderIds.forEach(id => this.collectionService.triggerFolderDeleted(id));

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

  private getAllRequestIdsInCollection(c: Collection): string[] {
    const ids: string[] = c.requests.map(r => r.id);
    for (const f of c.folders) {
      ids.push(...this.getAllRequestIdsInFolder(f));
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

  async deleteCollection(collectionId: string) {
    const col = this.collections.find(c => c.id === collectionId);
    if (col) {
      for (const id of this.getAllRequestIdsInCollection(col)) {
        this.viewState.clearRequestView(id);
      }
    }
    this.collections = this.collections.filter(c => c.id !== collectionId);
    await this.saveCollections();
    this.closeMenu();
  }

  draggedItem: { id: string; type: 'request' | 'folder' | 'collection'; parentId?: string } | null = null;
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

  onDragStart(event: DragEvent, id: string, type: 'request' | 'folder' | 'collection', parentId?: string) {
    event.stopPropagation();
    this.draggedItem = { id, type, parentId };

    const target = event.target as HTMLElement;
    target.classList.add('dragging');
    document.body.classList.add('aw-dragging');

    let label = type === 'request' ? 'Request' : type === 'folder' ? 'Folder' : 'Collection';
    if (type === 'request') {
      const req = this.findRequestById(id);
      if (req?.title) label = req.title;
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
      const iconSvg = type === 'request'
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`
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

    if (!this.draggedItem) return;

    if (this.isValidDrop(targetId, targetType)) {
      this.dragOverId = targetId;
      this.dragOverDeniedId = null;
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    } else {
      this.dragOverId = null;
      this.dragOverDeniedId = targetId;
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    }
  }

  private isValidDrop(targetId: string, targetType: 'collection' | 'folder'): boolean {
    if (!this.draggedItem) return false;

    const { id, type, parentId } = this.draggedItem;

    if (id === targetId) return false;

    if (type === 'folder') {

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
  }

  async onDrop(event: DragEvent, targetId: string, targetType: 'collection' | 'folder') {
    event.preventDefault();
    event.stopPropagation();
    this.dragOverId = null;
    this.dragOverDeniedId = null;

    if (!this.draggedItem) return;

    if (!this.isValidDrop(targetId, targetType)) {
      this.triggerDeniedAnimation(targetId);
      this.draggedItem = null;
      return;
    }

    this.triggerDropAnimation(targetId);

    const { id, type, parentId } = this.draggedItem; 

    if (parentId === targetId) {
      this.draggedItem = null;
      return;
    }

    const isTargetCollection = targetType === 'collection';

    if (type === 'request') {
      await this.collectionService.moveRequest(id, targetId, isTargetCollection);
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
  }

  onDragEnd(event: DragEvent) {
    this.draggedItem = null;
    this.dragOverId = null;
    this.dragOverDeniedId = null;
    document.body.classList.remove('aw-dragging');
    const target = event.target as HTMLElement;
    if (target && target.classList) {
      target.classList.remove('dragging');
    }
  }
}

