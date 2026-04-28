import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, combineLatest, takeUntil } from 'rxjs';

import { HttpMethod, Request as RequestModel } from '@models/request';
import type { StandaloneMockEndpoint } from '@models/electron';
import type { MockStandaloneSidebarNode } from '@core/mock-server/mock-standalone-sidebar-layout.model';
import {
  MockStandaloneSidebarLayoutService,
  flattenStandaloneSidebarTree,
  type StandaloneSidebarFlatRow,
} from '@core/mock-server/mock-standalone-sidebar-layout.service';
import {
  MockServerUiStateService,
  type MockEndpointGroup,
  type MockSelectionKind,
} from '@core/mock-server/mock-server-ui-state.service';
import { TabService } from '@core/tabs/tab.service';
import { MockServerService } from '@core/mock-server/mock-server.service';
import type { MockServerOptions, MockServerStatus } from '@models/electron';
import { ConfirmDialogService } from '@core/ui/confirm-dialog.service';
import { DropdownComponent, type DropdownOption } from '../../shared/dropdown/dropdown.component';

@Component({
  selector: 'app-mock-server-endpoints-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule, DropdownComponent],
  templateUrl: './mock-server-endpoints-sidebar.component.html',
  styleUrl: './mock-server-endpoints-sidebar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MockServerEndpointsSidebarComponent implements OnInit, OnDestroy {
  groups: MockEndpointGroup[] = [];
  standalones: StandaloneMockEndpoint[] = [];
  selectionKind: MockSelectionKind = null;
  selectedRequestId: string | null = null;
  selectedStandaloneId: string | null = null;

  contextMenuVisible = false;
  menuX = 0;
  menuY = 0;
  contextMenuEndpoint: StandaloneMockEndpoint | null = null;
  /** Folder id when the context menu targets a folder row. */
  contextMenuFolderId: string | null = null;

  standaloneLayoutTree: MockStandaloneSidebarNode[] = [];
  flatStandaloneRows: StandaloneSidebarFlatRow[] = [];
  private standaloneById = new Map<string, StandaloneMockEndpoint>();

  /** Inline rename for a folder row. */
  renamingFolderId: string | null = null;
  folderRenameDraft = '';
  renamingStandaloneId: string | null = null;
  standaloneRenameDraft = '';

  private drag: { kind: 'endpoint' | 'folder'; id: string } | null = null;
  isDraggingStandalone = false;
  dragOverStandaloneRowId: string | null = null;
  dragInsertBeforeNodeId: string | null = null;
  recentlyDroppedStandaloneRowId: string | null = null;
  private droppedHighlightResetTimer: ReturnType<typeof setTimeout> | null = null;

  /** Mock process status for the rail header (port, URL). */
  mockStatus: MockServerStatus = {
    host: '127.0.0.1',
    port: 0,
    status: 'stopped',
    error: null,
    baseUrl: '',
    registered: [],
  };
  mockOptions: MockServerOptions = {
    port: null,
    bindAddress: '127.0.0.1',
    defaultDelayMs: 0,
    defaultContentType: 'application/json; charset=utf-8',
    corsMode: 'all',
    corsOrigins: [],
    autoStart: false,
    captureBodies: true,
  };

  /** Port field (empty = auto). Synced from options / live port when running. */
  portInput: string | number = '';
  showAdvanced = false;

  /** Brief feedback after copying the mock base URL from the rail. */
  copiedMockAddress = false;

  readonly corsModeOptions: DropdownOption[] = [
    { label: 'Off', value: 'off' },
    { label: 'Allow all', value: 'all' },
    { label: 'Listed origins', value: 'list' },
  ];

  private readonly destroy$ = new Subject<void>();
  private readonly advancedStorageKey = 'aw.mockServer.sidebar.showAdvanced';
  private mockAddressCopyResetTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private mockUi: MockServerUiStateService,
    private tabService: TabService,
    private mockServer: MockServerService,
    private confirmDialog: ConfirmDialogService,
    private cdr: ChangeDetectorRef,
    private standaloneLayout: MockStandaloneSidebarLayoutService,
  ) {}

  ngOnInit(): void {
    this.mockUi.groups$.pipe(takeUntil(this.destroy$)).subscribe((g) => {
      this.groups = g;
      this.cdr.markForCheck();
    });
    combineLatest([this.mockUi.standalones$, this.standaloneLayout.tree])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([list, tree]) => {
        this.standalones = list;
        this.standaloneLayoutTree = tree;
        this.standaloneById = new Map(list.map((e) => [e.id, e]));
        this.flatStandaloneRows = flattenStandaloneSidebarTree(tree);
        this.cdr.markForCheck();
      });
    combineLatest([
      this.mockUi.selectionKind$,
      this.mockUi.selectedRequestId$,
      this.mockUi.selectedStandaloneId$,
    ])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([kind, reqId, stId]) => {
        this.selectionKind = kind;
        this.selectedRequestId = reqId;
        this.selectedStandaloneId = stId;
        this.cdr.markForCheck();
      });

    this.mockServer
      .statusChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe((s) => {
        this.mockStatus = s;
        this.syncPortInputFromState();
        this.cdr.markForCheck();
      });
    this.mockServer
      .optionsChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe((o) => {
        this.mockOptions = o;
        this.syncPortInputFromState();
        this.cdr.markForCheck();
      });
    try {
      this.showAdvanced = sessionStorage.getItem(this.advancedStorageKey) === '1';
    } catch {
      /* ignore */
    }
    void this.mockUi.refreshStandalonesList();
    void Promise.all([this.mockServer.refreshStatus(), this.mockServer.refreshOptions()]);
  }

  ngOnDestroy(): void {
    if (this.mockAddressCopyResetTimer) {
      clearTimeout(this.mockAddressCopyResetTimer);
      this.mockAddressCopyResetTimer = null;
    }
    if (this.droppedHighlightResetTimer) {
      clearTimeout(this.droppedHighlightResetTimer);
      this.droppedHighlightResetTimer = null;
    }
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Renders scheme+host and port separately; shows 127.0.0.1 when bound to 0.0.0.0
   * so the line matches a URL you can actually open locally.
   */
  mockUrlDisplayParts(): { schemeHost: string; port: string } | null {
    if (this.mockStatus.status !== 'running') return null;
    const raw = (this.mockStatus.baseUrl || '').trim();
    if (!raw) return null;
    try {
      const u = new URL(raw);
      const host = u.hostname === '0.0.0.0' ? '127.0.0.1' : u.hostname;
      const port = u.port || (this.mockStatus.port > 0 ? String(this.mockStatus.port) : '');
      return { schemeHost: `${u.protocol}//${host}`, port };
    } catch {
      return { schemeHost: raw, port: '' };
    }
  }

  /** Text copied to the clipboard (localhost when bound to all interfaces). */
  mockClipboardUrl(): string {
    const raw = (this.mockStatus.baseUrl || '').trim();
    if (!raw) return '';
    return raw.replace(/^http:\/\/0\.0\.0\.0(?=:|\/)/i, 'http://127.0.0.1');
  }

  mockBaseUrlTooltip(): string {
    const clip = this.mockClipboardUrl();
    if (!clip) return '';
    if (this.mockOptions.bindAddress === '0.0.0.0') {
      return `${clip} — Listens on all interfaces; this is the URL to use on this machine.`;
    }
    return clip;
  }

  async copyMockAddress(): Promise<void> {
    const text = this.mockClipboardUrl();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.copiedMockAddress = true;
      if (this.mockAddressCopyResetTimer) clearTimeout(this.mockAddressCopyResetTimer);
      this.mockAddressCopyResetTimer = setTimeout(() => {
        this.copiedMockAddress = false;
        this.mockAddressCopyResetTimer = null;
        this.cdr.markForCheck();
      }, 1600);
      this.cdr.markForCheck();
    } catch {
      /* clipboard unavailable */
    }
  }

  trackByStandalone = (_i: number, e: StandaloneMockEndpoint) => e.id;
  trackByFlatRow = (_i: number, row: StandaloneSidebarFlatRow) =>
    `${row.node.kind}:${row.node.id}:${row.depth}`;
  trackByEntry = (_i: number, e: { request: RequestModel }) => e.request.id;
  trackByGroup = (_i: number, g: MockEndpointGroup) => g.collectionId;

  standaloneEndpointForRow(row: StandaloneSidebarFlatRow): StandaloneMockEndpoint | null {
    if (row.node.kind !== 'endpoint') return null;
    return this.standaloneById.get(row.node.id) ?? null;
  }

  addStandaloneFolder(): void {
    this.standaloneLayout.addFolder('New folder');
    this.cdr.markForCheck();
  }

  addStandaloneSubfolder(parentFolderId: string): void {
    this.closeContextMenu();
    this.standaloneLayout.addFolder('New folder', parentFolderId);
    this.cdr.markForCheck();
  }

  toggleStandaloneFolder(folderId: string, evt?: MouseEvent): void {
    evt?.stopPropagation();
    evt?.preventDefault();
    this.standaloneLayout.toggleFolder(folderId);
    this.cdr.markForCheck();
  }

  onStandaloneFolderRowClick(folderId: string, evt: MouseEvent): void {
    const t = evt.target as HTMLElement | null;
    if (t?.closest('input, button')) return;
    if (this.renamingFolderId === folderId) return;
    this.standaloneLayout.toggleFolder(folderId);
    this.cdr.markForCheck();
  }

  beginRenameFolder(folderId: string, title: string): void {
    this.renamingFolderId = folderId;
    this.folderRenameDraft = title;
    this.cdr.markForCheck();
  }

  renameFolderFromContextMenu(): void {
    const id = this.contextMenuFolderId;
    if (!id) return;
    const title = this.folderTitleForContextMenu();
    this.closeContextMenu();
    this.renamingFolderId = id;
    this.folderRenameDraft = title;
    this.cdr.markForCheck();
  }

  commitFolderRename(): void {
    if (!this.renamingFolderId) return;
    this.standaloneLayout.renameFolder(this.renamingFolderId, this.folderRenameDraft);
    this.renamingFolderId = null;
    this.folderRenameDraft = '';
    this.cdr.markForCheck();
  }

  cancelFolderRename(): void {
    this.renamingFolderId = null;
    this.folderRenameDraft = '';
    this.cdr.markForCheck();
  }

  startRenameStandalone(endpoint: StandaloneMockEndpoint): void {
    this.closeContextMenu();
    this.renamingStandaloneId = endpoint.id;
    this.standaloneRenameDraft = endpoint.name || '';
    this.cdr.markForCheck();
  }

  cancelRenameStandalone(): void {
    this.renamingStandaloneId = null;
    this.standaloneRenameDraft = '';
    this.cdr.markForCheck();
  }

  async commitRenameStandalone(endpoint: StandaloneMockEndpoint): Promise<void> {
    if (this.renamingStandaloneId !== endpoint.id) return;
    const nextName = this.standaloneRenameDraft.trim();
    this.renamingStandaloneId = null;
    this.standaloneRenameDraft = '';
    if (nextName === (endpoint.name || '').trim()) {
      this.cdr.markForCheck();
      return;
    }
    await this.mockServer.registerStandalone({
      id: endpoint.id,
      name: nextName,
      method: endpoint.method,
      path: endpoint.path,
      variants: endpoint.variants.map((v) => ({
        id: v.id,
        name: v.name,
        statusCode: v.statusCode,
        statusText: v.statusText,
        headers: v.headers || [],
        body: v.body || '',
        delayMs: v.delayMs || 0,
        matchOn: v.matchOn,
        responseSteps: v.responseSteps,
      })),
      activeVariantId: endpoint.activeVariantId,
      activeVariantIds: endpoint.activeVariantIds ?? null,
    });
    await this.mockUi.refreshStandalonesList();
    this.cdr.markForCheck();
  }

  async deleteStandaloneFolder(folderId: string): Promise<void> {
    const ok = await this.confirmDialog.confirm({
      title: 'Remove folder',
      message: 'Delete this folder and all nested child folders/mocks from the sidebar?',
      confirmLabel: 'Remove folder',
    });
    if (!ok) return;
    this.standaloneLayout.deleteFolder(folderId);
    this.closeContextMenu();
    this.cdr.markForCheck();
  }

  deleteFolderFromContextMenu(): void {
    const id = this.contextMenuFolderId;
    if (!id) return;
    void this.deleteStandaloneFolder(id);
  }

  onStandaloneDragStart(ev: DragEvent, kind: 'endpoint' | 'folder', id: string): void {
    this.drag = { kind, id };
    this.isDraggingStandalone = true;
    this.dragOverStandaloneRowId = null;
    try {
      ev.dataTransfer?.setData('application/x-aw-mock-sidebar', JSON.stringify({ kind, id }));
      ev.dataTransfer?.setData('text/plain', id);
    } catch {
      /* ignore */
    }
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
  }

  onStandaloneDragEnd(): void {
    this.drag = null;
    this.isDraggingStandalone = false;
    this.dragOverStandaloneRowId = null;
    this.dragInsertBeforeNodeId = null;
    this.cdr.markForCheck();
  }

  private parseStandaloneDrag(ev: DragEvent): { kind: 'endpoint' | 'folder'; id: string } | null {
    try {
      const raw = ev.dataTransfer?.getData('application/x-aw-mock-sidebar');
      if (raw) {
        const o = JSON.parse(raw) as { kind?: string; id?: string };
        if ((o.kind === 'endpoint' || o.kind === 'folder') && typeof o.id === 'string') {
          return { kind: o.kind, id: o.id };
        }
      }
    } catch {
      /* ignore */
    }
    return this.drag;
  }

  onStandaloneRowDragOver(ev: DragEvent): void {
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
  }

  onStandaloneRowDragOverWithTarget(ev: DragEvent, rowId: string): void {
    this.onStandaloneRowDragOver(ev);
    if (this.dragOverStandaloneRowId !== rowId) {
      this.dragOverStandaloneRowId = rowId;
      this.cdr.markForCheck();
    }
  }

  onStandaloneRowDragLeave(_ev: DragEvent, rowId: string): void {
    if (this.dragOverStandaloneRowId === rowId) {
      this.dragOverStandaloneRowId = null;
      this.cdr.markForCheck();
    }
  }

  private pulseDroppedRow(rowId: string): void {
    this.recentlyDroppedStandaloneRowId = rowId;
    if (this.droppedHighlightResetTimer) clearTimeout(this.droppedHighlightResetTimer);
    this.droppedHighlightResetTimer = setTimeout(() => {
      this.recentlyDroppedStandaloneRowId = null;
      this.droppedHighlightResetTimer = null;
      this.cdr.markForCheck();
    }, 520);
  }

  onStandaloneInsertDragOver(ev: DragEvent, row: StandaloneSidebarFlatRow): void {
    this.onStandaloneRowDragOver(ev);
    if (this.dragInsertBeforeNodeId !== row.node.id) {
      this.dragInsertBeforeNodeId = row.node.id;
      this.cdr.markForCheck();
    }
  }

  onStandaloneInsertDragLeave(_ev: DragEvent, row: StandaloneSidebarFlatRow): void {
    if (this.dragInsertBeforeNodeId === row.node.id) {
      this.dragInsertBeforeNodeId = null;
      this.cdr.markForCheck();
    }
  }

  onStandaloneInsertDrop(ev: DragEvent, row: StandaloneSidebarFlatRow): void {
    ev.preventDefault();
    ev.stopPropagation();
    const parsed = this.parseStandaloneDrag(ev);
    if (!parsed) return;
    this.standaloneLayout.moveItemToParent(parsed.kind, parsed.id, row.parentFolderId, row.node.id);
    this.drag = null;
    this.isDraggingStandalone = false;
    this.dragOverStandaloneRowId = null;
    this.dragInsertBeforeNodeId = null;
    this.pulseDroppedRow(row.node.id);
    this.cdr.markForCheck();
  }

  /**
   * Collection-like "tail lane": show append target after the last visible item
   * of each sibling list (root or folder children).
   */
  showStandaloneAppendLaneAfterIndex(index: number): boolean {
    const row = this.flatStandaloneRows[index];
    if (!row) return false;
    const parentId = row.parentFolderId;
    const depth = row.depth;
    for (let i = index + 1; i < this.flatStandaloneRows.length; i++) {
      const next = this.flatStandaloneRows[i];
      if (next.depth < depth) {
        // We left this subtree; no more siblings in this list.
        break;
      }
      if (next.depth === depth && next.parentFolderId === parentId) {
        // Another sibling exists; not the tail.
        return false;
      }
      if (next.depth === depth && next.parentFolderId !== parentId) {
        // Same depth but different parent = sibling list ended.
        break;
      }
    }
    return true;
  }

  standaloneAppendLaneKey(parentFolderId: string | null, afterNodeId: string): string {
    return `tail:${parentFolderId ?? 'root'}:${afterNodeId}`;
  }

  onStandaloneAppendDragOver(ev: DragEvent, parentFolderId: string | null, afterNodeId: string): void {
    this.onStandaloneRowDragOver(ev);
    const key = this.standaloneAppendLaneKey(parentFolderId, afterNodeId);
    if (this.dragInsertBeforeNodeId !== key) {
      this.dragInsertBeforeNodeId = key;
      this.cdr.markForCheck();
    }
  }

  onStandaloneAppendDragLeave(_ev: DragEvent, parentFolderId: string | null, afterNodeId: string): void {
    const key = this.standaloneAppendLaneKey(parentFolderId, afterNodeId);
    if (this.dragInsertBeforeNodeId === key) {
      this.dragInsertBeforeNodeId = null;
      this.cdr.markForCheck();
    }
  }

  onStandaloneAppendDrop(ev: DragEvent, parentFolderId: string | null, afterNodeId: string): void {
    ev.preventDefault();
    ev.stopPropagation();
    const parsed = this.parseStandaloneDrag(ev);
    if (!parsed) return;
    this.standaloneLayout.moveItemToParent(parsed.kind, parsed.id, parentFolderId, null);
    this.drag = null;
    this.isDraggingStandalone = false;
    this.dragOverStandaloneRowId = null;
    this.dragInsertBeforeNodeId = null;
    this.pulseDroppedRow(afterNodeId);
    this.cdr.markForCheck();
  }

  /**
   * Drop directly on folder row nests dragged item into this folder.
   * Reorder is handled by explicit insert lanes between rows.
   */
  onDropOnStandaloneFolder(ev: DragEvent, row: StandaloneSidebarFlatRow): void {
    ev.preventDefault();
    ev.stopPropagation();
    if (row.node.kind !== 'folder') return;
    const parsed = this.parseStandaloneDrag(ev);
    if (!parsed) return;
    this.standaloneLayout.moveIntoFolder(parsed.kind, parsed.id, row.node.id);
    this.drag = null;
    this.isDraggingStandalone = false;
    this.dragOverStandaloneRowId = null;
    this.dragInsertBeforeNodeId = null;
    this.pulseDroppedRow(row.node.id);
    this.cdr.markForCheck();
  }

  /** Drop on an endpoint row: insert before this item in the same list. */
  onDropBeforeStandaloneEndpoint(ev: DragEvent, row: StandaloneSidebarFlatRow): void {
    ev.preventDefault();
    ev.stopPropagation();
    if (row.node.kind !== 'endpoint') return;
    const parsed = this.parseStandaloneDrag(ev);
    if (!parsed) return;
    this.standaloneLayout.moveItemToParent(parsed.kind, parsed.id, row.parentFolderId, row.node.id);
    this.drag = null;
    this.isDraggingStandalone = false;
    this.dragOverStandaloneRowId = null;
    this.dragInsertBeforeNodeId = null;
    this.pulseDroppedRow(row.node.id);
    this.cdr.markForCheck();
  }

  /** Drop on rail background: append dragged item at root. */
  onDropStandaloneAtRoot(ev: DragEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    const parsed = this.parseStandaloneDrag(ev);
    if (!parsed) return;
    this.standaloneLayout.moveItemToParent(parsed.kind, parsed.id, null, null);
    this.drag = null;
    this.isDraggingStandalone = false;
    this.dragOverStandaloneRowId = null;
    this.dragInsertBeforeNodeId = null;
    this.pulseDroppedRow(parsed.id);
    this.cdr.markForCheck();
  }

  totalRegistered(): number {
    const fromCollections = this.groups.reduce((sum, g) => sum + g.entries.length, 0);
    return fromCollections + this.standalones.length;
  }

  methodLabel(request: RequestModel | null | undefined): string {
    if (!request) return '';
    const value = request.httpMethod as unknown;
    if (typeof value === 'number') return HttpMethod[value] || '';
    return String(value || '');
  }

  standalonePrimaryLabel(e: StandaloneMockEndpoint): string {
    const n = e.name.trim();
    return n || e.path;
  }

  standaloneEntryTitle(e: StandaloneMockEndpoint): string {
    const n = e.name.trim();
    return n ? `${n} — ${e.method} ${e.path}` : `${e.method} ${e.path}`;
  }

  selectRequest(request: RequestModel): void {
    this.tabService.openMockServerTab();
    this.mockUi.selectRequest(request);
    setTimeout(() => this.mockUi.selectRequest(request), 0);
  }

  selectStandalone(endpoint: StandaloneMockEndpoint): void {
    this.tabService.openMockServerTab();
    this.mockUi.selectStandalone(endpoint);
    setTimeout(() => this.mockUi.selectStandalone(endpoint), 0);
  }

  async addStandalone(): Promise<void> {
    this.tabService.openMockServerTab();
    await this.mockUi.addStandalone();
  }

  async addStandaloneInFolder(folderId: string): Promise<void> {
    this.closeContextMenu();
    this.tabService.openMockServerTab();
    const created = await this.mockUi.addStandalone();
    if (created) {
      this.standaloneLayout.moveIntoFolder('endpoint', created.id, folderId);
    }
    this.cdr.markForCheck();
  }

  async removeStandalone(endpoint: StandaloneMockEndpoint, evt?: MouseEvent): Promise<void> {
    if (evt) {
      evt.stopPropagation();
      evt.preventDefault();
    }
    await this.mockUi.removeStandalone(endpoint);
    this.closeContextMenu();
  }

  openContextMenu(event: MouseEvent, endpoint: StandaloneMockEndpoint): void {
    event.preventDefault();
    event.stopPropagation();
    this.contextMenuVisible = true;
    this.contextMenuEndpoint = endpoint;
    this.contextMenuFolderId = null;
    this.menuX = event.clientX;
    this.menuY = event.clientY;
  }

  renameStandaloneFromContextMenu(): void {
    if (!this.contextMenuEndpoint) return;
    this.startRenameStandalone(this.contextMenuEndpoint);
  }

  openFolderContextMenu(event: MouseEvent, folderId: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.contextMenuVisible = true;
    this.contextMenuFolderId = folderId;
    this.contextMenuEndpoint = null;
    this.menuX = event.clientX;
    this.menuY = event.clientY;
  }

  openStandaloneAreaContextMenu(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.standalone-folder-row, .standalone-entry, .entry-remove, .rail-entry')) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.contextMenuVisible = true;
    this.contextMenuFolderId = null;
    this.contextMenuEndpoint = null;
    this.menuX = event.clientX;
    this.menuY = event.clientY;
    this.cdr.markForCheck();
  }

  closeContextMenu(): void {
    this.contextMenuVisible = false;
    this.contextMenuEndpoint = null;
    this.contextMenuFolderId = null;
  }

  folderTitleForContextMenu(): string {
    if (!this.contextMenuFolderId) return '';
    const walk = (nodes: MockStandaloneSidebarNode[]): string | null => {
      for (const n of nodes) {
        if (n.kind === 'folder' && n.id === this.contextMenuFolderId) return n.title;
        if (n.kind === 'folder') {
          const inner = walk(n.children);
          if (inner != null) return inner;
        }
      }
      return null;
    };
    return walk(this.standaloneLayoutTree) ?? '';
  }

  /** Badge: at least one variant participates in unpinned mock resolution. */
  standaloneHasServedMocks(e: StandaloneMockEndpoint): boolean {
    if (this.mockStatus.status !== 'running') return false;
    const v = e.variants || [];
    if (!v.length) return false;
    const ids = e.activeVariantIds;
    if (ids == null) return true;
    return ids.length > 0;
  }

  /** Keep port field aligned with persisted / listening port. */
  private syncPortInputFromState(): void {
    if (this.mockStatus.status === 'running' && this.mockStatus.port > 0) {
      this.portInput = String(this.mockStatus.port);
      return;
    }
    this.portInput = this.mockOptions.port == null ? '' : String(this.mockOptions.port);
  }

  private parsedPort(): number | null {
    const trimmed = String(this.portInput ?? '').trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    if (!Number.isFinite(num) || num < 1 || num > 65535) return null;
    return Math.floor(num);
  }

  async startMock(): Promise<void> {
    const port = this.parsedPort();
    if (port != null) {
      await this.mockServer.setOptions({ port });
    } else {
      await this.mockServer.setOptions({ port: null });
    }
    void this.mockServer.start(port ?? undefined);
  }

  stopMock(): void {
    void this.mockServer.stop();
  }

  toggleAdvanced(): void {
    this.showAdvanced = !this.showAdvanced;
    try {
      sessionStorage.setItem(this.advancedStorageKey, this.showAdvanced ? '1' : '0');
    } catch {
      /* ignore */
    }
    this.cdr.markForCheck();
  }

  async onOptionChange<K extends keyof MockServerOptions>(key: K, value: MockServerOptions[K]): Promise<void> {
    await this.mockServer.setOptions({ [key]: value } as Partial<MockServerOptions>);
    this.cdr.markForCheck();
  }

  onDefaultDelayChange(raw: string | number | null | undefined): void {
    const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
    const ms = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
    void this.onOptionChange('defaultDelayMs', ms);
  }

  onCorsModeChange(v: string | null | undefined): void {
    if (v !== 'off' && v !== 'all' && v !== 'list') return;
    void this.onOptionChange('corsMode', v);
    this.cdr.markForCheck();
  }

  async setBindAddress(address: '127.0.0.1' | '0.0.0.0'): Promise<void> {
    if (address === '0.0.0.0' && this.mockOptions.bindAddress !== '0.0.0.0') {
      const ok = await this.confirmDialog.confirm({
        title: 'Network exposure',
        message:
          'Binding to 0.0.0.0 makes the mock server reachable from other devices on your network. Continue?',
        confirmLabel: 'Continue',
      });
      if (!ok) return;
    }
    await this.mockServer.setOptions({ bindAddress: address });
    if (this.mockStatus.status === 'running') {
      await this.mockServer.restart();
    }
    this.cdr.markForCheck();
  }

  get portFieldDisabled(): boolean {
    return this.mockStatus.status === 'running' || this.mockStatus.status === 'starting';
  }
}
