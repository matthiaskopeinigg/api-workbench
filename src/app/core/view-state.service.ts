import { Injectable } from '@angular/core';
import { SessionService } from './session.service';

/** Per-tab UI state that should survive an app restart. */
export interface TabViewState {
  activeRequestTab?: 'params' | 'auth' | 'headers' | 'body' | 'scripts' | 'settings';
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
 * State is keyed by tab id. When a tab is closed, its entry should be evicted via
 * `clear()` to keep the session payload bounded.
 */
@Injectable({ providedIn: 'root' })
export class ViewStateService {
  private static readonly KEY = 'tabViewStates';
  private cache: ViewStateMap = {};
  private loaded = false;
  private saveHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(private sessionService: SessionService) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    await this.sessionService.load(ViewStateService.KEY);
    this.cache = this.sessionService.get<ViewStateMap>(ViewStateService.KEY) ?? {};
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
    }, 200);
  }
}
