import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { SessionService } from '@core/session/session.service';
import { SettingsService } from '@core/settings/settings.service';
import type { TestingArtifactKind } from '@models/electron';
import {
  defaultWorkspaceTabsState,
  emptyPaneState,
  type WorkspaceTabsState,
} from './workspace-tabs.model';

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

/** Tab id used by the workbench for a saved test artifact (see `open*Tab` on this service). */
export function tabIdForTestArtifact(kind: TestingArtifactKind, id: string): string | null {
  switch (kind) {
    case 'loadTests':
      return `lt:${id}`;
    case 'testSuites':
      return `ts:${id}`;
    case 'contractTests':
      return `ct:${id}`;
    case 'flows':
      return `fl:${id}`;
    default:
      return null;
  }
}

/** Workspace tab row: `id` is unique per open tab; `payloadId` is the logical entity id when duplicated. */
export interface TabItem {
  id: string;
  title: string;
  type: TabType;
  /** Collection entity id (e.g. request id). Defaults to `id` when omitted. */
  payloadId?: string;
  pinned?: boolean;
  /** Runtime-only; cleared before persistence. */
  dirty?: boolean;
  /** Ephemeral routing for opens; stripped before persistence. */
  openInPane?: 'unfocused';
}

const TAB_INSTANCE_PREFIX = 'tab:';

export function tabPayloadId(tab: TabItem): string {
  return tab.payloadId ?? tab.id;
}

/** Removes runtime / routing-only fields before session persistence. */
export function sanitizeTabForStorage(tab: TabItem): TabItem {
  const { dirty, openInPane, ...rest } = tab;
  return { ...rest };
}

export function newSurfaceTabId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return `${TAB_INSTANCE_PREFIX}${c.randomUUID()}`;
  return `${TAB_INSTANCE_PREFIX}${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Second editor for the same request (new surface id, same payload). */
export function duplicateRequestTabSurface(tab: TabItem): TabItem {
  const payload = tab.type === TabType.REQUEST ? tabPayloadId(tab) : tab.id;
  return {
    ...tab,
    id: newSurfaceTabId(),
    payloadId: tab.type === TabType.REQUEST ? payload : tab.payloadId,
    dirty: false,
  };
}

@Injectable({
  providedIn: 'root',
})
export class TabService {

  private ACTIVE_TABS_KEY = 'activeTabs';
  private SELECTED_TAB_KEY = 'selectedTab';
  private WORKSPACE_TABS_KEY = 'workspaceTabs';

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
    await this.sessionService.load(this.WORKSPACE_TABS_KEY);
  }

  createTab(id: string, title: string, type: TabType): TabItem {
    return { id, title, type };
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
    await this.sessionService.save(this.SELECTED_TAB_KEY, sanitizeTabForStorage(tab));
  }

  async saveUnselectTab() {
    await this.sessionService.save(this.SELECTED_TAB_KEY, null);
  }

  /**
   * Loads persisted split workspace layout, or migrates from legacy `activeTabs` + `selectedTab`.
   */
  async getWorkspaceTabsState(): Promise<WorkspaceTabsState | null> {
    const settings = this.settingsService.getSettings();
    if (settings.ui?.saveOpenTabs === false) {
      return null;
    }
    await this.sessionService.load(this.WORKSPACE_TABS_KEY);
    const raw = this.sessionService.get<unknown>(this.WORKSPACE_TABS_KEY);
    const normalized = this.normalizeWorkspaceState(raw);
    if (normalized) {
      return normalized;
    }
    await this.sessionService.load(this.ACTIVE_TABS_KEY);
    await this.sessionService.load(this.SELECTED_TAB_KEY);
    const legacyTabs = this.sessionService.get<TabItem[]>(this.ACTIVE_TABS_KEY) ?? [];
    const selected = this.sessionService.get<TabItem | null>(this.SELECTED_TAB_KEY);
    const selectedId =
      selected && legacyTabs.some(t => t.id === selected.id)
        ? selected.id
        : legacyTabs[0]?.id ?? null;
    return {
      split: false,
      ratio: 0.5,
      orientation: 'horizontal',
      paneEnvironmentIds: { primary: null, secondary: null },
      primary: { tabs: [...legacyTabs], selectedTabId: selectedId },
      secondary: emptyPaneState(),
    };
  }

  async saveWorkspaceTabsState(state: WorkspaceTabsState): Promise<void> {
    const settings = this.settingsService.getSettings();
    if (settings.ui?.saveOpenTabs === false) {
      await this.sessionService.save(this.WORKSPACE_TABS_KEY, null);
      await this.sessionService.save(this.ACTIVE_TABS_KEY, null);
      return;
    }
    const next = this.normalizeWorkspaceState(state);
    if (!next) {
      return;
    }
    await this.sessionService.save(this.WORKSPACE_TABS_KEY, next);
    const flat = [...next.primary.tabs, ...next.secondary.tabs];
    await this.sessionService.save(this.ACTIVE_TABS_KEY, flat);
  }

  private normalizeWorkspaceState(raw: unknown): WorkspaceTabsState | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const o = raw as Record<string, unknown>;
    const primary = this.normalizePane(o['primary']);
    let secondary = this.normalizePane(o['secondary']) ?? emptyPaneState();
    if (!primary) {
      return null;
    }
    let ratio = typeof o['ratio'] === 'number' && Number.isFinite(o['ratio']) ? o['ratio'] : 0.5;
    ratio = Math.min(0.85, Math.max(0.15, ratio));
    let split = o['split'] === true;
    if (!split && secondary.tabs.length > 0) {
      const seen = new Set(primary.tabs.map(t => t.id));
      for (const t of secondary.tabs) {
        if (!seen.has(t.id)) {
          primary.tabs.push(t);
          seen.add(t.id);
        }
      }
      secondary = emptyPaneState();
    }
    const orientation =
      o['orientation'] === 'vertical' ? 'vertical' : 'horizontal';
    const paneEnvironmentIds = this.normalizePaneEnvironmentIds(o['paneEnvironmentIds']);

    return {
      split,
      ratio,
      orientation,
      paneEnvironmentIds,
      primary,
      secondary,
    };
  }

  private normalizePaneEnvironmentIds(raw: unknown): {
    primary: string | null;
    secondary: string | null;
  } {
    if (!raw || typeof raw !== 'object') {
      return { primary: null, secondary: null };
    }
    const o = raw as Record<string, unknown>;
    const primary =
      typeof o['primary'] === 'string' || o['primary'] === null ? (o['primary'] as string | null) : null;
    const secondary =
      typeof o['secondary'] === 'string' || o['secondary'] === null
        ? (o['secondary'] as string | null)
        : null;
    return { primary, secondary };
  }

  private normalizePane(raw: unknown): { tabs: TabItem[]; selectedTabId: string | null } | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const o = raw as Record<string, unknown>;
    const tabs = Array.isArray(o['tabs'])
      ? (o['tabs'] as TabItem[])
          .filter(t => t && typeof t.id === 'string')
          .map(t => sanitizeTabForStorage({ ...t }))
      : [];
    const selectedTabId =
      typeof o['selectedTabId'] === 'string' && tabs.some(t => t.id === o['selectedTabId'])
        ? o['selectedTabId']
        : tabs[0]?.id ?? null;
    return { tabs, selectedTabId };
  }

  /** Used if workspace state is corrupt; returns an empty single-pane layout. */
  fallbackWorkspaceState(): WorkspaceTabsState {
    return defaultWorkspaceTabsState();
  }

}


