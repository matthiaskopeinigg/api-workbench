import { TestBed } from '@angular/core/testing';
import { CAPTURE_TAB_ID, TabService, TabType } from './tab.service';
import type { TabItem } from './tab.service';
import { SessionService } from '@core/session/session.service';
import { SettingsService } from '@core/settings/settings.service';

describe('TabService workspace tabs', () => {
  let service: TabService;
  let sessionStore: Record<string, unknown>;

  beforeEach(() => {
    sessionStore = {};
    const sessionSpy = jasmine.createSpyObj('SessionService', ['load', 'save', 'get']);
    sessionSpy.load.and.callFake(async (key: string) => {
      void key;
    });
    sessionSpy.get.and.callFake(<T>(key: string): T | null => (sessionStore[key] as T) ?? null);
    sessionSpy.save.and.callFake(async (key: string, value: unknown) => {
      sessionStore[key] = value;
    });

    const settingsSpy = jasmine.createSpyObj('SettingsService', ['getSettings']);
    settingsSpy.getSettings.and.returnValue({ ui: { saveOpenTabs: true } });

    TestBed.configureTestingModule({
      providers: [
        TabService,
        { provide: SessionService, useValue: sessionSpy },
        { provide: SettingsService, useValue: settingsSpy },
      ],
    });
    service = TestBed.inject(TabService);
  });

  it('migrates legacy activeTabs into primary when workspaceTabs is absent', async () => {
    const t1 = { id: 'r1', title: 'One', type: TabType.REQUEST };
    sessionStore['activeTabs'] = [t1];
    sessionStore['selectedTab'] = t1;

    const ws = await service.getWorkspaceTabsState();
    expect(ws).not.toBeNull();
    expect(ws!.split).toBeFalse();
    expect(ws!.primary.tabs.map(x => x.id)).toEqual(['r1']);
    expect(ws!.primary.selectedTabId).toBe('r1');
    expect(ws!.secondary.tabs.length).toBe(0);
  });

  it('saveWorkspaceTabsState mirrors flat activeTabs for compatibility', async () => {
    const t1 = { id: 'a', title: 'A', type: TabType.REQUEST };
    const t2 = { id: 'b', title: 'B', type: TabType.REQUEST };
    await service.saveWorkspaceTabsState({
      split: true,
      ratio: 0.4,
      primary: { tabs: [t1], selectedTabId: 'a' },
      secondary: { tabs: [t2], selectedTabId: 'b' },
    });

    const flat = sessionStore['activeTabs'] as { id: string }[];
    expect(flat.map(x => x.id)).toEqual(['a', 'b']);
    const persisted = sessionStore['workspaceTabs'] as { split: boolean; ratio: number };
    expect(persisted.split).toBeTrue();
    expect(persisted.ratio).toBe(0.4);
  });

  it('openCaptureTab emits singleton capture tab', () => {
    const received: TabItem[] = [];
    const sub = service.getOpenTabAsObservable().subscribe((t) => received.push(t));
    service.openCaptureTab();
    service.openCaptureTab();
    sub.unsubscribe();
    expect(received.length).toBe(2);
    expect(received[0]).toEqual(
      jasmine.objectContaining({
        id: CAPTURE_TAB_ID,
        title: 'Capture',
        type: TabType.CAPTURE,
      }),
    );
    expect(received[1].id).toBe(CAPTURE_TAB_ID);
  });

  it('isCaptureTab recognizes capture tab type', () => {
    expect(service.isCaptureTab({ id: CAPTURE_TAB_ID, title: 'Capture', type: TabType.CAPTURE })).toBeTrue();
    expect(service.isCaptureTab({ id: 'x', title: 'X', type: TabType.REQUEST })).toBeFalse();
  });

  it('strips removed tab types from legacy activeTabs', async () => {
    const legacy = [
      { id: 'r1', title: 'One', type: TabType.REQUEST },
      { id: 'ts:x', title: 'Suite', type: TabType.TEST_SUITE },
      { id: '__regression_lab__', title: 'Regression', type: TabType.REGRESSION_LAB },
    ];
    sessionStore['activeTabs'] = legacy;
    sessionStore['selectedTab'] = legacy[0];

    const ws = await service.getWorkspaceTabsState();
    expect(ws!.primary.tabs.map((t) => t.id)).toEqual(['r1']);
    expect(ws!.primary.selectedTabId).toBe('r1');
  });
});
