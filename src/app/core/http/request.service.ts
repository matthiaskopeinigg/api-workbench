import { Injectable } from '@angular/core';
import { Request } from '@models/request';
import type { IpcHttpRequest } from '@models/ipc-http-request';
import type { IpcHttpResponse } from '@models/ipc-http-response';
import { BehaviorSubject } from 'rxjs';
import { CollectionService } from '@core/collection/collection.service';
import { Folder } from '@models/collection';
import { TabItem } from '@core/tabs/tab.service';
import { Response } from '@models/response';

@Injectable({
  providedIn: 'root',
})
export class RequestService {

  constructor(private collectionService: CollectionService) {
  }

  private selectedRequestSubject = new BehaviorSubject<TabItem | null>(null);

  getSelectedRequestAsObservable() {
    return this.selectedRequestSubject.asObservable();
  }

  findRequestById(requestId: string): Request | null {
    const collections = this.collectionService.getCollections();
    for (const collection of collections) {
      const request = collection.requests.find(req => req.id === requestId);
      if (request) return request;

      const folderRequest = this.findRequestInFolders(collection.folders, requestId);
      if (folderRequest) return folderRequest;
    }

    return null;
  }

  private findRequestInFolders(folders: Folder[], requestId: string): Request | null {
    for (const folder of folders) {
      const request = folder.requests.find(req => req.id === requestId);
      if (request) return request;

      const nestedRequest = this.findRequestInFolders(folder.folders, requestId);
      if (nestedRequest) return nestedRequest;
    }

    return null;
  }

  selectRequest(newRequestTab: TabItem): void {
    this.selectedRequestSubject.next(newRequestTab);
  }

  removeSelectedRequest(): void {
    this.selectedRequestSubject.next(null);
  }

  async sendRequest(request: IpcHttpRequest): Promise<IpcHttpResponse | null> {
    return window.awElectron.httpRequest(request);
  }

  private static readonly RESPONSE_CACHE_MAX = 50;
  private responseCache = new Map<string, Response>();

  cacheResponse(requestId: string, response: Response) {
    if (this.responseCache.has(requestId)) {
      this.responseCache.delete(requestId);
    } else if (this.responseCache.size >= RequestService.RESPONSE_CACHE_MAX) {
      const oldest = this.responseCache.keys().next().value as string | undefined;
      if (oldest !== undefined) {
        this.responseCache.delete(oldest);
      }
    }
    this.responseCache.set(requestId, response);
  }

  getCachedResponse(requestId: string): Response | undefined {
    const cached = this.responseCache.get(requestId);
    if (cached === undefined) {
      return undefined;
    }
    this.responseCache.delete(requestId);
    this.responseCache.set(requestId, cached);
    return cached;
  }
}



