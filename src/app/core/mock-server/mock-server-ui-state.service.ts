import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ConfirmDialogService } from '@core/ui/confirm-dialog.service';
import { MockServerService } from '@core/mock-server/mock-server.service';
import { Collection, Folder } from '@models/collection';
import { Request as RequestModel } from '@models/request';
import type { MockServerStatus, StandaloneMockEndpoint } from '@models/electron';
import { v4 as uuidv4 } from 'uuid';

export interface MockEndpointEntry {
  request: RequestModel;
  parentLabel: string;
  variantCount: number;
  activeVariantId: string | null;
  isRegistered: boolean;
}

export interface MockEndpointGroup {
  collectionId: string;
  collectionTitle: string;
  entries: MockEndpointEntry[];
}

export type MockSelectionKind = 'request' | 'standalone' | null;

const DEFAULT_STATUS: MockServerStatus = {
  host: '127.0.0.1',
  port: 0,
  status: 'stopped',
  error: null,
  baseUrl: '',
  registered: [],
  standalone: [],
};

/**
 * Shared mock-server UI state: endpoint list + selection. Used by the main
 * {@link MockServerComponent} tab and the activity-bar {@link MockServerEndpointsSidebarComponent}.
 */
@Injectable({ providedIn: 'root' })
export class MockServerUiStateService {
  private collections: Collection[] = [];
  private status: MockServerStatus = DEFAULT_STATUS;

  readonly groups$ = new BehaviorSubject<MockEndpointGroup[]>([]);
  readonly standalones$ = new BehaviorSubject<StandaloneMockEndpoint[]>([]);
  readonly selectionKind$ = new BehaviorSubject<MockSelectionKind>(null);
  readonly selectedRequestId$ = new BehaviorSubject<string | null>(null);
  readonly selectedStandaloneId$ = new BehaviorSubject<string | null>(null);

  constructor(
    private mockServer: MockServerService,
    private confirmDialog: ConfirmDialogService,
  ) {}

  get groupsSnapshot(): MockEndpointGroup[] {
    return this.groups$.value;
  }

  get standalonesSnapshot(): StandaloneMockEndpoint[] {
    return this.standalones$.value;
  }

  get selectionKind(): MockSelectionKind {
    return this.selectionKind$.value;
  }

  get selectedRequestId(): string | null {
    return this.selectedRequestId$.value;
  }

  get selectedStandaloneId(): string | null {
    return this.selectedStandaloneId$.value;
  }

  setCollections(collections: Collection[]): void {
    this.collections = collections || [];
    this.rebuildGroups();
  }

  setStatus(status: MockServerStatus): void {
    this.status = status;
    this.rebuildGroups();
  }

  async refreshStandalonesList(): Promise<void> {
    const list = await this.mockServer.listStandalone();
    const mapped = list.map((e) => ({
      ...e,
      name: typeof e.name === 'string' ? e.name : '',
    }));
    this.standalones$.next(mapped);
  }

  selectRequest(request: RequestModel): void {
    this.selectedRequestId$.next(request.id);
    this.selectionKind$.next('request');
    this.selectedStandaloneId$.next(null);
  }

  selectStandalone(endpoint: StandaloneMockEndpoint): void {
    this.selectedStandaloneId$.next(endpoint.id);
    this.selectionKind$.next('standalone');
    this.selectedRequestId$.next(null);
  }

  clearSelection(): void {
    this.selectionKind$.next(null);
    this.selectedRequestId$.next(null);
    this.selectedStandaloneId$.next(null);
  }

  clearStandaloneSelectionIfDeleted(id: string): void {
    if (this.selectedStandaloneId$.value === id) {
      this.clearSelection();
    }
  }

  /** Restore selection from persisted session (ids only; no request objects). */
  applySelectionFromSession(
    kind: MockSelectionKind,
    requestId: string | null,
    standaloneId: string | null,
  ): void {
    this.selectionKind$.next(kind);
    this.selectedRequestId$.next(requestId);
    this.selectedStandaloneId$.next(standaloneId);
  }

  async addStandalone(): Promise<void> {
    const standalones = this.standalones$.value;
    const used = new Set(standalones.map((s) => s.path));
    let path = '/mock/new';
    let n = 1;
    while (used.has(path)) {
      n += 1;
      path = `/mock/new-${n}`;
    }
    const variantId = uuidv4();
    const created = await this.mockServer.registerStandalone({
      name: '',
      method: 'GET',
      path,
      variants: [
        {
          id: variantId,
          name: 'Default',
          statusCode: 200,
          headers: [{ key: 'Content-Type', value: 'application/json' }],
          body: '{\n  "ok": true\n}',
          delayMs: 0,
        },
      ],
      activeVariantId: variantId,
    });
    await this.refreshStandalonesList();
    if (created) {
      this.selectStandalone(created);
    }
  }

  async removeStandalone(endpoint: StandaloneMockEndpoint): Promise<void> {
    const label = endpoint.name?.trim() || `${endpoint.method} ${endpoint.path}`;
    const ok = await this.confirmDialog.confirm({
      title: 'Delete mock',
      message: `Delete standalone mock “${label}”?`,
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    await this.mockServer.unregisterStandalone(endpoint.id);
    this.clearStandaloneSelectionIfDeleted(endpoint.id);
    await this.refreshStandalonesList();
  }

  private rebuildGroups(): void {
    const registeredIds = new Set(this.status.registered.map((r) => r.requestId));
    const groups: MockEndpointGroup[] = [];
    for (const collection of this.collections) {
      const entries: MockEndpointEntry[] = [];
      const walk = (node: Collection | Folder, parentPath: string) => {
        for (const req of node.requests || []) {
          const variantCount = req.mockVariants?.length || 0;
          if (variantCount === 0 && !registeredIds.has(req.id)) continue;
          entries.push({
            request: req,
            parentLabel: parentPath || collection.title,
            variantCount,
            activeVariantId: req.activeMockVariantId || null,
            isRegistered: registeredIds.has(req.id),
          });
        }
        for (const folder of node.folders || []) {
          const next = parentPath ? `${parentPath} / ${folder.title}` : folder.title;
          walk(folder, next);
        }
      };
      walk(collection, '');
      if (entries.length > 0) {
        groups.push({
          collectionId: collection.id,
          collectionTitle: collection.title,
          entries,
        });
      }
    }
    this.groups$.next(groups);
  }
}
