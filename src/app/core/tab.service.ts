import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { SessionService } from './session.service';
import { SettingsService } from './settings.service';

export enum TabType {
  COLLECTION,
  FOLDER,
  REQUEST,
  ENVIRONMENT,
  REQUEST_HISTORY_ENTRY,
  WEBSOCKET,
  MOCK_SERVER,
  LOAD_TEST,
  TEST_SUITE,
  CONTRACT_TEST,
  FLOW
}

/** Stable id used by the singleton Mock Server tab. */
export const MOCK_SERVER_TAB_ID = '__mock_server__';

export class TabItem {
  protected constructor(
    public id: string,
    public title: string,
    public type: TabType
  ) { }
}

@Injectable({
  providedIn: 'root',
})
export class TabService {

  private ACTIVE_TABS_KEY = 'activeTabs';
  private SELECTED_TAB_KEY = 'selectedTab';

  /**
   * Broadcast channel for ad-hoc tab opens (e.g. "New WebSocket tab" from the
   * command palette). Typed tabs like requests/folders keep going through
   * their existing services so we don't break their selection side effects.
   */
  private openTabSubject = new Subject<TabItem>();

  constructor(private sessionService: SessionService, private settingsService: SettingsService) {
  }

  openTab(tab: TabItem) {
    this.openTabSubject.next(tab);
  }

  getOpenTabAsObservable(): Observable<TabItem> {
    return this.openTabSubject.asObservable();
  }

  async loadSettings(): Promise<void> {
    await this.sessionService.load(this.ACTIVE_TABS_KEY);
    await this.sessionService.load(this.SELECTED_TAB_KEY);
  }

  createTab(id: string, title: string, type: TabType): TabItem {
    return {
      id: id,
      title: title,
      type: type
    };
  }

  isEnvironmentTab(tab: TabItem) {
    return tab.type === TabType.ENVIRONMENT;
  }

  isCollectionTab(tab: TabItem) {
    return tab.type === TabType.COLLECTION;
  }

  isRequestHistoryEntryTab(tab: TabItem) {
    return tab.type === TabType.REQUEST_HISTORY_ENTRY;
  }

  isRequestTab(tab: TabItem) {
    return tab.type === TabType.REQUEST;
  }

  isFolderTab(tab: TabItem) {
    return tab.type === TabType.FOLDER;
  }

  isWebSocketTab(tab: TabItem) {
    return tab.type === TabType.WEBSOCKET;
  }

  isMockServerTab(tab: TabItem) {
    return tab.type === TabType.MOCK_SERVER;
  }

  isLoadTestTab(tab: TabItem) {
    return tab.type === TabType.LOAD_TEST;
  }

  isTestSuiteTab(tab: TabItem) {
    return tab.type === TabType.TEST_SUITE;
  }

  isContractTestTab(tab: TabItem) {
    return tab.type === TabType.CONTRACT_TEST;
  }

  isFlowTab(tab: TabItem) {
    return tab.type === TabType.FLOW;
  }

  /**
   * Open (or focus) the singleton Mock Server tab. Always uses the same
   * stable id so duplicate opens reuse the existing tab.
   */
  openMockServerTab(): void {
    this.openTab({
      id: MOCK_SERVER_TAB_ID,
      title: 'Mock Server',
      type: TabType.MOCK_SERVER,
    });
  }

  /**
   * Open a test-tab artifact. The id matches the artifact id so multiple
   * opens of the same artifact reuse a single tab.
   */
  openLoadTestTab(id: string, title = 'Load Test'): void {
    this.openTab({ id: `lt:${id}`, title, type: TabType.LOAD_TEST });
  }

  openTestSuiteTab(id: string, title = 'Test Suite'): void {
    this.openTab({ id: `ts:${id}`, title, type: TabType.TEST_SUITE });
  }

  openContractTestTab(id: string, title = 'Contract Test'): void {
    this.openTab({ id: `ct:${id}`, title, type: TabType.CONTRACT_TEST });
  }

  openFlowTab(id: string, title = 'Flow'): void {
    this.openTab({ id: `fl:${id}`, title, type: TabType.FLOW });
  }

  getActiveTabs(): TabItem[] | null {
    const settings = this.settingsService.getSettings();
    if (settings.ui?.saveOpenTabs === false) return null;
    return this.sessionService.get(this.ACTIVE_TABS_KEY);
  }

  async saveActiveTabs(tabs: TabItem[]) {
    const settings = this.settingsService.getSettings();
    if (settings.ui?.saveOpenTabs === false) {
      await this.sessionService.save(this.ACTIVE_TABS_KEY, null);
      return;
    }
    await this.sessionService.save(this.ACTIVE_TABS_KEY, tabs);
  }

  getSelectedTab(): TabItem | null {
    const settings = this.settingsService.getSettings();
    if (settings.ui?.saveOpenTabs === false) return null;
    return this.sessionService.get(this.SELECTED_TAB_KEY);
  }

  async saveSelectTab(tab: TabItem) {
    const settings = this.settingsService.getSettings();
    if (settings.ui?.saveOpenTabs === false) {
      await this.sessionService.save(this.SELECTED_TAB_KEY, null);
      return;
    }
    await this.sessionService.save(this.SELECTED_TAB_KEY, tab);
  }

  async saveUnselectTab() {
    await this.sessionService.save(this.SELECTED_TAB_KEY, null);
  }

}


