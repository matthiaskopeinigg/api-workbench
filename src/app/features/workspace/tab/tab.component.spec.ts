import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject } from 'rxjs';
import { TabComponent } from './tab.component';
import { TabItem, TabService, TabType } from '@core/tabs/tab.service';
import type { WorkspaceTabsState } from '@core/tabs/workspace-tabs.model';
import { ViewStateService } from '@core/session/view-state.service';
import { EnvironmentsService } from '@core/environments/environments.service';
import { RequestHistoryService } from '@core/http/request-history.service';
import { RequestService } from '@core/http/request.service';
import { CollectionService } from '@core/collection/collection.service';
import { CollectionWebSocketTabService } from '@core/collection/collection-websocket-tab.service';
import { TestArtifactService } from '@core/testing/test-artifact.service';
import { KeyboardShortcutsService } from '@core/keyboard/keyboard-shortcuts.service';

describe('TabComponent', () => {
  let fixture: ComponentFixture<TabComponent>;
  let tabServiceSpy: jasmine.SpyObj<TabService>;
  let viewStateSpy: jasmine.SpyObj<ViewStateService>;
  let requestServiceSpy: jasmine.SpyObj<RequestService>;
  let openTabSubject: Subject<TabItem>;
  let requestSelection$: BehaviorSubject<TabItem | null>;

  const mk = (id: string): TabItem => ({ id, title: id, type: TabType.REQUEST });

  beforeEach(async () => {
    openTabSubject = new Subject<TabItem>();
    requestSelection$ = new BehaviorSubject<TabItem | null>(null);

    tabServiceSpy = jasmine.createSpyObj('TabService', [
      'getWorkspaceTabsState',
      'saveWorkspaceTabsState',
      'saveSelectTab',
      'saveUnselectTab',
      'getOpenTabAsObservable',
      'isEnvironmentTab',
      'isRequestHistoryEntryTab',
      'isRequestTab',
      'isFolderTab',
      'isWebSocketTab',
    ]);
    tabServiceSpy.getWorkspaceTabsState.and.resolveTo(null);
    tabServiceSpy.saveWorkspaceTabsState.and.resolveTo();
    tabServiceSpy.saveSelectTab.and.resolveTo();
    tabServiceSpy.saveUnselectTab.and.resolveTo();
    tabServiceSpy.getOpenTabAsObservable.and.returnValue(openTabSubject.asObservable());
    tabServiceSpy.isEnvironmentTab.and.returnValue(false);
    tabServiceSpy.isRequestHistoryEntryTab.and.returnValue(false);
    tabServiceSpy.isRequestTab.and.returnValue(true);
    tabServiceSpy.isFolderTab.and.returnValue(false);
    tabServiceSpy.isWebSocketTab.and.returnValue(false);

    viewStateSpy = jasmine.createSpyObj('ViewStateService', ['load', 'retainOnly', 'clear']);
    viewStateSpy.load.and.resolveTo();

    requestServiceSpy = jasmine.createSpyObj('RequestService', [
      'selectRequest',
      'removeSelectedRequest',
      'getSelectedRequestAsObservable',
    ]);
    requestServiceSpy.getSelectedRequestAsObservable.and.returnValue(requestSelection$.asObservable());
    requestServiceSpy.removeSelectedRequest.and.callFake(() => {
      requestSelection$.next(null);
      return Promise.resolve();
    });

    const envSpy = jasmine.createSpyObj('EnvironmentsService', [
      'getSelectedEnvironmentAsObservable',
      'removeSelectedEnvironment',
      'getEnvironmentDeletedObservable',
    ]);
    envSpy.getSelectedEnvironmentAsObservable.and.returnValue(new Subject().asObservable());
    envSpy.removeSelectedEnvironment.and.resolveTo();
    envSpy.getEnvironmentDeletedObservable.and.returnValue(new Subject().asObservable());

    const histSpy = jasmine.createSpyObj('RequestHistoryService', [
      'getSelectedHistoryEntryAsObservable',
      'removeSelectedHistoryEntry',
    ]);
    histSpy.getSelectedHistoryEntryAsObservable.and.returnValue(new Subject().asObservable());
    histSpy.removeSelectedHistoryEntry.and.resolveTo();

    const collSpy = jasmine.createSpyObj('CollectionService', [
      'getSelectedFolderAsObservable',
      'selectFolder',
      'getRequestDeletedObservable',
      'getRequestUpdatedObservable',
      'getWebSocketEntryDeletedObservable',
      'getWebSocketEntryUpdatedObservable',
      'getFolderDeletedObservable',
      'getFolderUpdatedObservable',
    ]);
    collSpy.getSelectedFolderAsObservable.and.returnValue(new Subject().asObservable());
    collSpy.getRequestDeletedObservable.and.returnValue(new Subject().asObservable());
    collSpy.getRequestUpdatedObservable.and.returnValue(new Subject().asObservable());
    collSpy.getWebSocketEntryDeletedObservable.and.returnValue(new Subject().asObservable());
    collSpy.getWebSocketEntryUpdatedObservable.and.returnValue(new Subject().asObservable());
    collSpy.getFolderDeletedObservable.and.returnValue(new Subject().asObservable());
    collSpy.getFolderUpdatedObservable.and.returnValue(new Subject().asObservable());

    const wsTabSpy = jasmine.createSpyObj('CollectionWebSocketTabService', [
      'getSelectedWebSocketTabAsObservable',
      'selectWebSocketTab',
      'clearSelectedWebSocketTab',
    ]);
    wsTabSpy.getSelectedWebSocketTabAsObservable.and.returnValue(new Subject().asObservable());

    const keyboardSpy = jasmine.createSpyObj('KeyboardShortcutsService', ['register']);
    keyboardSpy.register.and.returnValue(() => {});

    const testArtSpy = jasmine.createSpyObj('TestArtifactService', ['getTestArtifactDeletedObservable']);
    testArtSpy.getTestArtifactDeletedObservable.and.returnValue(new Subject().asObservable());

    await TestBed.configureTestingModule({
      imports: [TabComponent],
      providers: [
        { provide: TabService, useValue: tabServiceSpy },
        { provide: ViewStateService, useValue: viewStateSpy },
        { provide: RequestService, useValue: requestServiceSpy },
        { provide: EnvironmentsService, useValue: envSpy },
        { provide: RequestHistoryService, useValue: histSpy },
        { provide: CollectionService, useValue: collSpy },
        { provide: CollectionWebSocketTabService, useValue: wsTabSpy },
        { provide: KeyboardShortcutsService, useValue: keyboardSpy },
        { provide: TestArtifactService, useValue: testArtSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TabComponent);
  });

  it('should create with empty workspace', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const c = fixture.componentInstance;
    expect(c).toBeTruthy();
    expect(c.primaryTabs).toEqual([]);
    expect(c.secondaryTabs).toEqual([]);
    expect(c.splitMode).toBeFalse();
  });

  it('opens ad-hoc tabs into the focused (primary) pane via TabService stream', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const c = fixture.componentInstance;
    openTabSubject.next(mk('req-1'));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(c.primaryTabs.map(t => t.id)).toEqual(['req-1']);
    expect(c.focusedPane).toBe('primary');
    expect(requestServiceSpy.selectRequest).toHaveBeenCalled();
    expect(tabServiceSpy.saveWorkspaceTabsState).toHaveBeenCalled();
  });

  it('re-opens the same request from the sidebar after all tabs were closed (selection stream null is filtered)', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const c = fixture.componentInstance;
    const tab = mk('same-req');
    requestSelection$.next(tab);
    await fixture.whenStable();
    expect(c.primaryTabs.map((t) => t.id)).toEqual(['same-req']);

    await c.onCloseTab('primary', 0);
    await fixture.whenStable();
    expect(c.primaryTabs.length).toBe(0);

    requestSelection$.next({ ...tab, title: 'same-req' });
    await fixture.whenStable();
    expect(c.primaryTabs.map((t) => t.id)).toEqual(['same-req']);
  });

  it('after split-right then closing the only tab, the next opened tab lands in the primary pane', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const c = fixture.componentInstance;
    c.primaryTabs = [mk('solo')];
    c.primarySelected = 0;
    c.splitMode = false;
    c.focusedPane = 'primary';

    await c.onSplitRight('primary', 0);
    expect(c.splitMode).toBeTrue();
    expect(c.secondaryTabs.map((t) => t.id)).toEqual(['solo']);
    expect(c.focusedPane).toBe('secondary');

    await c.onCloseTab('secondary', 0);
    expect(c.splitMode).toBeFalse();
    expect(c.focusedPane).toBe('primary');
    expect(c.primaryTabs.length + c.secondaryTabs.length).toBe(0);

    await c.addNewTabToWorkspace(mk('fresh'));
    expect(c.primaryTabs.map((t) => t.id)).toEqual(['fresh']);
    expect(c.secondaryTabs.length).toBe(0);
    expect(c.focusedPane).toBe('primary');
  });

  it('onMergeSplit flattens panes and disables split', async () => {
    tabServiceSpy.getWorkspaceTabsState.and.resolveTo({
      split: true,
      ratio: 0.5,
      primary: { tabs: [mk('a')], selectedTabId: 'a' },
      secondary: { tabs: [mk('b')], selectedTabId: 'b' },
    } satisfies WorkspaceTabsState);

    fixture = TestBed.createComponent(TabComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const c = fixture.componentInstance;
    expect(c.splitMode).toBeTrue();

    await c.onMergeSplit();
    expect(c.splitMode).toBeFalse();
    expect(c.primaryTabs.map(t => t.id)).toEqual(['a', 'b']);
    expect(c.secondaryTabs.length).toBe(0);
    expect(tabServiceSpy.saveWorkspaceTabsState).toHaveBeenCalled();
  });
});
