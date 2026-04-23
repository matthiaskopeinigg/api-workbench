import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { MockServerComponent } from './mock-server.component';
import { CollectionService } from '@core/collection/collection.service';
import { MockServerService } from '@core/mock-server/mock-server.service';
import { ConfirmDialogService } from '@core/ui/confirm-dialog.service';
import { TabType, MOCK_SERVER_TAB_ID } from '@core/tabs/tab.service';
import type { MockServerStatus, MockServerOptions, StandaloneMockEndpoint, MockHit } from '@models/electron';

describe('MockServerComponent', () => {
  let fixture: ComponentFixture<MockServerComponent>;
  let component: MockServerComponent;

  let collections$: BehaviorSubject<any[]>;
  let status$: BehaviorSubject<MockServerStatus>;
  let options$: BehaviorSubject<MockServerOptions>;
  let hits$: BehaviorSubject<MockHit[]>;

  let collectionsSpy: jasmine.SpyObj<CollectionService>;
  let mockSpy: jasmine.SpyObj<MockServerService>;
  let confirmDialogSpy: jasmine.SpyObj<ConfirmDialogService>;

  const baseStatus: MockServerStatus = {
    host: '127.0.0.1', port: 0, status: 'stopped', error: null, baseUrl: '', registered: [], standalone: [],
  };
  const baseOptions: MockServerOptions = {
    port: null, bindAddress: '127.0.0.1', defaultDelayMs: 0,
    defaultContentType: 'application/json', corsMode: 'all', corsOrigins: [],
    autoStart: false, captureBodies: true,
  };

  beforeEach(async () => {
    try {
      sessionStorage.removeItem('aw.mockServer.sessionUi');
    } catch {
      // ignore
    }
    collections$ = new BehaviorSubject<any[]>([]);
    status$ = new BehaviorSubject(baseStatus);
    options$ = new BehaviorSubject(baseOptions);
    hits$ = new BehaviorSubject<MockHit[]>([]);

    collectionsSpy = jasmine.createSpyObj('CollectionService', ['getCollectionsObservable', 'saveCollections']);
    collectionsSpy.getCollectionsObservable.and.returnValue(collections$);
    collectionsSpy.saveCollections.and.resolveTo();

    mockSpy = jasmine.createSpyObj('MockServerService', [
      'statusChanges', 'optionsChanges', 'hits',
      'refreshStatus', 'refreshOptions', 'refreshHits',
      'listStandalone', 'registerStandalone', 'unregisterStandalone',
      'setOptions', 'start', 'stop', 'restart', 'clearAll', 'clearHits',
      'syncRequest', 'mockUrl',
    ]);
    mockSpy.statusChanges.and.returnValue(status$);
    mockSpy.optionsChanges.and.returnValue(options$);
    mockSpy.hits.and.returnValue(hits$);
    mockSpy.refreshStatus.and.resolveTo();
    mockSpy.refreshOptions.and.resolveTo();
    mockSpy.refreshHits.and.resolveTo();
    mockSpy.listStandalone.and.resolveTo([]);
    mockSpy.registerStandalone.and.callFake(async (e) => ({ ...e, id: (e as any).id || 'sa-1' } as any));
    mockSpy.unregisterStandalone.and.resolveTo();
    mockSpy.setOptions.and.resolveTo();
    mockSpy.start.and.resolveTo();
    mockSpy.stop.and.resolveTo();
    mockSpy.restart.and.resolveTo();
    mockSpy.clearAll.and.resolveTo();
    mockSpy.clearHits.and.resolveTo();
    mockSpy.syncRequest.and.resolveTo();
    mockSpy.mockUrl.and.returnValue('http://mock/x');

    confirmDialogSpy = jasmine.createSpyObj('ConfirmDialogService', ['confirm', 'alert']);
    confirmDialogSpy.confirm.and.resolveTo(true);
    confirmDialogSpy.alert.and.resolveTo();

    await TestBed.configureTestingModule({
      imports: [MockServerComponent],
      providers: [
        { provide: CollectionService,  useValue: collectionsSpy },
        { provide: MockServerService,  useValue: mockSpy },
        { provide: ConfirmDialogService, useValue: confirmDialogSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MockServerComponent);
    component = fixture.componentInstance;
    component.tab = { id: MOCK_SERVER_TAB_ID, title: 'Mock', type: TabType.MOCK_SERVER };
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('mirrors status, options and hits from the service', () => {
    const running: MockServerStatus = { ...baseStatus, status: 'running', port: 3001, baseUrl: 'http://127.0.0.1:3001' };
    status$.next(running);
    options$.next({ ...baseOptions, port: 3001 });
    hits$.next([{ id: 'h1', method: 'GET', path: '/x', status: 200, ts: Date.now() } as any]);
    expect(component.status.status).toBe('running');
    expect(component.portInput).toBe('3001');
    expect(component.hits.length).toBe(1);
  });

  it('statusBucket buckets HTTP codes correctly', () => {
    expect(component.statusBucket(204)).toBe('2xx');
    expect(component.statusBucket(301)).toBe('3xx');
    expect(component.statusBucket(404)).toBe('4xx');
    expect(component.statusBucket(500)).toBe('5xx');
    expect(component.statusBucket(199)).toBe('');
  });

  it('hitStatusClass maps buckets to CSS classes', () => {
    expect(component.hitStatusClass(201)).toBe('is-success');
    expect(component.hitStatusClass(301)).toBe('is-info');
    expect(component.hitStatusClass(404)).toBe('is-warning');
    expect(component.hitStatusClass(503)).toBe('is-error');
    expect(component.hitStatusClass(100)).toBe('');
  });

  it('variantStatusClass maps status codes to semantic tones', () => {
    expect(component.variantStatusClass(null)).toBe('is-neutral');
    expect(component.variantStatusClass(200)).toBe('is-success');
    expect(component.variantStatusClass(404)).toBe('is-warning');
    expect(component.variantStatusClass(500)).toBe('is-error');
  });

  it('parsedPort rejects out-of-range values (returns null => auto)', () => {
    component.portInput = '';
    expect((component as any).parsedPort()).toBeNull();
    component.portInput = '0';
    expect((component as any).parsedPort()).toBeNull();
    component.portInput = '70000';
    expect((component as any).parsedPort()).toBeNull();
    component.portInput = '3001';
    expect((component as any).parsedPort()).toBe(3001);
  });

  it('parsedPort accepts numeric port from type=number ngModel binding', () => {
    (component as any).portInput = 9781;
    expect((component as any).parsedPort()).toBe(9781);
  });

  it('startServer forwards the parsed port and calls start()', async () => {
    component.portInput = '4000';
    await component.startServer();
    expect(mockSpy.setOptions).toHaveBeenCalledWith(jasmine.objectContaining({ port: 4000 }));
    expect(mockSpy.start).toHaveBeenCalledWith(4000);
  });

  it('stopServer calls mock.stop()', async () => {
    await component.stopServer();
    expect(mockSpy.stop).toHaveBeenCalled();
  });

  it('restartServer flushes options then restarts', async () => {
    component.portInput = '';
    await component.restartServer();
    expect(mockSpy.setOptions).toHaveBeenCalled();
    expect(mockSpy.restart).toHaveBeenCalled();
  });

  it('setBindAddress to 0.0.0.0 requires a confirmation', async () => {
    confirmDialogSpy.confirm.and.resolveTo(false);
    await component.setBindAddress('0.0.0.0');
    expect(mockSpy.setOptions).not.toHaveBeenCalled();

    confirmDialogSpy.confirm.and.resolveTo(true);
    await component.setBindAddress('0.0.0.0');
    expect(mockSpy.setOptions).toHaveBeenCalledWith({ bindAddress: '0.0.0.0' });
  });

  it('setBindAddress to loopback needs no confirm', async () => {
    confirmDialogSpy.confirm.calls.reset();
    await component.setBindAddress('127.0.0.1');
    expect(confirmDialogSpy.confirm).not.toHaveBeenCalled();
    expect(mockSpy.setOptions).toHaveBeenCalledWith({ bindAddress: '127.0.0.1' });
  });

  it('addStandalone picks a unique path, registers it, and selects the result', async () => {
    mockSpy.registerStandalone.and.resolveTo({
      id: 'sa-1',
      name: '',
      method: 'GET',
      path: '/mock/new',
      variants: [{ id: 'v1' } as any],
      activeVariantId: 'v1',
    } as StandaloneMockEndpoint);
    mockSpy.listStandalone.and.resolveTo([{ id: 'sa-1', name: '', method: 'GET', path: '/mock/new' } as any]);
    await component.addStandalone();
    expect(mockSpy.registerStandalone).toHaveBeenCalledWith(
      jasmine.objectContaining({ name: '', method: 'GET', path: '/mock/new' }),
    );
    expect(component.selectedStandaloneId).toBe('sa-1');
  });

  it('standalonePrimaryLabel uses name or falls back to path', () => {
    expect(
      component.standalonePrimaryLabel({ name: '  Health  ', path: '/api/x', id: '1' } as StandaloneMockEndpoint),
    ).toBe('Health');
    expect(
      component.standalonePrimaryLabel({ name: '', path: '/api/x', id: '1' } as StandaloneMockEndpoint),
    ).toBe('/api/x');
  });

  it('removeStandalone only calls through when the user confirms', async () => {
    confirmDialogSpy.confirm.and.resolveTo(false);
    await component.removeStandalone({ id: 'sa-9', method: 'GET', path: '/x' } as any);
    expect(mockSpy.unregisterStandalone).not.toHaveBeenCalled();

    confirmDialogSpy.confirm.and.resolveTo(true);
    await component.removeStandalone({ id: 'sa-9', method: 'GET', path: '/x' } as any);
    expect(mockSpy.unregisterStandalone).toHaveBeenCalledWith('sa-9');
  });

  it('bodyTypeOf detects JSON / XML / form content types', () => {
    expect(component.bodyTypeOf({ body: '{}', headers: [{ key: 'Content-Type', value: 'application/json' }] })).toBe('json');
    expect(component.bodyTypeOf({ body: '<x/>', headers: [{ key: 'Content-Type', value: 'application/xml' }] })).toBe('xml');
    expect(component.bodyTypeOf({ body: 'a=b', headers: [{ key: 'Content-Type', value: 'application/x-www-form-urlencoded' }] })).toBe('form');
    expect(component.bodyTypeOf({ body: '', headers: [] })).toBe('none');
    expect(component.bodyTypeOf({ body: '<h1></h1>', headers: [{ key: 'Content-Type', value: 'text/html' }] })).toBe('html');
  });

  it('setBodyType swaps the Content-Type header and seeds the body for empty variants', () => {
    const v: any = { body: '', headers: [] };
    component.setBodyType(v, 'json');
    expect(v.body).toContain('"ok": true');
    expect(v.headers[0].key).toBe('Content-Type');
    expect(v.headers[0].value).toContain('application/json');

    component.setBodyType(v, 'none');
    expect(v.body).toBe('');
    expect(v.headers.length).toBe(0);
  });

  it('addHeader / removeHeader manage a variant\'s headers list', () => {
    const v: any = { body: '', headers: [{ key: 'X-One', value: '1' }] };
    component.selectionKind = 'standalone';
    component.selectedStandalone = { id: 'sa', method: 'GET', path: '/x', variants: [v] } as any;
    component.addHeader(v);
    expect(v.headers.length).toBe(2);
    component.removeHeader(v, 0);
    expect(v.headers.length).toBe(1);
    expect(v.headers[0].key).toBe('');
  });

  it('toggleHeaders flips per-variant open state', () => {
    expect(component.isHeadersOpen('v1')).toBeFalse();
    component.toggleHeaders('v1');
    expect(component.isHeadersOpen('v1')).toBeTrue();
    component.toggleHeaders('v1');
    expect(component.isHeadersOpen('v1')).toBeFalse();
  });

  it('filteredHits applies text, method, and status filters', () => {
    const hits: MockHit[] = [
      { id: '1', method: 'GET',  path: '/a', status: 200, ts: 1 } as any,
      { id: '2', method: 'POST', path: '/b', status: 500, ts: 2 } as any,
      { id: '3', method: 'GET',  path: '/abc', status: 404, ts: 3 } as any,
    ];
    hits$.next(hits);
    component.methodFilter = 'GET';
    expect(component.filteredHits().length).toBe(2);
    component.statusFilter = '4xx';
    expect(component.filteredHits().length).toBe(1);
    component.statusFilter = '';
    component.hitFilter = 'abc';
    expect(component.filteredHits().length).toBe(1);
  });

  it('toggleHit collapses the same row and expands a different one', () => {
    const a = { id: '1' } as MockHit; const b = { id: '2' } as MockHit;
    component.toggleHit(a);
    expect(component.expandedHitId).toBe('1');
    component.toggleHit(a);
    expect(component.expandedHitId).toBeNull();
    component.toggleHit(b);
    expect(component.expandedHitId).toBe('2');
  });

  it('resetAllVariants prompts, then calls clearAll() only on confirm', async () => {
    confirmDialogSpy.confirm.and.resolveTo(false);
    await component.resetAllVariants();
    expect(mockSpy.clearAll).not.toHaveBeenCalled();

    confirmDialogSpy.confirm.and.resolveTo(true);
    await component.resetAllVariants();
    expect(mockSpy.clearAll).toHaveBeenCalled();
  });

  it('toggleAdvanced flips the showAdvanced flag', () => {
    expect(component.showAdvanced).toBeFalse();
    component.toggleAdvanced();
    expect(component.showAdvanced).toBeTrue();
  });

  it('defaults to activity hidden when session is empty', () => {
    expect(component.activityPaneVisible).toBeFalse();
  });

  it('persists selection to sessionStorage when selecting a request', () => {
    const req = { id: 'r1', title: 'T' } as any;
    component.selectRequest(req);
    const raw = sessionStorage.getItem('aw.mockServer.sessionUi');
    expect(raw).toBeTruthy();
    const snap = JSON.parse(raw!);
    expect(snap.v).toBe(1);
    expect(snap.selectionKind).toBe('request');
    expect(snap.selectedRequestId).toBe('r1');
  });

  it('standaloneUrl returns "" when the server is offline', () => {
    component.status = { ...baseStatus, baseUrl: '' };
    expect(component.standaloneUrl({ id: 'sa', method: 'GET', path: '/x' } as any)).toBe('');

    component.status = { ...baseStatus, baseUrl: 'http://127.0.0.1:3001' };
    expect(component.standaloneUrl({ id: 'sa', method: 'GET', path: '/y' } as any)).toBe('http://127.0.0.1:3001/y');
  });
});
