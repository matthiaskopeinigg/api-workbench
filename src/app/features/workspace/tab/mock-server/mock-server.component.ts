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
import { Subject, takeUntil } from 'rxjs';

import { TabItem } from '@core/tab.service';
import { CollectionService } from '@core/collection.service';
import { MockServerService } from '@core/mock-server.service';
import { Collection, Folder } from '@models/collection';
import { HttpMethod, MockVariant, Request as RequestModel } from '@models/request';
import type {
  MockHit,
  MockServerOptions,
  MockServerStatus,
  StandaloneMockEndpoint,
} from '@models/electron';
import { v4 as uuidv4 } from 'uuid';

interface EndpointGroup {
  collectionId: string;
  collectionTitle: string;
  entries: EndpointEntry[];
}

interface EndpointEntry {
  request: RequestModel;
  parentLabel: string;
  variantCount: number;
  activeVariantId: string | null;
  isRegistered: boolean;
}

type SelectionKind = 'request' | 'standalone' | null;

const STANDALONE_METHODS: ReadonlyArray<string> = [
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD',
];

/**
 * Body-type sugar layered on top of the underlying header list. The mock
 * variant model only stores raw `headers` + `body`, so we infer the type
 * from the Content-Type and re-write that header when the user picks a
 * different one.
 */
type BodyType = 'json' | 'xml' | 'html' | 'text' | 'form' | 'none' | 'custom';

const BODY_TYPE_HEADERS: Record<Exclude<BodyType, 'none' | 'custom'>, string> = {
  json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  html: 'text/html; charset=utf-8',
  text: 'text/plain; charset=utf-8',
  form: 'application/x-www-form-urlencoded',
};

const BODY_TYPE_STUBS: Record<Exclude<BodyType, 'none' | 'custom'>, string> = {
  json: '{\n  "ok": true\n}',
  xml: '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n  <ok>true</ok>\n</root>',
  html: '<!doctype html>\n<html>\n  <body>Hello</body>\n</html>',
  text: 'Hello',
  form: 'key=value',
};

/** Anything that has a header list + body — covers MockVariant and standalone variants. */
interface VariantLike {
  body?: string;
  headers?: Array<{ key: string; value: string }>;
}

@Component({
  selector: 'app-mock-server',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './mock-server.component.html',
  styleUrl: './mock-server.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MockServerComponent implements OnInit, OnDestroy {
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

  /** Form-bound port string (lets the user clear the field for "auto"). */
  portInput = '';
  showAdvanced = false;
  copied: 'baseUrl' | string | null = null;

  groups: EndpointGroup[] = [];
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
  selectionKind: SelectionKind = null;
  readonly methodOptions = STANDALONE_METHODS;
  readonly bodyTypeOptions: ReadonlyArray<BodyType> = [
    'json', 'xml', 'html', 'text', 'form', 'none', 'custom',
  ];

  hits: MockHit[] = [];
  hitFilter = '';
  methodFilter = '';
  statusFilter: '' | '2xx' | '3xx' | '4xx' | '5xx' = '';
  expandedHitId: string | null = null;

  /** Variant ids whose response-headers editor is currently expanded. */
  private headersOpen = new Set<string>();

  private destroy$ = new Subject<void>();
  private collections: Collection[] = [];

  constructor(
    private collectionService: CollectionService,
    private mockServer: MockServerService,
    private cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    this.collectionService
      .getCollectionsObservable()
      .pipe(takeUntil(this.destroy$))
      .subscribe((collections: Collection[]) => {
        this.collections = collections || [];
        this.rebuildGroups();
        this.refreshSelection();
        this.cdr.markForCheck();
      });

    this.mockServer
      .statusChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe((status) => {
        this.status = status;
        this.rebuildGroups();
        void this.refreshStandalones();
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
      this.mockServer.refreshStatus(),
      this.mockServer.refreshOptions(),
      this.mockServer.refreshHits(),
      this.refreshStandalones(),
    ]);
  }

  private async refreshStandalones(): Promise<void> {
    const list = await this.mockServer.listStandalone();
    this.standalones = list;
    if (this.selectedStandaloneId) {
      this.selectedStandalone =
        list.find((e) => e.id === this.selectedStandaloneId) || null;
      if (!this.selectedStandalone) {
        this.selectionKind = this.selectionKind === 'standalone' ? null : this.selectionKind;
        this.selectedStandaloneId = null;
      }
    }
    this.cdr.markForCheck();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private rebuildGroups(): void {
    const registeredIds = new Set(this.status.registered.map((r) => r.requestId));
    const groups: EndpointGroup[] = [];
    for (const collection of this.collections) {
      const entries: EndpointEntry[] = [];
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
    this.groups = groups;
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
    this.selectedRequestId = request.id;
    this.selectionKind = 'request';
    this.selectedStandaloneId = null;
    this.selectedStandalone = null;
    this.refreshSelection();
    this.cdr.markForCheck();
  }

  trackByStandalone = (_i: number, e: StandaloneMockEndpoint) => e.id;

  selectStandalone(endpoint: StandaloneMockEndpoint): void {
    this.selectedStandaloneId = endpoint.id;
    this.selectedStandalone = endpoint;
    this.selectionKind = 'standalone';
    this.selectedRequestId = null;
    this.selectedRequest = null;
    this.cdr.markForCheck();
  }

  /**
   * Create a new standalone endpoint with one default variant. The path is
   * derived from a counter so users can spam the button without manually
   * picking unique paths up-front.
   */
  async addStandalone(): Promise<void> {
    const used = new Set(this.standalones.map((s) => s.path));
    let path = '/mock/new';
    let n = 1;
    while (used.has(path)) {
      n += 1;
      path = `/mock/new-${n}`;
    }
    const variantId = uuidv4();
    const created = await this.mockServer.registerStandalone({
      method: 'GET',
      path,
      variants: [{
        id: variantId,
        name: 'Default',
        statusCode: 200,
        headers: [{ key: 'Content-Type', value: 'application/json' }],
        body: '{\n  "ok": true\n}',
        delayMs: 0,
      }],
      activeVariantId: variantId,
    });
    await this.refreshStandalones();
    if (created) this.selectStandalone(created);
  }

  async removeStandalone(endpoint: StandaloneMockEndpoint, evt?: MouseEvent): Promise<void> {
    if (evt) {
      evt.stopPropagation();
      evt.preventDefault();
    }
    const ok = window.confirm(`Delete standalone mock ${endpoint.method} ${endpoint.path}?`);
    if (!ok) return;
    await this.mockServer.unregisterStandalone(endpoint.id);
    if (this.selectedStandaloneId === endpoint.id) {
      this.selectedStandaloneId = null;
      this.selectedStandalone = null;
      if (this.selectionKind === 'standalone') this.selectionKind = null;
    }
    await this.refreshStandalones();
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
      })),
      activeVariantId: s.activeVariantId,
    });
    if (updated) this.selectedStandalone = updated;
    await this.refreshStandalones();
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
    if (!s.activeVariantId) s.activeVariantId = variant.id;
    void this.commitStandalone();
  }

  removeStandaloneVariant(index: number): void {
    const s = this.selectedStandalone;
    if (!s) return;
    const next = s.variants.slice();
    const [removed] = next.splice(index, 1);
    s.variants = next;
    if (removed && s.activeVariantId === removed.id) {
      s.activeVariantId = next[0]?.id || null;
    }
    void this.commitStandalone();
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
    };
    const next = s.variants.slice();
    next.splice(index + 1, 0, copy);
    s.variants = next;
    void this.commitStandalone();
  }

  setActiveStandaloneVariant(id: string): void {
    const s = this.selectedStandalone;
    if (!s) return;
    s.activeVariantId = id;
    void this.commitStandalone();
  }

  standaloneUrl(endpoint: StandaloneMockEndpoint | null): string {
    if (!endpoint || !this.status.baseUrl) return '';
    return `${this.status.baseUrl}${endpoint.path}`;
  }

  trackByEntry = (_i: number, e: EndpointEntry) => e.request.id;
  trackByGroup = (_i: number, g: EndpointGroup) => g.collectionId;
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
    if (!this.selectedRequest.activeMockVariantId) {
      this.selectedRequest.activeMockVariantId = variant.id;
    }
    void this.persistAndSync();
  }

  removeVariant(index: number): void {
    if (!this.selectedRequest?.mockVariants) return;
    const next = this.selectedRequest.mockVariants.slice();
    const [removed] = next.splice(index, 1);
    this.selectedRequest.mockVariants = next;
    if (removed && this.selectedRequest.activeMockVariantId === removed.id) {
      this.selectedRequest.activeMockVariantId = next[0]?.id;
    }
    void this.persistAndSync();
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
      matchOn: original.matchOn ? { ...original.matchOn } : undefined,
    };
    const next = this.selectedRequest.mockVariants.slice();
    next.splice(index + 1, 0, copy);
    this.selectedRequest.mockVariants = next;
    void this.persistAndSync();
  }

  setActiveVariant(id: string): void {
    if (!this.selectedRequest) return;
    this.selectedRequest.activeMockVariantId = id;
    void this.persistAndSync();
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
    });
    this.rebuildGroups();
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
    if (ct.includes('x-www-form-urlencoded')) return 'form';
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
      case 'form': return 'key=value';
      case 'text': return 'Plain text response';
      case 'none': return '(empty body)';
      default:     return 'Response body';
    }
  }

  isHeadersOpen(variantId: string): boolean {
    return this.headersOpen.has(variantId);
  }

  toggleHeaders(variantId: string): void {
    if (this.headersOpen.has(variantId)) this.headersOpen.delete(variantId);
    else this.headersOpen.add(variantId);
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
    const trimmed = (this.portInput || '').trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    if (!Number.isFinite(num) || num < 1 || num > 65535) return null;
    return Math.floor(num);
  }

  async setBindAddress(address: '127.0.0.1' | '0.0.0.0'): Promise<void> {
    if (address === '0.0.0.0' && this.options.bindAddress !== '0.0.0.0') {
      const ok = window.confirm(
        'Binding to 0.0.0.0 makes the mock server reachable from other devices on your network. Continue?',
      );
      if (!ok) return;
    }
    await this.mockServer.setOptions({ bindAddress: address });
    if (this.status.status === 'running') {
      await this.mockServer.restart();
    }
  }

  async onOptionChange<K extends keyof MockServerOptions>(key: K, value: MockServerOptions[K]): Promise<void> {
    await this.mockServer.setOptions({ [key]: value } as Partial<MockServerOptions>);
  }

  async resetAllVariants(): Promise<void> {
    const ok = window.confirm('Unregister every mock variant from the server? Your saved variants on requests are not deleted.');
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
    if (!ms) return '';
    const d = new Date(ms);
    return d.toLocaleTimeString();
  }

  toggleAdvanced(): void {
    this.showAdvanced = !this.showAdvanced;
    this.cdr.markForCheck();
  }

  totalRegistered(): number {
    const fromCollections = this.groups.reduce((sum, g) => sum + g.entries.length, 0);
    return fromCollections + this.standalones.length;
  }

  /** HTTP method enum -> readable token (`GET`, `POST`, …). */
  methodLabel(request: RequestModel | null | undefined): string {
    if (!request) return '';
    const value = request.httpMethod as unknown;
    if (typeof value === 'number') return HttpMethod[value] || '';
    return String(value || '');
  }
}
