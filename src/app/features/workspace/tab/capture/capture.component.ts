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
import { v4 as uuidv4 } from 'uuid';
import { CollectionService } from '@core/collection/collection.service';
import { RequestService } from '@core/http/request.service';
import { TabItem, TabType } from '@core/tabs/tab.service';
import type { CaptureSessionEntry } from '@models/electron';
import { AuthType, HttpMethod, type Request } from '@models/request';
// import type { ReleaseSuiteStep } from '@models/testing/test-suite';
import {
  DropdownComponent,
  type DropdownOption,
} from '@features/workspace/shared/dropdown/dropdown.component';

/** Same defaults as the collection sidebar when creating a request. */
const DEFAULT_REQUEST_HEADERS = [
  { key: 'Content-Type', value: 'application/json', description: '', enabled: true },
  { key: 'Accept', value: 'application/json', description: '', enabled: true },
];

export type CaptureListFilterScope = 'all' | 'url' | 'path' | 'method' | 'status' | 'type' | 'headers';

/** DevTools Network-style bucket over Electron/Chromium `resourceType` (case-insensitive). */
export type CaptureResourceCategory =
  | 'all'
  | 'fetch-xhr'
  | 'document'
  | 'stylesheet'
  | 'script'
  | 'image'
  | 'font'
  | 'media'
  | 'manifest'
  | 'websocket'
  | 'other';

/** Types that belong to named filters — everything else (incl. empty) is "Other". */
const NON_OTHER_RESOURCE_TYPES = new Set([
  'xhr',
  'mainframe',
  'subframe',
  'stylesheet',
  'script',
  'image',
  'font',
  'media',
  'manifest',
  'websocket',
]);

@Component({
  selector: 'app-capture',
  standalone: true,
  imports: [CommonModule, FormsModule, DropdownComponent],
  templateUrl: './capture.component.html',
  styleUrls: ['./capture.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CaptureComponent implements OnInit, OnDestroy {
  @Input({ required: true }) tab!: TabItem;

  initialUrl = 'https://example.com';
  entries: CaptureSessionEntry[] = [];
  /** Substring filter for the table (client-side). */
  listFilterText = '';
  listFilterScope: CaptureListFilterScope = 'all';
  /** Preset resource bucket (composes with text filter). */
  listResourceCategory: CaptureResourceCategory = 'all';

  readonly resourceCategoryOptions: DropdownOption[] = [
    { label: 'All', value: 'all' },
    { label: 'Fetch / XHR', value: 'fetch-xhr' },
    { label: 'Document', value: 'document' },
    { label: 'CSS', value: 'stylesheet' },
    { label: 'JS', value: 'script' },
    { label: 'Image', value: 'image' },
    { label: 'Font', value: 'font' },
    { label: 'Media', value: 'media' },
    { label: 'Manifest', value: 'manifest' },
    { label: 'WebSocket', value: 'websocket' },
    { label: 'Other', value: 'other' },
  ];

  readonly listFilterScopeOptions: DropdownOption[] = [
    { label: 'Everything', value: 'all' },
    { label: 'Full URL', value: 'url' },
    { label: 'Path & query', value: 'path' },
    { label: 'Method', value: 'method' },
    { label: 'Status code', value: 'status' },
    { label: 'Resource type', value: 'type' },
    { label: 'Headers', value: 'headers' },
  ];

  active = false;
  /** Last error from start/stop IPC. */
  bridgeError: string | null = null;
  /** Row id showing detail panel. */
  expandedId: string | null = null;
  copyDoneId: string | null = null;
  private copyDoneTimer: ReturnType<typeof setTimeout> | null = null;

  private unsubEntry: (() => void) | null = null;
  private unsubStopped: (() => void) | null = null;

  constructor(
    private cdr: ChangeDetectorRef,
    private collectionService: CollectionService,
    private requestService: RequestService,
  ) {}

  get captureSupported(): boolean {
    return typeof window !== 'undefined' && !!window.awElectron?.captureStart;
  }

  get captureClearSupported(): boolean {
    return typeof window !== 'undefined' && !!window.awElectron?.captureClear;
  }

  get hasCollections(): boolean {
    return this.collectionService.getCollections().length > 0;
  }

  ngOnInit(): void {
    void this.refreshFromMain();
    const api = window.awElectron;
    if (api?.onCaptureEntry) {
      this.unsubEntry = api.onCaptureEntry((entry) => {
        this.entries = [...this.entries, entry];
        this.syncExpandedWithFilter();
        this.cdr.markForCheck();
      });
    }
    if (api?.onCaptureStopped) {
      this.unsubStopped = api.onCaptureStopped(() => {
        this.active = false;
        void this.refreshFromMain();
        this.cdr.markForCheck();
      });
    }
  }

  ngOnDestroy(): void {
    this.unsubEntry?.();
    this.unsubStopped?.();
    if (this.copyDoneTimer) clearTimeout(this.copyDoneTimer);
  }

  async refreshFromMain(): Promise<void> {
    const api = window.awElectron;
    if (!api?.captureStatus || !api.captureList) return;
    try {
      const st = await api.captureStatus();
      this.active = st.active;
      this.entries = await api.captureList();
      this.bridgeError = null;
    } catch {
      this.bridgeError = 'Could not read capture status.';
    }
    this.syncExpandedWithFilter();
    this.cdr.markForCheck();
  }

  get filteredEntries(): CaptureSessionEntry[] {
    let list = this.entries.filter((e) => entryMatchesResourceCategory(e, this.listResourceCategory));
    const q = (this.listFilterText || '').trim().toLowerCase();
    if (!q) return list;
    return list.filter((e) => this.entryMatchesFilter(e, q));
  }

  /** True when text filter, resource preset, or both narrow the list. */
  get hasAnyListFilter(): boolean {
    return !!(this.listFilterText || '').trim() || this.listResourceCategory !== 'all';
  }

  onListFilterChange(): void {
    this.syncExpandedWithFilter();
    this.cdr.markForCheck();
  }

  onListFilterScopeChange(): void {
    this.syncExpandedWithFilter();
    this.cdr.markForCheck();
  }

  onListResourceCategoryChange(): void {
    this.syncExpandedWithFilter();
    this.cdr.markForCheck();
  }

  onResourceCategoryDropdownSelect(value: CaptureResourceCategory): void {
    this.listResourceCategory = value;
    this.onListResourceCategoryChange();
  }

  onListFilterScopeDropdownSelect(value: CaptureListFilterScope): void {
    this.listFilterScope = value;
    this.onListFilterScopeChange();
  }

  clearListFilter(): void {
    this.listFilterText = '';
    this.listResourceCategory = 'all';
    this.onListFilterChange();
  }

  /** Drop every row from the main-process log and reset local filters. */
  async clearCapturedRequests(): Promise<void> {
    this.bridgeError = null;
    const api = window.awElectron;
    if (!api?.captureClear) {
      this.bridgeError = 'Clear requests requires the desktop app.';
      this.cdr.markForCheck();
      return;
    }
    if (!this.entries.length) return;
    try {
      const res = await api.captureClear();
      if (!res?.ok) {
        this.bridgeError = res?.error || 'Could not clear captured requests.';
        this.cdr.markForCheck();
        return;
      }
      this.clearListFilter();
      this.expandedId = null;
      this.copyDoneId = null;
      await this.refreshFromMain();
    } catch {
      this.bridgeError = 'Could not clear captured requests.';
    }
    this.cdr.markForCheck();
  }

  private syncExpandedWithFilter(): void {
    if (!this.expandedId) return;
    if (!this.filteredEntries.some((e) => e.id === this.expandedId)) {
      this.expandedId = null;
    }
  }

  private entryMatchesFilter(e: CaptureSessionEntry, q: string): boolean {
    switch (this.listFilterScope) {
      case 'url':
        return (e.url || '').toLowerCase().includes(q);
      case 'path':
        return capturePathAndQuery(e.url).toLowerCase().includes(q);
      case 'method':
        return (e.method || '').toLowerCase().includes(q);
      case 'status':
        return String(e.statusCode ?? '').includes(q);
      case 'type':
        return (e.resourceType || '').toLowerCase().includes(q);
      case 'headers':
        return (
          headersHaystack(e.requestHeaders).includes(q) || headersHaystack(e.responseHeaders).includes(q)
        );
      case 'all':
      default:
        return fullHaystack(e).includes(q);
    }
  }

  async start(): Promise<void> {
    this.bridgeError = null;
    const api = window.awElectron;
    if (!api?.captureStart) {
      this.bridgeError = 'Capture is only available in the desktop app.';
      this.cdr.markForCheck();
      return;
    }
    const url = (this.initialUrl || '').trim();
    const res = await api.captureStart(url ? { initialUrl: url } : {});
    if (!res.ok) {
      this.bridgeError = res.error || 'Start failed';
      this.active = false;
    } else {
      this.active = true;
    }
    await this.refreshFromMain();
    this.cdr.markForCheck();
  }

  async stop(): Promise<void> {
    this.bridgeError = null;
    const api = window.awElectron;
    if (!api?.captureStop) return;
    await api.captureStop();
    this.active = false;
    await this.refreshFromMain();
    this.cdr.markForCheck();
  }

  toggleExpand(entry: CaptureSessionEntry): void {
    this.expandedId = this.expandedId === entry.id ? null : entry.id;
    this.cdr.markForCheck();
  }

  isExpanded(entry: CaptureSessionEntry): boolean {
    return this.expandedId === entry.id;
  }

  async openAsRequestTab(entry: CaptureSessionEntry): Promise<void> {
    this.bridgeError = null;
    const collections = this.collectionService.getCollections();
    if (!collections.length) {
      this.bridgeError = 'Add a collection first, then capture a request to open it in the editor.';
      this.cdr.markForCheck();
      return;
    }
    const newRequest = this.buildCollectionRequestFromCapture(entry);
    const first = collections[0];
    const nextRequests = [...(first.requests || []), newRequest];
    const nextCollections = collections.map((c, i) =>
      i === 0 ? { ...c, requests: nextRequests } : c,
    );
    try {
      await this.collectionService.saveCollections(nextCollections);
      await this.collectionService.flushPendingSaves();
    } catch {
      this.bridgeError = 'Could not save the new request to your workspace.';
      this.cdr.markForCheck();
      return;
    }
    const tabItem: TabItem = {
      id: newRequest.id,
      title: newRequest.title,
      type: TabType.REQUEST,
    };
    await this.requestService.selectRequest(tabItem);
    this.cdr.markForCheck();
  }

  async copyRequestStep(entry: CaptureSessionEntry): Promise<void> {
    const step = this.buildRequestStep(entry);
    const json = JSON.stringify(step, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      this.copyDoneId = entry.id;
      if (this.copyDoneTimer) clearTimeout(this.copyDoneTimer);
      this.copyDoneTimer = setTimeout(() => {
        this.copyDoneId = null;
        this.cdr.markForCheck();
      }, 2000);
    } catch {
      this.bridgeError = 'Clipboard not available.';
    }
    this.cdr.markForCheck();
  }

  private buildRequestStep(entry: CaptureSessionEntry): any {
    const headers = (entry.requestHeaders || [])
      .filter((h) => h.key && h.value !== undefined)
      .map((h) => ({ key: h.key, value: h.value }));
    const method = (entry.method || 'GET').toUpperCase();
    const title = `${method} ${truncateUrl(entry.url, 48)}`;
    const rb = (entry.requestBody ?? '').trim();
    const step: any = {
      id: uuidv4(),
      kind: 'request',
      title,
      target: {
        kind: 'inline',
        method,
        url: entry.url,
        headers: headers.length ? headers : undefined,
        ...(rb !== '' ? { body: entry.requestBody ?? '' } : {}),
      },
      assignResponseTo: 'response',
    };
    return step;
  }

  private buildCollectionRequestFromCapture(entry: CaptureSessionEntry): Request {
    const httpMethod = parseHttpMethod(entry.method);
    const url = (entry.url || '').trim() || '/';
    const titleBase = `${(entry.method || 'GET').toUpperCase()} ${truncateUrl(entry.url, 56)}`.trim() || 'Captured request';
    const headersFromCapture = (entry.requestHeaders || [])
      .filter((h) => h.key && h.value !== undefined && String(h.key).trim() !== '')
      .map((h) => ({
        key: h.key.trim(),
        value: h.value,
        description: '',
        enabled: true,
      }));
    const httpHeaders =
      headersFromCapture.length > 0 ? headersFromCapture : [...DEFAULT_REQUEST_HEADERS];
    const rb = (entry.requestBody ?? '').trim();
    return {
      id: uuidv4(),
      title: titleBase.length > 120 ? titleBase.slice(0, 119) + '…' : titleBase,
      url,
      httpMethod,
      httpHeaders,
      requestBody: rb !== '' ? (entry.requestBody ?? '') : '{}',
      script: { preRequest: '', postRequest: '' },
      auth: { type: AuthType.NONE },
      settings: { followRedirects: true, useCookies: true },
    };
  }

  trackById = (_: number, e: CaptureSessionEntry) => e.id;

  formatHeaders(headers: Array<{ key: string; value: string }> | undefined): string {
    if (!headers?.length) return '—';
    return headers.map((h) => `${h.key}: ${h.value}`).join('\n');
  }

  formatSize(e: CaptureSessionEntry): string {
    const n = new Blob([e.body ?? '']).size;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  hasCapturedRequestBody(e: CaptureSessionEntry): boolean {
    return !!(e.requestBody && e.requestBody.trim()) || !!e.requestBodyTruncated;
  }
}

function normalizeResourceType(rt: string | undefined): string {
  return (rt || '').trim().toLowerCase();
}

function entryMatchesResourceCategory(
  e: CaptureSessionEntry,
  category: CaptureResourceCategory,
): boolean {
  if (category === 'all') return true;
  const t = normalizeResourceType(e.resourceType);
  if (category === 'other') {
    return !NON_OTHER_RESOURCE_TYPES.has(t);
  }
  switch (category) {
    case 'fetch-xhr':
      return t === 'xhr';
    case 'document':
      return t === 'mainframe' || t === 'subframe';
    case 'stylesheet':
      return t === 'stylesheet';
    case 'script':
      return t === 'script';
    case 'image':
      return t === 'image';
    case 'font':
      return t === 'font';
    case 'media':
      return t === 'media';
    case 'manifest':
      return t === 'manifest';
    case 'websocket':
      return t === 'websocket';
    default:
      return true;
  }
}

function truncateUrl(url: string, max: number): string {
  if (!url || url.length <= max) return url || '';
  return url.slice(0, max - 1) + '…';
}

function parseHttpMethod(raw: string | undefined): HttpMethod {
  const m = (raw || 'GET').toUpperCase();
  const map: Record<string, HttpMethod> = {
    GET: HttpMethod.GET,
    POST: HttpMethod.POST,
    PUT: HttpMethod.PUT,
    PATCH: HttpMethod.PATCH,
    DELETE: HttpMethod.DELETE,
    HEAD: HttpMethod.HEAD,
    OPTIONS: HttpMethod.OPTIONS,
  };
  return map[m] ?? HttpMethod.GET;
}

/** Path + query + hash (no scheme/host), best-effort for non-absolute URLs. */
function capturePathAndQuery(url: string): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    const i = url.indexOf('://');
    if (i !== -1) {
      const rest = url.slice(i + 3);
      const slash = rest.indexOf('/');
      return slash === -1 ? '/' : rest.slice(slash);
    }
    return url;
  }
}

function headersHaystack(headers: Array<{ key: string; value: string }> | undefined): string {
  if (!headers?.length) return '';
  return headers.map((h) => `${h.key}:${h.value}`).join('\n').toLowerCase();
}

function fullHaystack(e: CaptureSessionEntry): string {
  return [
    e.url,
    capturePathAndQuery(e.url),
    e.method,
    String(e.statusCode ?? ''),
    e.resourceType ?? '',
    e.body ?? '',
    e.requestBody ?? '',
    headersHaystack(e.requestHeaders),
    headersHaystack(e.responseHeaders),
  ]
    .join('\n')
    .toLowerCase();
}
