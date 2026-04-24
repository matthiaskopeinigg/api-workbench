import { Injectable } from '@angular/core';
import { Collection, Folder } from '@models/collection';
import { BehaviorSubject, Subject } from 'rxjs';
import { Request } from '@models/request';
import type { WebSocketCollectionEntry } from '@models/websocket';
import { TabItem } from '@core/tabs/tab.service';
import { pruneEmptyKv } from '@core/utils/kv-utils';

/** Pass as `beforeId` to `moveRequestOrWebSocketBeforeInMixedOrder` to insert at the end of the merged leaf list. */
export const MIXED_LEAF_ORDER_APPEND_SENTINEL = '__aw_append_leaf_order__';

@Injectable({
  providedIn: 'root',
})
export class CollectionService {

  private collectionsSubject = new BehaviorSubject<Collection[]>([]);
  private requestMap = new Map<string, Request>();
  private websocketRequestMap = new Map<string, WebSocketCollectionEntry>();
  private folderMap = new Map<string, Folder>();
  private parentMap = new Map<string, Folder | Collection>(); 

  private createNewCollectionSubject = new Subject<void>();
  private requestDeletedSubject = new Subject<string>();
  private websocketEntryDeletedSubject = new Subject<string>();
  private websocketEntryUpdatedSubject = new Subject<WebSocketCollectionEntry>();
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

  triggerWebSocketEntryDeleted(id: string) {
    this.websocketEntryDeletedSubject.next(id);
  }

  getWebSocketEntryDeletedObservable() {
    return this.websocketEntryDeletedSubject.asObservable();
  }

  triggerWebSocketEntryUpdated(entry: WebSocketCollectionEntry) {
    this.websocketEntryUpdatedSubject.next(entry);
  }

  getWebSocketEntryUpdatedObservable() {
    return this.websocketEntryUpdatedSubject.asObservable();
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
          websocketRequests: [],
          folders: []
        };
      } else {
        root = result[0];
        if (result.length > 1) {
          for (let i = 1; i < result.length; i++) {
            root.folders.push(...result[i].folders);
            root.requests.push(...result[i].requests);
            if (result[i].websocketRequests?.length) {
              root.websocketRequests = [...(root.websocketRequests || []), ...result[i].websocketRequests!];
            }
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
    this.websocketRequestMap.clear();
    this.folderMap.clear();
    this.parentMap.clear();

    const collections = this.collectionsSubject.getValue();

    for (const collection of collections) {
      for (const req of collection.requests) {
        this.requestMap.set(req.id, req);
        this.parentMap.set(req.id, collection);
      }
      for (const ws of collection.websocketRequests || []) {
        this.websocketRequestMap.set(ws.id, ws);
        this.parentMap.set(ws.id, collection);
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
      for (const ws of folder.websocketRequests || []) {
        this.websocketRequestMap.set(ws.id, ws);
        this.parentMap.set(ws.id, folder);
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
      websocketRequests: (c.websocketRequests || []).map((w) => this.sanitizeWebsocketEntry(w)),
      folders: this.sanitizeFolders(c.folders || [])
    }));
  }

  private sanitizeFolders(folders: Folder[]): Folder[] {
    return folders.map(f => ({
      ...f,
      variables: pruneEmptyKv(f.variables),
      httpHeaders: pruneEmptyKv(f.httpHeaders),
      requests: (f.requests || []).map(r => this.sanitizeRequest(r)),
      websocketRequests: (f.websocketRequests || []).map((w) => this.sanitizeWebsocketEntry(w)),
      folders: this.sanitizeFolders(f.folders || [])
    }));
  }

  private sanitizeWebsocketEntry(w: WebSocketCollectionEntry): WebSocketCollectionEntry {
    return {
      ...w,
      url: (w.url || '').trim(),
      title: (w.title || '').trim() || 'WebSocket',
      protocols: w.protocols?.filter((p) => p && String(p).trim()) || [],
      headers: pruneEmptyKv(w.headers || []),
      messageDraft: w.messageDraft ?? '',
    };
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

  findWebSocketRequestById(id: string): WebSocketCollectionEntry | null {
    return this.websocketRequestMap.get(id) || null;
  }

  updateWebSocketRequest(updated: WebSocketCollectionEntry): boolean {
    const original = this.findWebSocketRequestById(updated.id);
    if (original) {
      Object.assign(original, updated);
      this.saveCollections(this.getCollections());
      this.triggerWebSocketEntryUpdated(original);
      return true;
    }
    return false;
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

  async moveWebSocketRequest(entryId: string, targetId: string, isTargetCollection: boolean): Promise<void> {
    const entry = this.findWebSocketRequestsAndRemove(entryId);
    if (!entry) {
      console.warn('WebSocket entry not found or failed to remove:', entryId);
      return;
    }
    if (isTargetCollection) {
      const col = this.findCollectionByCollectionId(targetId);
      if (col) {
        if (!col.websocketRequests) col.websocketRequests = [];
        col.websocketRequests.push(entry);
      }
    } else {
      const folder = this.findFolderById(targetId);
      if (folder) {
        if (!folder.websocketRequests) folder.websocketRequests = [];
        folder.websocketRequests.push(entry);
      }
    }
    await this.saveCollections(this.getCollections());
  }

  /**
   * Inserts `requestId` immediately before `beforeRequestId` in the destination parent's `requests` array.
   * If `beforeRequestId` is null, appends. Same-parent reorder or cross-parent move (remove then insert).
   */
  async moveRequestBeforeInParent(
    requestId: string,
    destParentId: string,
    destIsCollection: boolean,
    beforeRequestId: string | null,
  ): Promise<void> {
    const dest = destIsCollection
      ? this.findCollectionByCollectionId(destParentId)
      : this.findFolderById(destParentId);
    if (!dest) return;
    if (beforeRequestId === requestId) return;
    const list = dest.requests;
    const fromIdx = list.findIndex((r) => r.id === requestId);

    if (fromIdx !== -1) {
      let insertAt =
        beforeRequestId === null ? list.length : list.findIndex((r) => r.id === beforeRequestId);
      if (beforeRequestId !== null && insertAt === -1) return;
      const [item] = list.splice(fromIdx, 1);
      if (beforeRequestId !== null && fromIdx < insertAt) insertAt--;
      list.splice(insertAt, 0, item);
    } else {
      const req = this.findRequestsAndRemove(requestId);
      if (!req) return;
      let insertAt =
        beforeRequestId === null ? list.length : list.findIndex((r) => r.id === beforeRequestId);
      if (insertAt < 0) insertAt = list.length;
      list.splice(insertAt, 0, req);
    }
    await this.saveCollections(this.getCollections());
  }

  /**
   * Inserts a WebSocket/SSE entry before `beforeWsId` in the parent's `websocketRequests` list (or append if null).
   */
  async moveWebSocketBeforeInParent(
    wsId: string,
    destParentId: string,
    destIsCollection: boolean,
    beforeWsId: string | null,
  ): Promise<void> {
    const dest = destIsCollection
      ? this.findCollectionByCollectionId(destParentId)
      : this.findFolderById(destParentId);
    if (!dest) return;
    if (beforeWsId === wsId) return;
    if (!dest.websocketRequests) dest.websocketRequests = [];
    const list = dest.websocketRequests;
    const fromIdx = list.findIndex((w) => w.id === wsId);

    if (fromIdx !== -1) {
      let insertAt = beforeWsId === null ? list.length : list.findIndex((w) => w.id === beforeWsId);
      if (beforeWsId !== null && insertAt === -1) return;
      const [item] = list.splice(fromIdx, 1);
      if (beforeWsId !== null && fromIdx < insertAt) insertAt--;
      list.splice(insertAt, 0, item);
    } else {
      const ent = this.findWebSocketRequestsAndRemove(wsId);
      if (!ent) return;
      let insertAt = beforeWsId === null ? list.length : list.findIndex((w) => w.id === beforeWsId);
      if (insertAt < 0) insertAt = list.length;
      list.splice(insertAt, 0, ent);
    }
    await this.saveCollections(this.getCollections());
  }

  /**
   * Merged view of HTTP requests and WebSocket/SSE rows under one folder or collection.
   * When any entry has `order`, sorts by it; otherwise preserves legacy order (all requests, then all WebSockets).
   */
  buildMergedRequestWebSocketLeaves(
    dest: Collection | Folder,
  ): { isWs: boolean; item: Request | WebSocketCollectionEntry }[] {
    const leaves: { isWs: boolean; item: Request | WebSocketCollectionEntry }[] = [
      ...dest.requests.map((item) => ({ isWs: false, item })),
      ...(dest.websocketRequests || []).map((item) => ({ isWs: true, item })),
    ];
    const anyOrder = leaves.some((l) => (l.item as { order?: number }).order != null);
    if (anyOrder) {
      leaves.sort(
        (a, b) =>
          ((a.item as { order?: number }).order ?? 1e9) - ((b.item as { order?: number }).order ?? 1e9),
      );
    }
    return leaves;
  }

  private applyMergedRequestWebSocketLeaves(
    dest: Collection | Folder,
    leaves: { isWs: boolean; item: Request | WebSocketCollectionEntry }[],
  ): void {
    dest.requests = leaves.filter((l) => !l.isWs).map((l) => l.item as Request);
    dest.websocketRequests = leaves.filter((l) => l.isWs).map((l) => l.item as WebSocketCollectionEntry);
  }

  /**
   * Reorders or moves a request/WebSocket relative to any row (request or WebSocket) in the destination parent.
   */
  async moveRequestOrWebSocketBeforeInMixedOrder(
    draggedId: string,
    draggedIsWs: boolean,
    destParentId: string,
    destIsCollection: boolean,
    beforeId: string,
    beforeIsWs: boolean,
  ): Promise<void> {
    const dest = destIsCollection
      ? this.findCollectionByCollectionId(destParentId)
      : this.findFolderById(destParentId);
    if (!dest) return;
    if (draggedId === beforeId && draggedIsWs === beforeIsWs && beforeId !== MIXED_LEAF_ORDER_APPEND_SENTINEL) {
      return;
    }

    const moved = draggedIsWs
      ? this.findWebSocketRequestsAndRemove(draggedId)
      : this.findRequestsAndRemove(draggedId);
    if (!moved) return;

    const merged = this.buildMergedRequestWebSocketLeaves(dest);
    const insertAtEnd = beforeId === MIXED_LEAF_ORDER_APPEND_SENTINEL;
    let insertAt = insertAtEnd
      ? merged.length
      : merged.findIndex((l) => l.item.id === beforeId && l.isWs === beforeIsWs);
    if (!insertAtEnd && insertAt < 0) insertAt = merged.length;
    merged.splice(insertAt, 0, { isWs: draggedIsWs, item: moved });
    merged.forEach((l, i) => {
      (l.item as { order?: number }).order = i;
    });
    this.applyMergedRequestWebSocketLeaves(dest, merged);
    await this.saveCollections(this.getCollections());
  }

  /** Swap a leaf with its neighbour in the merged request/WebSocket list (sidebar menu up/down). */
  async moveSidebarLeafStepInMixedOrder(
    leafId: string,
    leafIsWs: boolean,
    parentId: string,
    parentIsCollection: boolean,
    direction: -1 | 1,
  ): Promise<void> {
    const dest = parentIsCollection
      ? this.findCollectionByCollectionId(parentId)
      : this.findFolderById(parentId);
    if (!dest) return;
    const merged = this.buildMergedRequestWebSocketLeaves(dest);
    const idx = merged.findIndex((l) => l.item.id === leafId && l.isWs === leafIsWs);
    const j = idx + direction;
    if (idx < 0 || j < 0 || j >= merged.length) return;
    const tmp = merged[idx];
    merged[idx] = merged[j];
    merged[j] = tmp;
    merged.forEach((l, i) => {
      (l.item as { order?: number }).order = i;
    });
    this.applyMergedRequestWebSocketLeaves(dest, merged);
    await this.saveCollections(this.getCollections());
  }

  private findWebSocketRequestsAndRemove(id: string): WebSocketCollectionEntry | null {
    const ent = this.websocketRequestMap.get(id);
    if (!ent) return null;
    const parent = this.parentMap.get(id);
    if (parent) {
      const list = parent.websocketRequests || [];
      const idx = list.findIndex((w) => w.id === id);
      if (idx !== -1) list.splice(idx, 1);
    }
    return ent;
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
      websocketRequests: [],
      folders: []
    };
    await this.saveCollections([root]);
  }
}

