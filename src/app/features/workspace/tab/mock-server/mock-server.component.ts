import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, combineLatest, takeUntil } from 'rxjs';

import { TabItem } from '@core/tabs/tab.service';
import { CollectionService } from '@core/collection/collection.service';
import { ConfirmDialogService } from '@core/ui/confirm-dialog.service';
import { MockServerService } from '@core/mock-server/mock-server.service';
import {
  MockServerUiStateService,
  type MockSelectionKind,
} from '@core/mock-server/mock-server-ui-state.service';
import { Collection, Folder } from '@models/collection';
import {
  HttpMethod,
  MockVariant,
  Request as RequestModel,
  cloneMockVariantMatchRules,
  isMockVariantServed,
  syncLegacyPrimaryMockVariantId,
  toggleVariantServed,
} from '@models/request';
import { SettingsService } from '@core/settings/settings.service';
import type {
  MockHit,
  MockServerOptions,
  MockServerStatus,
  StandaloneMockEndpoint,
} from '@models/electron';
import { v4 as uuidv4 } from 'uuid';

import {
  CodeEditorComponent,
  type EditorLanguage,
  type ScriptCompletionItem,
} from '../../shared/code-editor/code-editor.component';
import { DropdownComponent, type DropdownOption } from '../../shared/dropdown/dropdown.component';
import { formatTimestampForUi } from '../../shared/utils/timestamp.util';
import { MockVariantMatchSectionComponent } from '../../shared/mock-variant-match-section/mock-variant-match-section.component';

/** Persisted in sessionStorage for the Mock Server tab (same browser session). */
interface MockServerSessionSnapshot {
  v: 1;
  activityVisible: boolean;
  expandedHitId: string | null;
  headersOpen: string[];
  /** Variant ids whose matchers / response / body editor is expanded (compact list when omitted). */
  variantDetailsOpen?: string[];
  selectionKind: MockSelectionKind;
  selectedRequestId: string | null;
  selectedStandaloneId: string | null;
  hitFilter: string;
  methodFilter: string;
  statusFilter: '' | '2xx' | '3xx' | '4xx' | '5xx';
}

const STANDALONE_METHODS: ReadonlyArray<string> = [
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD',
];

/**
 * Body-type sugar layered on top of the underlying header list. The mock
 * variant model only stores raw `headers` + `body`, so we infer the type
 * from the Content-Type and re-write that header when the user picks a
 * different one.
 */
type BodyType =
  | 'json'
  | 'xml'
  | 'html'
  | 'text'
  | 'graphql'
  | 'formdata'
  | 'urlencoded'
  | 'binary'
  | 'none'
  | 'custom';

const BODY_TYPE_HEADERS: Record<Exclude<BodyType, 'none' | 'custom'>, string> = {
  json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  html: 'text/html; charset=utf-8',
  text: 'text/plain; charset=utf-8',
  graphql: 'application/graphql; charset=utf-8',
  formdata: 'multipart/form-data',
  urlencoded: 'application/x-www-form-urlencoded',
  binary: 'application/octet-stream',
};

const BODY_TYPE_STUBS: Record<Exclude<BodyType, 'none' | 'custom'>, string> = {
  json: '{\n  "ok": true\n}',
  xml: '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n  <ok>true</ok>\n</root>',
  html: '<!doctype html>\n<html>\n  <body>Hello</body>\n</html>',
  text: 'Hello',
  graphql: 'query {\n  viewer {\n    id\n  }\n}',
  formdata: 'field=value\nfile=@/path/to/file',
  urlencoded: 'key=value',
  binary: '[binary data placeholder]',
};

/** Anything that has a header list + body — covers MockVariant and standalone variants. */
interface VariantLike {
  body?: string;
  headers?: Array<{ key: string; value: string }>;
}

@Component({
  selector: 'app-mock',
  standalone: true,
  imports: [CommonModule, FormsModule, DropdownComponent, CodeEditorComponent, MockVariantMatchSectionComponent],
  templateUrl: './mock-server.component.html',
  styleUrl: './mock-server.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MockComponent implements OnInit, OnDestroy {
  @Input() tab!: TabItem;

  status: MockServerStatus = {
    host: '127.0.0.1',
    port: 0,
    status: 'stopped',
    error: null,
    baseUrl: '',
    registered: [],
    standalone: [],
  };

  options: MockServerOptions = {
    port: null,
    bindAddress: '127.0.0.1',
    defaultDelayMs: 0,
    defaultContentType: 'application/json; charset=utf-8',
    corsMode: 'all',
    corsOrigins: [],
    autoStart: false,
    captureBodies: true,
  };

  /** Listening / configured port (synced from the service; used when starting or restarting from this tab). */
  portInput: string | number = '';
  /** When true, the activity log is shown below the editor (hidden by default). */
  activityPaneVisible = false;
  private readonly sessionUiKey = 'aw.mockServer.sessionUi';
  /** @deprecated Read once when no session snapshot; not written anymore. */
  private readonly legacyActivityPrefKey = 'aw.mockServer.showActivity';
  copied: 'baseUrl' | string | null = null;

  selectedRequestId: string | null = null;
  selectedRequest: RequestModel | null = null;
  selectedRequestParentPath = '';

  /**
   * Standalone mocks live in the main process keyed by `${method}:${path}`.
   * The renderer keeps a local mirror so users can edit fluidly; every change
   * is pushed back via {@link MockServerService.registerStandalone}.
   */
  standalones: StandaloneMockEndpoint[] = [];
  selectedStandaloneId: string | null = null;
  selectedStandalone: StandaloneMockEndpoint | null = null;
  selectionKind: MockSelectionKind = null;
  /** Standalone route HTTP method (app-dropdown, same list as STANDALONE_METHODS). */
  readonly standaloneMethodOptions: DropdownOption[] = STANDALONE_METHODS.map((m) => ({
    label: m,
    value: m,
  }));
  readonly bodyTypeOptions: ReadonlyArray<BodyType> = [
    'json', 'xml', 'html', 'text', 'graphql', 'formdata', 'urlencoded', 'binary', 'none', 'custom',
  ];
  readonly responsePlaceholderCompletions: ScriptCompletionItem[] = [
    { label: '{{body}}', insert: '{{body}}', detail: 'Raw incoming request body.' },
    { label: '{{bodyJson}}', insert: '{{bodyJson}}', detail: 'Incoming body JSON-escaped as string.' },
    { label: '{{bodyJson.accessToken}}', insert: '{{bodyJson.accessToken}}', detail: 'Dot-path lookup in parsed JSON body.' },
    { label: '{{header.Authorization}}', insert: '{{header.Authorization}}', detail: 'Raw request header value.' },
    { label: '{{headerJson.Authorization}}', insert: '{{headerJson.Authorization}}', detail: 'Header value JSON-escaped for safe embed.' },
    { label: '{{cache.result}}', insert: '{{cache.result}}', detail: 'Value from response pipeline cache (if set).' },
    { label: '$uuid', insert: '$uuid', detail: 'Generated UUID per response.' },
  ];

  hits: MockHit[] = [];
  hitFilter = '';
  methodFilter = '';
  statusFilter: '' | '2xx' | '3xx' | '4xx' | '5xx' = '';
  /** Activity log method filter options (app-dropdown, not native select). */
  readonly activityMethodOptions: DropdownOption[] = [
    { label: 'Any method', value: '' },
    { label: 'GET', value: 'GET' },
    { label: 'POST', value: 'POST' },
    { label: 'PUT', value: 'PUT' },
    { label: 'PATCH', value: 'PATCH' },
    { label: 'DELETE', value: 'DELETE' },
    { label: 'OPTIONS', value: 'OPTIONS' },
    { label: 'HEAD', value: 'HEAD' },
  ];
  readonly activityStatusOptions: DropdownOption[] = [
    { label: 'Any status', value: '' },
    { label: '2xx', value: '2xx' },
    { label: '3xx', value: '3xx' },
    { label: '4xx', value: '4xx' },
    { label: '5xx', value: '5xx' },
  ];
  expandedHitId: string | null = null;

  /** Variant ids whose response-headers editor is currently expanded. */
  private headersOpen = new Set<string>();

  /** Variant ids whose full mock editor (matchers, steps, body) is visible. */
  private variantDetailsOpen = new Set<string>();

  private destroy$ = new Subject<void>();
  private collections: Collection[] = [];

  constructor(
    private collectionService: CollectionService,
    private mockServer: MockServerService,
    private mockUi: MockServerUiStateService,
    private confirmDialog: ConfirmDialogService,
    private settings: SettingsService,
    private cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    this.restoreMockServerSession();
    this.collectionService
      .getCollectionsObservable()
      .pipe(takeUntil(this.destroy$))
      .subscribe((collections: Collection[]) => {
        this.collections = collections || [];
        this.mockUi.setCollections(collections || []);
        this.refreshSelection();
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
        this.refreshSelection();
        this.syncSelectedStandaloneFromList();
        this.persistMockServerSession();
        this.cdr.markForCheck();
      });

    this.mockUi.standalones$
      .pipe(takeUntil(this.destroy$))
      .subscribe((list) => {
        this.standalones = list;
        if (this.selectionKind === 'standalone') {
          this.syncSelectedStandaloneFromList();
        }
        this.cdr.markForCheck();
      });

    this.mockServer
      .statusChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe((status) => {
        this.status = status;
        this.mockUi.setStatus(status);
        void this.mockUi.refreshStandalonesList();
        this.cdr.markForCheck();
      });

    this.mockServer
      .optionsChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe((options) => {
        this.options = options;
        this.portInput = options.port == null ? '' : String(options.port);
        this.cdr.markForCheck();
      });

    this.mockServer
      .hits()
      .pipe(takeUntil(this.destroy$))
      .subscribe((hits) => {
        this.hits = hits;
        this.cdr.markForCheck();
      });

    await Promise.all([
      this.settings.loadSettings(),
      this.mockServer.refreshStatus(),
      this.mockServer.refreshOptions(),
      this.mockServer.refreshHits(),
      this.mockUi.refreshStandalonesList(),
    ]);
    this.refreshSelection();
    this.syncSelectedStandaloneFromList();
    this.persistMockServerSession();
  }

  private syncSelectedStandaloneFromList(): void {
    if (this.selectionKind === 'standalone' && this.selectedStandaloneId) {
      this.selectedStandalone =
        this.standalones.find((s) => s.id === this.selectedStandaloneId) ?? null;
    } else {
      this.selectedStandalone = null;
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private restoreMockServerSession(): void {
    if (typeof sessionStorage === 'undefined') {
      this.applyLegacyActivityPreferenceOnly();
      return;
    }
    try {
      const raw = sessionStorage.getItem(this.sessionUiKey);
      if (!raw) {
        this.applyLegacyActivityPreferenceOnly();
        return;
      }
      const snap = JSON.parse(raw) as Partial<MockServerSessionSnapshot>;
      if (snap.v !== 1) {
        this.applyLegacyActivityPreferenceOnly();
        return;
      }
      this.activityPaneVisible = !!snap.activityVisible;
      this.expandedHitId = snap.expandedHitId ?? null;
      this.headersOpen.clear();
      if (Array.isArray(snap.headersOpen)) {
        for (const id of snap.headersOpen) {
          if (id) this.headersOpen.add(id);
        }
      }
      this.variantDetailsOpen.clear();
      if (Array.isArray(snap.variantDetailsOpen)) {
        for (const id of snap.variantDetailsOpen) {
          if (id) this.variantDetailsOpen.add(id);
        }
      }
      let kind: MockSelectionKind = null;
      if (snap.selectionKind === 'request' || snap.selectionKind === 'standalone' || snap.selectionKind === null) {
        kind = snap.selectionKind;
      }
      this.mockUi.applySelectionFromSession(
        kind,
        snap.selectedRequestId ?? null,
        snap.selectedStandaloneId ?? null,
      );
      if (typeof snap.hitFilter === 'string') this.hitFilter = snap.hitFilter;
      if (typeof snap.methodFilter === 'string') this.methodFilter = snap.methodFilter;
      if (snap.statusFilter === '' || snap.statusFilter === '2xx' || snap.statusFilter === '3xx' || snap.statusFilter === '4xx' || snap.statusFilter === '5xx') {
        this.statusFilter = snap.statusFilter;
      }
    } catch {
      this.applyLegacyActivityPreferenceOnly();
    }
  }

  /** If no session snapshot yet, honor former localStorage activity flag once. */
  private applyLegacyActivityPreferenceOnly(): void {
    this.activityPaneVisible = false;
    if (typeof localStorage === 'undefined') return;
    try {
      if (localStorage.getItem(this.legacyActivityPrefKey) === '1') {
        this.activityPaneVisible = true;
      }
    } catch {
      // ignore
    }
  }

  private persistMockServerSession(): void {
    if (typeof sessionStorage === 'undefined') return;
    try {
      const snap: MockServerSessionSnapshot = {
        v: 1,
        activityVisible: this.activityPaneVisible,
        expandedHitId: this.expandedHitId,
        headersOpen: Array.from(this.headersOpen),
        variantDetailsOpen: Array.from(this.variantDetailsOpen),
        selectionKind: this.selectionKind,
        selectedRequestId: this.selectedRequestId,
        selectedStandaloneId: this.selectedStandaloneId,
        hitFilter: this.hitFilter,
        methodFilter: this.methodFilter,
        statusFilter: this.statusFilter,
      };
      sessionStorage.setItem(this.sessionUiKey, JSON.stringify(snap));
    } catch {
      // ignore quota errors
    }
  }

  setActivityPaneVisible(visible: boolean): void {
    this.activityPaneVisible = visible;
    this.persistMockServerSession();
    this.cdr.markForCheck();
  }

  private refreshSelection(): void {
    if (!this.selectedRequestId) {
      this.selectedRequest = null;
      this.selectedRequestParentPath = '';
      return;
    }
    let found: RequestModel | null = null;
    let parentPath = '';
    for (const collection of this.collections) {
      const walk = (node: Collection | Folder, path: string): boolean => {
        for (const req of node.requests || []) {
          if (req.id === this.selectedRequestId) {
            found = req;
            parentPath = path || collection.title;
            return true;
          }
        }
        for (const folder of node.folders || []) {
          const next = path ? `${path} / ${folder.title}` : folder.title;
          if (walk(folder, next)) return true;
        }
        return false;
      };
      if (walk(collection, '')) break;
    }
    this.selectedRequest = found;
    this.selectedRequestParentPath = parentPath;
  }

  selectRequest(request: RequestModel): void {
    this.mockUi.selectRequest(request);
  }

  /**
   * Create a new standalone endpoint with one default variant. The path is
   * derived from a counter so users can spam the button without manually
   * picking unique paths up-front.
   */
  async addStandalone(): Promise<void> {
    await this.mockUi.addStandalone();
  }

  async removeStandalone(endpoint: StandaloneMockEndpoint, evt?: MouseEvent): Promise<void> {
    await this.mockUi.removeStandalone(endpoint);
  }

  /**
   * Push the current local copy of a standalone endpoint back to the main
   * process. Called after every form change; the main process treats the
   * call as upsert keyed by id.
   */
  async commitStandalone(): Promise<void> {
    if (!this.selectedStandalone) return;
    const s = this.selectedStandalone;
    const updated = await this.mockServer.registerStandalone({
      id: s.id,
      name: s.name,
      method: s.method,
      path: s.path,
      variants: s.variants.map((v) => ({
        id: v.id,
        name: v.name,
        statusCode: v.statusCode,
        statusText: v.statusText,
        headers: v.headers,
        body: v.body,
        delayMs: v.delayMs,
        matchOn: v.matchOn,
        responseSteps: (v as MockVariant).responseSteps,
      })),
      activeVariantId: s.activeVariantId,
      activeVariantIds: s.activeVariantIds === undefined ? undefined : s.activeVariantIds,
    });
    if (updated) this.selectedStandalone = updated;
    await this.mockUi.refreshStandalonesList();
  }

  onStandaloneMethodSelect(method: string): void {
    if (!this.selectedStandalone) return;
    this.selectedStandalone.method = method;
    this.onStandaloneFieldChange();
  }

  onStandaloneFieldChange(): void {
    void this.commitStandalone();
  }

  addStandaloneVariant(): void {
    const s = this.selectedStandalone;
    if (!s) return;
    const variant = {
      id: uuidv4(),
      name: `Variant ${s.variants.length + 1}`,
      statusCode: 200,
      headers: [{ key: 'Content-Type', value: 'application/json' }],
      body: '{\n  "ok": true\n}',
      delayMs: 0,
    };
    s.variants = [...s.variants, variant];
    if (Array.isArray(s.activeVariantIds)) {
      s.activeVariantIds = [...s.activeVariantIds, variant.id];
    }
    this.variantDetailsOpen.add(variant.id);
    this.syncStandalonePrimaryActive(s);
    void this.commitStandalone();
    this.persistMockServerSession();
    this.cdr.markForCheck();
  }

  removeStandaloneVariant(index: number): void {
    const s = this.selectedStandalone;
    if (!s) return;
    const next = s.variants.slice();
    const [removed] = next.splice(index, 1);
    s.variants = next;
    if (removed?.id) {
      this.variantDetailsOpen.delete(removed.id);
      this.headersOpen.delete(removed.id);
    }
    if (removed && Array.isArray(s.activeVariantIds)) {
      s.activeVariantIds = s.activeVariantIds.filter((id: string) => id !== removed.id);
    }
    this.syncStandalonePrimaryActive(s);
    void this.commitStandalone();
    this.persistMockServerSession();
    this.cdr.markForCheck();
  }

  duplicateStandaloneVariant(index: number): void {
    const s = this.selectedStandalone;
    if (!s) return;
    const original = s.variants[index];
    if (!original) return;
    const copy = {
      ...original,
      id: uuidv4(),
      name: `${original.name || 'Variant'} (copy)`,
      headers: original.headers ? original.headers.map((h) => ({ ...h })) : [],
      matchOn: cloneMockVariantMatchRules(original.matchOn),
      responseSteps: (original as MockVariant).responseSteps?.length
        ? JSON.parse(JSON.stringify((original as MockVariant).responseSteps)) as MockVariant['responseSteps']
        : [],
    };
    const next = s.variants.slice();
    next.splice(index + 1, 0, copy);
    s.variants = next;
    const ids = s.activeVariantIds;
    if (Array.isArray(ids) && ids.includes(original.id)) {
      s.activeVariantIds = [...ids, copy.id];
    }
    this.variantDetailsOpen.add(copy.id);
    this.syncStandalonePrimaryActive(s);
    void this.commitStandalone();
    this.persistMockServerSession();
    this.cdr.markForCheck();
  }

  onStandaloneVariantServedChange(variantId: string, ev: Event): void {
    const checked = (ev.target as HTMLInputElement).checked;
    const s = this.selectedStandalone;
    if (!s) return;
    const now = isMockVariantServed(variantId, s.variants as MockVariant[], s.activeVariantIds);
    if (checked === now) return;
    toggleVariantServed(
      s.variants || [],
      variantId,
      () => s.activeVariantIds,
      (next) => {
        s.activeVariantIds = next;
      },
    );
    this.syncStandalonePrimaryActive(s);
    void this.commitStandalone();
  }

  isStandaloneVariantServed(variantId: string): boolean {
    const s = this.selectedStandalone;
    if (!s) return false;
    return isMockVariantServed(variantId, s.variants as MockVariant[], s.activeVariantIds);
  }

  private syncStandalonePrimaryActive(s: StandaloneMockEndpoint): void {
    const list = s.variants || [];
    const ids = s.activeVariantIds;
    if (!list.length) {
      s.activeVariantId = null;
      return;
    }
    if (ids == null) {
      s.activeVariantId = list[0]?.id ?? null;
      return;
    }
    if (ids.length === 0) {
      s.activeVariantId = null;
      return;
    }
    s.activeVariantId = list.find((v) => ids.includes(v.id))?.id ?? null;
  }

  standaloneUrl(endpoint: StandaloneMockEndpoint | null): string {
    if (!endpoint || !this.status.baseUrl) return '';
    return `${this.status.baseUrl}${endpoint.path}`;
  }

  trackByVariant = (_i: number, v: MockVariant) => v.id;
  trackByHit = (_i: number, h: MockHit) => h.id;
  addVariant(): void {
    if (!this.selectedRequest) return;
    const list = this.selectedRequest.mockVariants || [];
    const variant: MockVariant = {
      id: uuidv4(),
      name: `Variant ${list.length + 1}`,
      statusCode: 200,
      headers: [{ key: 'Content-Type', value: 'application/json' }],
      body: '{\n  "ok": true\n}',
      delayMs: 0,
    };
    this.selectedRequest.mockVariants = [...list, variant];
    if (Array.isArray(this.selectedRequest.activeMockVariantIds)) {
      this.selectedRequest.activeMockVariantIds = [...this.selectedRequest.activeMockVariantIds, variant.id];
    }
    this.variantDetailsOpen.add(variant.id);
    syncLegacyPrimaryMockVariantId(this.selectedRequest);
    void this.persistAndSync();
    this.persistMockServerSession();
    this.cdr.markForCheck();
  }

  removeVariant(index: number): void {
    if (!this.selectedRequest?.mockVariants) return;
    const next = this.selectedRequest.mockVariants.slice();
    const [removed] = next.splice(index, 1);
    this.selectedRequest.mockVariants = next;
    if (removed?.id) {
      this.variantDetailsOpen.delete(removed.id);
      this.headersOpen.delete(removed.id);
    }
    if (removed && Array.isArray(this.selectedRequest.activeMockVariantIds)) {
      this.selectedRequest.activeMockVariantIds = this.selectedRequest.activeMockVariantIds.filter(
        (id) => id !== removed.id,
      );
    }
    syncLegacyPrimaryMockVariantId(this.selectedRequest);
    void this.persistAndSync();
    this.persistMockServerSession();
    this.cdr.markForCheck();
  }

  duplicateVariant(index: number): void {
    if (!this.selectedRequest?.mockVariants) return;
    const original = this.selectedRequest.mockVariants[index];
    if (!original) return;
    const copy: MockVariant = {
      ...original,
      id: uuidv4(),
      name: `${original.name || 'Variant'} (copy)`,
      headers: original.headers ? original.headers.map((h) => ({ ...h })) : undefined,
      matchOn: cloneMockVariantMatchRules(original.matchOn),
      responseSteps: original.responseSteps?.length
        ? JSON.parse(JSON.stringify(original.responseSteps)) as MockVariant['responseSteps']
        : [],
    };
    const next = this.selectedRequest.mockVariants.slice();
    next.splice(index + 1, 0, copy);
    this.selectedRequest.mockVariants = next;
    const ids = this.selectedRequest.activeMockVariantIds;
    if (Array.isArray(ids) && ids.includes(original.id)) {
      this.selectedRequest.activeMockVariantIds = [...ids, copy.id];
    }
    this.variantDetailsOpen.add(copy.id);
    syncLegacyPrimaryMockVariantId(this.selectedRequest);
    void this.persistAndSync();
    this.persistMockServerSession();
    this.cdr.markForCheck();
  }

  onRequestVariantServedChange(variantId: string, ev: Event): void {
    const checked = (ev.target as HTMLInputElement).checked;
    const req = this.selectedRequest;
    if (!req) return;
    const now = isMockVariantServed(variantId, req.mockVariants, req.activeMockVariantIds);
    if (checked === now) return;
    toggleVariantServed(
      req.mockVariants || [],
      variantId,
      () => req.activeMockVariantIds,
      (next) => {
        req.activeMockVariantIds = next;
      },
    );
    syncLegacyPrimaryMockVariantId(req);
    void this.persistAndSync();
  }

  isRequestVariantServed(variantId: string): boolean {
    const req = this.selectedRequest;
    if (!req) return false;
    return isMockVariantServed(variantId, req.mockVariants, req.activeMockVariantIds);
  }

  onVariantChanged(): void {
    void this.persistAndSync();
  }

  variantStatusClass(code: number | null | undefined): 'is-success' | 'is-warning' | 'is-error' | 'is-neutral' {
    if (!code) return 'is-neutral';
    if (code >= 500) return 'is-error';
    if (code >= 400) return 'is-warning';
    if (code >= 200 && code < 400) return 'is-success';
    return 'is-neutral';
  }

  private async persistAndSync(): Promise<void> {
    if (!this.selectedRequest) return;
    await this.collectionService.saveCollections(this.collections);
    await this.mockServer.syncRequest({
      id: this.selectedRequest.id,
      mockVariants: this.selectedRequest.mockVariants,
      activeMockVariantId: this.selectedRequest.activeMockVariantId,
      activeMockVariantIds: this.selectedRequest.activeMockVariantIds,
    });
    this.mockUi.setCollections(this.collections);
    this.cdr.markForCheck();
  }

  variantUrl(variantId: string): string {
    if (!this.selectedRequest) return '';
    return this.mockServer.mockUrl(this.selectedRequest.id, variantId);
  }

  /** Persists the active variant on whichever editor is open. */
  private commitActiveEditor(): void {
    if (this.selectionKind === 'standalone') void this.commitStandalone();
    else if (this.selectionKind === 'request') void this.persistAndSync();
  }

  /** Read the Content-Type header value (case-insensitive) from a variant. */
  private contentTypeOf(variant: VariantLike): string {
    const ct = (variant.headers || []).find((h) => (h.key || '').toLowerCase() === 'content-type');
    return (ct?.value || '').toLowerCase();
  }

  bodyTypeOf(variant: VariantLike): BodyType {
    if (!variant.body || variant.body.length === 0) {
      const ct = this.contentTypeOf(variant);
      if (!ct) return 'none';
    }
    const ct = this.contentTypeOf(variant);
    if (!ct) return 'custom';
    if (ct.includes('application/json') || ct.endsWith('+json')) return 'json';
    if (ct.includes('xml')) return 'xml';
    if (ct.includes('html')) return 'html';
    if (ct.includes('application/graphql')) return 'graphql';
    if (ct.includes('multipart/form-data')) return 'formdata';
    if (ct.includes('x-www-form-urlencoded')) return 'urlencoded';
    if (ct.includes('application/octet-stream')) return 'binary';
    if (ct.startsWith('text/')) return 'text';
    return 'custom';
  }

  /**
   * Switch a variant's body type. We rewrite the Content-Type header to a
   * sensible default and seed an empty body with a stub so the user has
   * something to edit. "Custom" leaves the header alone so power users can
   * manage it manually via the headers grid.
   */
  setBodyType(variant: VariantLike, type: BodyType): void {
    const headers = (variant.headers || []).filter((h) => (h.key || '').toLowerCase() !== 'content-type');
    if (type === 'none') {
      variant.body = '';
      variant.headers = headers;
    } else if (type === 'custom') {
      variant.headers = headers; 
    } else {
      const value = BODY_TYPE_HEADERS[type];
      headers.unshift({ key: 'Content-Type', value });
      variant.headers = headers;
      if (!variant.body) variant.body = BODY_TYPE_STUBS[type];
    }
    this.commitActiveEditor();
  }

  bodyPlaceholder(variant: VariantLike): string {
    switch (this.bodyTypeOf(variant)) {
      case 'json': return '{ "example": true }';
      case 'xml':  return '<root>example</root>';
      case 'html': return '<p>Hello</p>';
      case 'graphql': return 'query { viewer { id } }';
      case 'formdata': return 'field=value';
      case 'urlencoded': return 'key=value';
      case 'binary': return '[binary data]';
      case 'text': return 'Plain text response';
      case 'none': return '(empty body)';
      default:     return 'Response body';
    }
  }

  responseEditorLanguage(variant: VariantLike): EditorLanguage {
    const type = this.bodyTypeOf(variant);
    if (type === 'json') return 'json';
    if (type === 'xml') return 'xml';
    if (type === 'html') return 'html';
    if (type === 'graphql') return 'graphql';
    return 'plain';
  }

  isBinaryBodyType(variant: VariantLike): boolean {
    return this.bodyTypeOf(variant) === 'binary';
  }

  async pickResponseBinaryFile(variant: VariantLike, context: 'request' | 'standalone'): Promise<void> {
    const picked = await window.awElectron.pickFilePath();
    if (!picked?.path) return;
    variant.body = picked.path;
    if (context === 'standalone') {
      this.onStandaloneFieldChange();
    } else {
      this.onVariantChanged();
    }
  }

  clearResponseBinaryFile(variant: VariantLike, context: 'request' | 'standalone'): void {
    variant.body = '';
    if (context === 'standalone') {
      this.onStandaloneFieldChange();
    } else {
      this.onVariantChanged();
    }
  }

  isHeadersOpen(variantId: string): boolean {
    return this.headersOpen.has(variantId);
  }

  isVariantDetailsOpen(variantId: string): boolean {
    return this.variantDetailsOpen.has(variantId);
  }

  toggleVariantDetails(variantId: string): void {
    if (this.variantDetailsOpen.has(variantId)) this.variantDetailsOpen.delete(variantId);
    else this.variantDetailsOpen.add(variantId);
    this.persistMockServerSession();
    this.cdr.markForCheck();
  }

  onVariantHeadClick(variantId: string, event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (
      target?.closest(
        'input, textarea, select, button, a, label, .dropdown-trigger, .variant-served, .variant-actions, .variant-field, .variant-name',
      )
    ) {
      return;
    }
    this.toggleVariantDetails(variantId);
  }

  toggleHeaders(variantId: string): void {
    if (this.headersOpen.has(variantId)) this.headersOpen.delete(variantId);
    else this.headersOpen.add(variantId);
    this.persistMockServerSession();
    this.cdr.markForCheck();
  }

  trackByHeaderIndex = (i: number) => i;

  addHeader(variant: VariantLike): void {
    const list = (variant.headers || []).slice();
    list.push({ key: '', value: '' });
    variant.headers = list;
    this.commitActiveEditor();
  }

  removeHeader(variant: VariantLike, index: number): void {
    if (!variant.headers) return;
    const next = variant.headers.slice();
    next.splice(index, 1);
    variant.headers = next;
    this.commitActiveEditor();
  }

  /** Bound to header (ngModelChange) — keeps things terse in the template. */
  onHeaderChanged(): void {
    this.commitActiveEditor();
  }

  async startServer(): Promise<void> {
    const port = this.parsedPort();
    if (port != null) {
      await this.mockServer.setOptions({ port });
    } else {
      await this.mockServer.setOptions({ port: null });
    }
    await this.mockServer.start(port ?? undefined);
  }

  async stopServer(): Promise<void> {
    await this.mockServer.stop();
  }

  async restartServer(): Promise<void> {
    const port = this.parsedPort();
    await this.mockServer.setOptions({ port });
    await this.mockServer.restart();
  }

  private parsedPort(): number | null {
    const trimmed = String(this.portInput ?? '').trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    if (!Number.isFinite(num) || num < 1 || num > 65535) return null;
    return Math.floor(num);
  }

  async resetAllVariants(): Promise<void> {
    const ok = await this.confirmDialog.confirm({
      title: 'Unregister variants',
      message:
        'Unregister every mock variant from the server? Your saved variants on requests are not deleted.',
      destructive: true,
      confirmLabel: 'Unregister all',
    });
    if (!ok) return;
    await this.mockServer.clearAll();
  }

  async copyValue(text: string, key: string = 'baseUrl'): Promise<void> {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.copied = key;
      setTimeout(() => {
        if (this.copied === key) {
          this.copied = null;
          this.cdr.markForCheck();
        }
      }, 1200);
      this.cdr.markForCheck();
    } catch { /* ignore */ }
  }

  onActivityMethodFilter(v: string | null | undefined): void {
    this.methodFilter = v ?? '';
    this.persistMockServerSession();
    this.cdr.markForCheck();
  }

  onActivityStatusFilter(v: string | null | undefined): void {
    this.statusFilter = (v || '') as typeof this.statusFilter;
    this.persistMockServerSession();
    this.cdr.markForCheck();
  }

  onHitFilterChange(): void {
    this.persistMockServerSession();
  }

  filteredHits(): MockHit[] {
    const filter = this.hitFilter.trim().toLowerCase();
    return this.hits.filter((h) => {
      if (this.methodFilter && h.method !== this.methodFilter) return false;
      if (this.statusFilter) {
        const bucket = this.statusBucket(h.status);
        if (bucket !== this.statusFilter) return false;
      }
      if (filter && !h.path.toLowerCase().includes(filter)) return false;
      return true;
    }).slice().reverse();
  }

  statusBucket(status: number): '' | '2xx' | '3xx' | '4xx' | '5xx' {
    if (status >= 200 && status < 300) return '2xx';
    if (status >= 300 && status < 400) return '3xx';
    if (status >= 400 && status < 500) return '4xx';
    if (status >= 500 && status < 600) return '5xx';
    return '';
  }

  hitStatusClass(status: number): string {
    const bucket = this.statusBucket(status);
    if (bucket === '2xx') return 'is-success';
    if (bucket === '3xx') return 'is-info';
    if (bucket === '4xx') return 'is-warning';
    if (bucket === '5xx') return 'is-error';
    return '';
  }

  toggleHit(hit: MockHit): void {
    this.expandedHitId = this.expandedHitId === hit.id ? null : hit.id;
    this.persistMockServerSession();
    this.cdr.markForCheck();
  }

  async clearHits(): Promise<void> {
    await this.mockServer.clearHits();
  }

  async exportHits(): Promise<void> {
    const data = JSON.stringify(this.hits, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mock-hits-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  formatTime(ms: number): string {
    return formatTimestampForUi(ms, 'mediumTime');
  }

  /** Reconstructs a raw-style HTTP request for the activity log. */
  formatFullRequest(hit: MockHit): string {
    const pathQ = (hit.path || '/').split('?');
    const pathLine = pathQ[0] + (pathQ[1] != null && pathQ[1] !== '' ? `?${pathQ[1]}` : '');
    const first = `${hit.method} ${pathLine} HTTP/1.1`;
    const hdrs = (hit.reqHeaders || [])
      .map((h) => `${h.key}: ${h.value}`)
      .join('\n');
    if (hdrs) {
      if (hit.reqBody == null || hit.reqBody === '') {
        return `${first}\n${hdrs}`;
      }
      return `${first}\n${hdrs}\n\n${hit.reqBody}`;
    }
    if (hit.reqBody != null && hit.reqBody !== '') {
      return `${first}\n\n${hit.reqBody}`;
    }
    return first;
  }

  /** HTTP method enum -> readable token (`GET`, `POST`, …). */
  methodLabel(request: RequestModel | null | undefined): string {
    if (!request) return '';
    const value = request.httpMethod as unknown;
    if (typeof value === 'number') return HttpMethod[value] || '';
    return String(value || '');
  }
}
