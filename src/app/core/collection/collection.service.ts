import { Injectable } from '@angular/core';
import { Collection, Folder } from '@models/collection';
import { BehaviorSubject, Subject } from 'rxjs';
import { Request } from '@models/request';
import { TabItem } from '@core/tabs/tab.service';
import { pruneEmptyKv } from '@core/utils/kv-utils';

@Injectable({
  providedIn: 'root',
})
export class CollectionService {

  private collectionsSubject = new BehaviorSubject<Collection[]>([]);
  private requestMap = new Map<string, Request>();
  private folderMap = new Map<string, Folder>();
  private parentMap = new Map<string, Folder | Collection>(); 

  private createNewCollectionSubject = new Subject<void>();
  private requestDeletedSubject = new Subject<string>();
  private requestUpdatedSubject = new Subject<Request>();
  private creationPending = false;
  private selectedFolderSubject = new Subject<TabItem>();
  private folderDeletedSubject = new Subject<string>();
  private folderUpdatedSubject = new Subject<Folder>();

  triggerCreateNewCollection() {
    this.creationPending = true;
    this.createNewCollectionSubject.next();
  }

  getCreateNewCollectionObservable() {
    return this.createNewCollectionSubject.asObservable();
  }

  triggerRequestDeleted(requestId: string) {
    this.requestDeletedSubject.next(requestId);
  }

  getRequestDeletedObservable() {
    return this.requestDeletedSubject.asObservable();
  }

  triggerRequestUpdated(request: Request) {
    this.requestUpdatedSubject.next(request);
  }

  getRequestUpdatedObservable() {
    return this.requestUpdatedSubject.asObservable();
  }

  isCreationPending() {
    return this.creationPending;
  }

  setCreationPending(pending: boolean) {
    this.creationPending = pending;
  }

  selectFolder(tab: TabItem) {
    this.selectedFolderSubject.next(tab);
  }

  getSelectedFolderAsObservable() {
    return this.selectedFolderSubject.asObservable();
  }

  triggerFolderDeleted(folderId: string) {
    this.folderDeletedSubject.next(folderId);
  }

  getFolderDeletedObservable() {
    return this.folderDeletedSubject.asObservable();
  }

  triggerFolderUpdated(folder: Folder) {
    this.folderUpdatedSubject.next(folder);
  }

  getFolderUpdatedObservable() {
    return this.folderUpdatedSubject.asObservable();
  }

  async loadCollections(): Promise<void> {
    const current = this.collectionsSubject.getValue();
    if (current.length === 0) {
      const result = await window.awElectron.getCollections();

      let root: Collection;

      if (!result || !Array.isArray(result) || result.length === 0) {
        root = {
          id: 'root',
          order: 0,
          title: 'Root',
          requests: [],
          folders: []
        };
      } else {
        root = result[0];
        if (result.length > 1) {
          for (let i = 1; i < result.length; i++) {
            root.folders.push(...result[i].folders);
            root.requests.push(...result[i].requests);
          }
        }
      }

      this.collectionsSubject.next([root]);
      this.rebuildIndex();

      if (result && result.length > 1) {
        await this.saveCollections(this.collectionsSubject.getValue());
      }
    }
  }

  private rebuildIndex() {
    this.requestMap.clear();
    this.folderMap.clear();
    this.parentMap.clear();

    const collections = this.collectionsSubject.getValue();

    for (const collection of collections) {
      for (const req of collection.requests) {
        this.requestMap.set(req.id, req);
        this.parentMap.set(req.id, collection);
      }
      this.indexFoldersRecursive(collection.folders, collection);
    }
  }

  private indexFoldersRecursive(folders: Folder[], parent: Folder | Collection) {
    for (const folder of folders) {
      this.folderMap.set(folder.id, folder);
      this.parentMap.set(folder.id, parent);

      for (const req of folder.requests) {
        this.requestMap.set(req.id, req);
        this.parentMap.set(req.id, folder);
      }
      this.indexFoldersRecursive(folder.folders, folder);
    }
  }

  getCollections(): Collection[] {
    return this.collectionsSubject.getValue();
  }

  getCollectionsObservable() {
    return this.collectionsSubject.asObservable();
  }

  async saveCollections(collections: Collection[]): Promise<void> {
    this.collectionsSubject.next(collections);
    this.rebuildIndex();
    this.scheduleDebouncedDiskWrite();
  }

  private static readonly SAVE_DEBOUNCE_MS = 300;
  private pendingSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlightSavePromise: Promise<void> | null = null;

  private scheduleDebouncedDiskWrite() {
    if (this.pendingSaveTimer !== null) {
      clearTimeout(this.pendingSaveTimer);
    }
    this.pendingSaveTimer = setTimeout(() => {
      this.pendingSaveTimer = null;
      void this.runDiskWrite();
    }, CollectionService.SAVE_DEBOUNCE_MS);
  }

  private async runDiskWrite(): Promise<void> {
    if (this.inFlightSavePromise) {
      await this.inFlightSavePromise;
    }
    const snapshot = this.sanitizeCollectionsForDisk(this.collectionsSubject.getValue());
    this.inFlightSavePromise = window.awElectron.saveCollections(snapshot)
      .catch(err => {
        console.error('Failed to persist collections', err);
      });
    try {
      await this.inFlightSavePromise;
    } finally {
      this.inFlightSavePromise = null;
    }
  }

  /**
   * Cancel any pending debounce and ensure the most recent in-memory state is
   * written to disk before resolving. Safe to call when nothing is pending.
   */
  async flushPendingSaves(): Promise<void> {
    if (this.pendingSaveTimer !== null) {
      clearTimeout(this.pendingSaveTimer);
      this.pendingSaveTimer = null;
      await this.runDiskWrite();
    } else if (this.inFlightSavePromise) {
      await this.inFlightSavePromise;
    }
  }

  /** Returns a deep-cloned, pruned copy suitable for persistence. */
  private sanitizeCollectionsForDisk(collections: Collection[]): Collection[] {
    return collections.map(c => ({
      ...c,
      requests: (c.requests || []).map(r => this.sanitizeRequest(r)),
      folders: this.sanitizeFolders(c.folders || [])
    }));
  }

  private sanitizeFolders(folders: Folder[]): Folder[] {
    return folders.map(f => ({
      ...f,
      variables: pruneEmptyKv(f.variables),
      httpHeaders: pruneEmptyKv(f.httpHeaders),
      requests: (f.requests || []).map(r => this.sanitizeRequest(r)),
      folders: this.sanitizeFolders(f.folders || [])
    }));
  }

  private sanitizeRequest(r: Request): Request {
    const out: Request = {
      ...r,
      httpHeaders: pruneEmptyKv(r.httpHeaders),
      httpParameters: pruneEmptyKv(r.httpParameters)
    };
    if (out.disabledDefaultHeaders) {
      out.disabledDefaultHeaders = out.disabledDefaultHeaders.filter(h => h && h.trim() !== '');
    }
    return out;
  }

  findCollectionByCollectionId(collectionId: string): Collection | null {
    const collections = this.getCollections();
    return collections.find((col: Collection) => col.id === collectionId) ?? null;
  }

  findCollectionByFolderId(folderId: string): Collection | null {
    const collections = this.getCollections();

    let currentId = folderId;
    while (true) {
      const parent = this.parentMap.get(currentId);
      if (!parent) return null;
      if ('folders' in parent && !('requests' in parent)) {
        if (collections.some((c: Collection) => c.id === (parent as Collection).id)) {
          return parent as Collection;
        }
      }
      if (collections.some((c: Collection) => c.id === (parent as Collection).id)) {
        return parent as Collection;
      }
      currentId = (parent as Folder).id;
      if (!currentId) return null;
    }
  }

  findParentFolderById(folderId: string): Folder | null {
    const parent = this.parentMap.get(folderId);
    if (parent && 'folders' in parent && !this.getCollections().some((c: Collection) => c.id === (parent as Collection).id)) {
      return parent as Folder;
    }
    return null;
  }

  findRequestById(requestId: string): Request | null {
    return this.requestMap.get(requestId) || null;
  }

  updateRequest(updatedRequest: Request): boolean {
    const original = this.findRequestById(updatedRequest.id);
    if (original) {
      Object.assign(original, updatedRequest);
      this.saveCollections(this.getCollections());
      this.triggerRequestUpdated(original);
      return true;
    }
    return false;
  }

  findFolderById(folderId: string): Folder | null {
    return this.folderMap.get(folderId) || null;
  }

  updateFolder(updatedFolder: Folder): boolean {
    const original = this.findFolderById(updatedFolder.id);
    if (original) {
      Object.assign(original, updatedFolder);
      this.saveCollections(this.getCollections());
      this.triggerFolderUpdated(original);
      return true;
    }
    return false;
  }

  async moveRequest(requestId: string, targetId: string, isTargetCollection: boolean): Promise<void> {
    const request = this.findRequestsAndRemove(requestId);
    if (!request) {
      console.warn('Request not found or failed to remove:', requestId);
      return;
    }

    if (isTargetCollection) {
      const col = this.findCollectionByCollectionId(targetId);
      if (col) col.requests.push(request);
    } else {
      const folder = this.findFolderById(targetId);
      if (folder) folder.requests.push(request);
    }

    await this.saveCollections(this.getCollections());
  }

  async moveFolder(folderId: string, targetId: string, isTargetCollection: boolean): Promise<void> {
    if (folderId === targetId) return;

    const folder = this.findFolderAndRemove(folderId);
    if (!folder) {
      console.warn('Folder not found or failed to remove:', folderId);
      return;
    }

    if (isTargetCollection) {
      const col = this.findCollectionByCollectionId(targetId);
      if (col) col.folders.push(folder);
    } else {
      const targetFolder = this.findFolderById(targetId);
      if (targetFolder) {
        if (this.folderExistsRecursive(folder.folders, targetId)) {
          console.warn('Cannot move folder into its own child');
          this.getCollections()[0].folders.push(folder);
        } else {
          targetFolder.folders.push(folder);
        }
      }
    }

    await this.saveCollections(this.getCollections());
  }

  private folderExistsRecursive(folders: Folder[], folderId: string): boolean {
    for (const folder of folders) {
      if (folder.id === folderId) return true;
      if (this.folderExistsRecursive(folder.folders, folderId)) return true;
    }
    return false;
  }

  private findRequestsAndRemove(requestId: string): Request | null {
    const req = this.requestMap.get(requestId);
    if (!req) return null;

    const parent = this.parentMap.get(requestId);
    if (parent) {
      const idx = parent.requests.findIndex((r: Request) => r.id === requestId);
      if (idx !== -1) parent.requests.splice(idx, 1);
    }
    return req;
  }

  private findFolderAndRemove(folderId: string): Folder | null {
    const folder = this.folderMap.get(folderId);
    if (!folder) return null;

    const parent = this.parentMap.get(folderId);
    if (parent) {
      const idx = parent.folders.findIndex((f: Folder) => f.id === folderId);
      if (idx !== -1) parent.folders.splice(idx, 1);
    }
    return folder;
  }

  getParentFolders(id: string): Folder[] {
    const folders: Folder[] = [];
    let currentId = id;

    while (true) {
      const parent = this.parentMap.get(currentId);
      if (!parent || !('folders' in parent) || this.getCollections().some(c => c.id === parent.id)) {
        break;
      }
      folders.push(parent as Folder);
      currentId = (parent as Folder).id;
    }

    return folders;
  }

  getFolderDepth(folderId: string): number {
    const collections = this.getCollections();
    let depth = 0;
    let currentId = folderId;

    while (true) {
      const parent = this.parentMap.get(currentId);
      if (!parent) return depth;

      const isCollection = collections.some((c: Collection) => c.id === (parent as Collection).id);
      if (isCollection) {
        return depth + 1;
      }

      depth++;
      const currentFolder = parent as Folder;
      if (!currentFolder.id) return depth;
      currentId = currentFolder.id;
    }
  }

  async deleteAllCollections(): Promise<void> {
    const root: Collection = {
      id: 'root',
      order: 0,
      title: 'Root',
      requests: [],
      folders: []
    };
    await this.saveCollections([root]);
  }
}

