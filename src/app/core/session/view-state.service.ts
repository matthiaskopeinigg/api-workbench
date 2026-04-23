import { Injectable } from '@angular/core';
import { SessionService } from './session.service';
import type { RequestEditorSection } from '@models/settings';

/** Sub-tabs in the folder editor (variables, headers, etc.). */
export type FolderEditorSection =
  | 'variables'
  | 'headers'
  | 'scripts'
  | 'auth'
  | 'settings';

/** Per-tab UI state that should survive an app restart. */
export interface TabViewState {
  activeRequestTab?: RequestEditorSection;
  activeFolderTab?: FolderEditorSection;
  activeResponseTab?: 'body' | 'preview' | 'headers' | 'cookies' | 'raw' | 'tests' | 'diff';
  responseHeight?: number;
  isRequestHidden?: boolean;
  isResponseHidden?: boolean;
  selectedBodyType?: string;
}

type ViewStateMap = Record<string, TabViewState>;

/**
 * Persists per-tab UI state (which sub-tab is active, splitter position, etc.) so the
 * workbench reopens in exactly the configuration the user left it in.
 *
 * State is keyed by tab id. When a tab is closed, its entry is evicted via `clear()`.
 * The same state is also mirrored per **request id** via `patchRequestView()` so that
 * closing a request tab and reopening the same request still restores the last layout.
 * Folder editor sections use `patchFolderView()` the same way for **folder id**.
 */
@Injectable({ providedIn: 'root' })
export class ViewStateService {
  private static readonly KEY = 'tabViewStates';
  private static readonly REQUEST_KEY = 'requestViewStates';
  private static readonly FOLDER_KEY = 'folderViewStates';
  private cache: ViewStateMap = {};
  private requestCache: ViewStateMap = {};
  private folderCache: ViewStateMap = {};
  private loaded = false;
  private saveHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(private sessionService: SessionService) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    await this.sessionService.load(ViewStateService.KEY);
    await this.sessionService.load(ViewStateService.REQUEST_KEY);
    await this.sessionService.load(ViewStateService.FOLDER_KEY);
    this.cache = this.sessionService.get<ViewStateMap>(ViewStateService.KEY) ?? {};
    this.requestCache = this.sessionService.get<ViewStateMap>(ViewStateService.REQUEST_KEY) ?? {};
    this.folderCache = this.sessionService.get<ViewStateMap>(ViewStateService.FOLDER_KEY) ?? {};
    this.loaded = true;
  }

  get(tabId: string): TabViewState | undefined {
    return this.cache[tabId];
  }

  patch(tabId: string, partial: TabViewState): void {
    this.cache[tabId] = { ...(this.cache[tabId] ?? {}), ...partial };
    this.scheduleFlush();
  }

  clear(tabId: string): void {
    if (!(tabId in this.cache)) return;
    delete this.cache[tabId];
    this.scheduleFlush();
  }

  /** Per-request (survives tab close and `retainOnly`). Keyed by request id. */
  getRequestView(requestId: string): TabViewState | undefined {
    return this.requestCache[requestId];
  }

  patchRequestView(requestId: string, partial: TabViewState): void {
    this.requestCache[requestId] = { ...(this.requestCache[requestId] ?? {}), ...partial };
    this.scheduleFlush();
  }

  clearRequestView(requestId: string): void {
    if (!(requestId in this.requestCache)) return;
    delete this.requestCache[requestId];
    this.scheduleFlush();
  }

  /** Per-folder (survives tab close and `retainOnly`). Keyed by folder id. */
  getFolderView(folderId: string): TabViewState | undefined {
    return this.folderCache[folderId];
  }

  patchFolderView(folderId: string, partial: TabViewState): void {
    this.folderCache[folderId] = { ...(this.folderCache[folderId] ?? {}), ...partial };
    this.scheduleFlush();
  }

  clearFolderView(folderId: string): void {
    if (!(folderId in this.folderCache)) return;
    delete this.folderCache[folderId];
    this.scheduleFlush();
  }

  /** Drops every entry whose id is not in `keepIds`. Use after restoring tabs on boot. */
  retainOnly(keepIds: string[]): void {
    const keep = new Set(keepIds);
    let changed = false;
    for (const id of Object.keys(this.cache)) {
      if (!keep.has(id)) {
        delete this.cache[id];
        changed = true;
      }
    }
    if (changed) this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.saveHandle !== null) clearTimeout(this.saveHandle);
    this.saveHandle = setTimeout(() => {
      this.saveHandle = null;
      void this.sessionService.save(ViewStateService.KEY, this.cache);
      void this.sessionService.save(ViewStateService.REQUEST_KEY, this.requestCache);
      void this.sessionService.save(ViewStateService.FOLDER_KEY, this.folderCache);
    }, 200);
  }
}
