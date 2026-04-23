import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { SimpleChange } from '@angular/core';
import { WebSocketComponent } from './websocket.component';
import { WebSocketService } from '@core/websocket/websocket.service';
import { TabType } from '@core/tabs/tab.service';
import type { TabItem } from '@core/tabs/tab.service';

describe('WebSocketComponent', () => {
  let fixture: ComponentFixture<WebSocketComponent>;
  let component: WebSocketComponent;

  let state$: BehaviorSubject<any>;
  let wsSpy: jasmine.SpyObj<WebSocketService>;

  const tab: TabItem = { id: 'ws-1', title: 'Socket', type: TabType.WEBSOCKET };

  beforeEach(async () => {
    state$ = new BehaviorSubject<any>({
      status: 'disconnected',
      tab: {
        id: 'ws-1', title: 'Socket', mode: 'ws', url: '',
        protocols: [], headers: [], messageDraft: '', messageHistory: [],
      },
      frames: [],
    });
    wsSpy = jasmine.createSpyObj('WebSocketService',
      ['ensure', 'state$', 'updateTab', 'connect', 'disconnect', 'send', 'clearFrames']);
    wsSpy.ensure.and.returnValue(state$ as any);
    wsSpy.state$.and.returnValue(state$.asObservable());
    wsSpy.connect.and.resolveTo();
    wsSpy.disconnect.and.resolveTo();
    wsSpy.send.and.resolveTo();

    await TestBed.configureTestingModule({
      imports: [WebSocketComponent],
      providers: [{ provide: WebSocketService, useValue: wsSpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(WebSocketComponent);
    component = fixture.componentInstance;
    component.tab = tab;
    fixture.detectChanges();
  });

  it('binds to the tab id and mirrors the service state', () => {
    expect(wsSpy.ensure).toHaveBeenCalledWith('ws-1', jasmine.objectContaining({ title: 'Socket' }));
    expect(component.view.tab.id).toBe('ws-1');
  });

  it('rebinds on input change but skips re-binding the same id', () => {
    component.ngOnChanges({ tab: new SimpleChange(tab, tab, false) });
    expect(wsSpy.ensure.calls.count()).toBe(1);
    const newTab: TabItem = { id: 'ws-2', title: 'Other', type: TabType.WEBSOCKET };
    component.tab = newTab;
    component.ngOnChanges({ tab: new SimpleChange(tab, newTab, false) });
    expect(wsSpy.ensure.calls.count()).toBeGreaterThan(1);
  });

  it('statusLabel reflects the current connection status', () => {
    expect(component.statusLabel).toBe('Disconnected');
    state$.next({ ...state$.value, status: 'connected' });
    expect(component.statusLabel).toBe('Connected');
    state$.next({ ...state$.value, status: 'connecting' });
    expect(component.statusLabel).toBe('Connecting…');
    state$.next({ ...state$.value, status: 'error' });
    expect(component.statusLabel).toBe('Error');
  });

  it('isConnected is true only for the connected status', () => {
    expect(component.isConnected).toBeFalse();
    state$.next({ ...state$.value, status: 'connected' });
    expect(component.isConnected).toBeTrue();
  });

  it('onUrlChange / onModeChange / onDraftChange delegate to updateTab', () => {
    component.onUrlChange('wss://example.com');
    expect(wsSpy.updateTab).toHaveBeenCalledWith('ws-1', { url: 'wss://example.com' });
    component.onModeChange('sse');
    expect(wsSpy.updateTab).toHaveBeenCalledWith('ws-1', { mode: 'sse' });
    component.onDraftChange('hello');
    expect(wsSpy.updateTab).toHaveBeenCalledWith('ws-1', { messageDraft: 'hello' });
  });

  it('onProtocolsChange parses and trims a comma-separated list', () => {
    component.onProtocolsChange(' chat , , json ');
    expect(wsSpy.updateTab).toHaveBeenCalledWith('ws-1', { protocols: ['chat', 'json'] });
    expect(component.protocolsInput).toBe(' chat , , json ');
  });

  it('addHeader appends a blank row via updateTab', () => {
    component.addHeader();
    const patch = wsSpy.updateTab.calls.mostRecent().args[1] as any;
    expect(patch.headers.length).toBe(1);
    expect(patch.headers[0]).toEqual({ key: '', value: '', enabled: true });
  });

  it('updateHeader patches a single row immutably', () => {
    state$.next({
      ...state$.value,
      tab: { ...state$.value.tab, headers: [{ key: 'A', value: '1', enabled: true }] },
    });
    component.updateHeader(0, 'value', '2');
    const patch = wsSpy.updateTab.calls.mostRecent().args[1] as any;
    expect(patch.headers[0]).toEqual({ key: 'A', value: '2', enabled: true });
  });

  it('removeHeader drops the target index', () => {
    state$.next({
      ...state$.value,
      tab: { ...state$.value.tab, headers: [{ key: 'A' }, { key: 'B' }] },
    });
    component.removeHeader(0);
    const patch = wsSpy.updateTab.calls.mostRecent().args[1] as any;
    expect(patch.headers.length).toBe(1);
    expect(patch.headers[0].key).toBe('B');
  });

  it('connect / disconnect delegate to the service for the bound tab', async () => {
    await component.connect();
    expect(wsSpy.connect).toHaveBeenCalledWith('ws-1');
    await component.disconnect();
    expect(wsSpy.disconnect).toHaveBeenCalledWith('ws-1');
  });

  it('send is a no-op when the draft is empty', async () => {
    await component.send();
    expect(wsSpy.send).not.toHaveBeenCalled();
  });

  it('send forwards the draft and clears it afterwards', async () => {
    state$.next({ ...state$.value, tab: { ...state$.value.tab, messageDraft: 'hi' } });
    await component.send();
    expect(wsSpy.send).toHaveBeenCalledWith('ws-1', 'hi', false);
    expect(wsSpy.updateTab.calls.mostRecent().args).toEqual(['ws-1', { messageDraft: '' }]);
  });

  it('clear() proxies to clearFrames for the bound tab', () => {
    component.clear();
    expect(wsSpy.clearFrames).toHaveBeenCalledWith('ws-1');
  });

  it('formatTimestamp pads hours/minutes/seconds and milliseconds', () => {
    expect(component.formatTimestamp(undefined)).toBe('');
    const t = new Date(2024, 0, 1, 3, 4, 5, 67).getTime();
    expect(component.formatTimestamp(t)).toBe('03:04:05.067');
  });
});
