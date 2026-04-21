import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { MockVariant, Request as RequestModel } from '../../shared/request';
import type {
  MockHit,
  MockServerOptions,
  MockServerStatus,
  StandaloneMockEndpoint,
  StandaloneMockEndpointInput,
} from '../../shared/electron';

const DEFAULT_STATUS: MockServerStatus = {
  host: '127.0.0.1',
  port: 0,
  status: 'stopped',
  error: null,
  baseUrl: '',
  registered: [],
  standalone: [],
};

const DEFAULT_OPTIONS: MockServerOptions = {
  port: null,
  bindAddress: '127.0.0.1',
  defaultDelayMs: 0,
  defaultContentType: 'application/json; charset=utf-8',
  corsMode: 'all',
  corsOrigins: [],
  autoStart: false,
  captureBodies: true,
};

const MAX_BUFFERED_HITS = 500;

/**
 * Thin facade around the main-process mock server. The renderer treats it as
 * a singleton that can be started, stopped, and kept in sync with each
 * request's mock variant list.
 *
 * Hits served by the mock server are streamed in over a single IPC channel
 * (`mock:hits`) and exposed as an observable rolling buffer so any consumer
 * (the Mock Server tab activity feed, future debugger panels) can subscribe
 * without re-subscribing to IPC events themselves.
 */
@Injectable({ providedIn: 'root' })
export class MockServerService {
  private readonly status$ = new BehaviorSubject<MockServerStatus>(DEFAULT_STATUS);
  private readonly options$ = new BehaviorSubject<MockServerOptions>(DEFAULT_OPTIONS);
  private readonly hits$ = new BehaviorSubject<MockHit[]>([]);
  private hitUnsubscribe: (() => void) | null = null;

  constructor(private zone: NgZone) {
    this.attachHitListener();
  }

  private get api() {
    return (typeof window !== 'undefined' ? (window as any).awElectron : null) || null;
  }

  /**
   * Re-enter Angular's zone before pushing onto the BehaviorSubjects.
   *
   * The Electron preload bridge isn't zone-patched, so promises returned
   * from `ipcRenderer.invoke` resolve outside NgZone. Without this, OnPush
   * subscribers (the Mock Server tab) only see status updates on the *next*
   * user interaction — manifesting as "I have to click Start twice".
   */
  private inZone(fn: () => void): void {
    if (NgZone.isInAngularZone()) fn();
    else this.zone.run(fn);
  }

  private attachHitListener(): void {
    if (!this.api?.onMockHits || this.hitUnsubscribe) return;
    this.hitUnsubscribe = this.api.onMockHits((batch: MockHit[]) => {
      if (!Array.isArray(batch) || batch.length === 0) return;
      this.zone.run(() => {
        const merged = this.hits$.value.concat(batch);
        const trimmed = merged.length > MAX_BUFFERED_HITS
          ? merged.slice(merged.length - MAX_BUFFERED_HITS)
          : merged;
        this.hits$.next(trimmed);
      });
    });
  }

  get currentStatus(): MockServerStatus {
    return this.status$.value;
  }

  statusChanges(): Observable<MockServerStatus> {
    return this.status$.asObservable();
  }

  async refreshStatus(): Promise<MockServerStatus> {
    if (!this.api?.mockStatus) return this.currentStatus;
    try {
      const s = await this.api.mockStatus();
      this.inZone(() => {
        if (s) this.status$.next(s);
        if (s?.options) this.options$.next(s.options);
      });
      return s || this.currentStatus;
    } catch {
      return this.currentStatus;
    }
  }

  async start(port?: number): Promise<MockServerStatus> {
    if (!this.api?.mockStart) return this.currentStatus;
    try {
      const s = await this.api.mockStart(port);
      this.inZone(() => {
        if (s) this.status$.next(s);
        if (s?.options) this.options$.next(s.options);
      });
      return s || this.currentStatus;
    } catch {
      return this.currentStatus;
    }
  }

  async stop(): Promise<MockServerStatus> {
    if (!this.api?.mockStop) return this.currentStatus;
    try {
      const s = await this.api.mockStop();
      this.inZone(() => { if (s) this.status$.next(s); });
      return s || this.currentStatus;
    } catch {
      return this.currentStatus;
    }
  }

  async restart(): Promise<MockServerStatus> {
    if (!this.api?.mockRestart) return this.currentStatus;
    try {
      const s = await this.api.mockRestart();
      this.inZone(() => {
        if (s) this.status$.next(s);
        if (s?.options) this.options$.next(s.options);
      });
      return s || this.currentStatus;
    } catch {
      return this.currentStatus;
    }
  }

  get currentOptions(): MockServerOptions {
    return this.options$.value;
  }

  optionsChanges(): Observable<MockServerOptions> {
    return this.options$.asObservable();
  }

  async refreshOptions(): Promise<MockServerOptions> {
    if (!this.api?.mockGetOptions) return this.currentOptions;
    try {
      const opts = await this.api.mockGetOptions();
      this.inZone(() => { if (opts) this.options$.next(opts); });
      return opts || this.currentOptions;
    } catch {
      return this.currentOptions;
    }
  }

  async setOptions(partial: Partial<MockServerOptions>): Promise<MockServerOptions> {
    if (!this.api?.mockSetOptions) return this.currentOptions;
    try {
      const result = await this.api.mockSetOptions(partial);
      if (result?.options) {
        const next = result.options;
        this.inZone(() => this.options$.next(next));
        return next;
      }
      return this.currentOptions;
    } catch {
      return this.currentOptions;
    }
  }

  /**
   * Push a request's mock variant set to the server. Safe to call even when
   * the server isn't running — registrations are kept in-memory and served
   * once start() succeeds.
   */
  async syncRequest(request: Pick<RequestModel, 'id' | 'mockVariants' | 'activeMockVariantId'>): Promise<void> {
    if (!this.api?.mockRegister) return;
    if (!request || !request.id) return;
    const variants = request.mockVariants || [];
    try {
      if (variants.length === 0) {
        await this.api.mockUnregister(request.id);
      } else {
        await this.api.mockRegister({
          requestId: request.id,
          variants: variants.map((v: MockVariant) => ({
            id: v.id,
            name: v.name,
            statusCode: v.statusCode,
            statusText: v.statusText,
            headers: v.headers || [],
            body: v.body || '',
            delayMs: v.delayMs || 0,
            matchOn: v.matchOn,
          })),
          activeVariantId: request.activeMockVariantId,
        });
      }
    } catch {
    }
    void this.refreshStatus();
  }

  async clearAll(): Promise<void> {
    if (!this.api?.mockClear) return;
    try {
      await this.api.mockClear();
    } catch {
    }
    void this.refreshStatus();
  }

  mockUrl(requestId: string, variantId?: string): string {
    const base = this.currentStatus.baseUrl;
    if (!base) return '';
    const suffix = variantId ? `/${encodeURIComponent(variantId)}` : '';
    return `${base}/mock/${encodeURIComponent(requestId)}${suffix}`;
  }

  async listStandalone(): Promise<StandaloneMockEndpoint[]> {
    if (!this.api?.mockStandaloneList) return [];
    try {
      return (await this.api.mockStandaloneList()) || [];
    } catch {
      return [];
    }
  }

  async registerStandalone(endpoint: StandaloneMockEndpointInput): Promise<StandaloneMockEndpoint | null> {
    if (!this.api?.mockStandaloneRegister) return null;
    try {
      const result = await this.api.mockStandaloneRegister(endpoint);
      void this.refreshStatus();
      return result?.endpoint || null;
    } catch {
      return null;
    }
  }

  async unregisterStandalone(id: string): Promise<boolean> {
    if (!this.api?.mockStandaloneUnregister) return false;
    try {
      const result = await this.api.mockStandaloneUnregister(id);
      void this.refreshStatus();
      return !!result?.ok;
    } catch {
      return false;
    }
  }

  hits(): Observable<MockHit[]> {
    return this.hits$.asObservable();
  }

  get currentHits(): MockHit[] {
    return this.hits$.value;
  }

  async refreshHits(): Promise<MockHit[]> {
    if (!this.api?.mockHitsList) return this.currentHits;
    try {
      const list = (await this.api.mockHitsList()) || [];
      this.inZone(() => this.hits$.next(list));
      return list;
    } catch {
      return this.currentHits;
    }
  }

  async clearHits(): Promise<void> {
    if (!this.api?.mockHitsClear) {
      this.inZone(() => this.hits$.next([]));
      return;
    }
    try {
      await this.api.mockHitsClear();
    } finally {
      this.inZone(() => this.hits$.next([]));
    }
  }
}
