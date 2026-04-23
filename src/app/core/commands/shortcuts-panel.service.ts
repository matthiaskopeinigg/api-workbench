import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface ShortcutEntry {
  keys: string;
  description: string;
  category: string;
}

/**
 * A curated, hand-maintained catalog of application keyboard shortcuts. We
 * intentionally keep this separate from the actual `@HostListener` sites —
 * the panel is a quick reference, not the source of truth for bindings.
 */
export const APP_SHORTCUTS: ShortcutEntry[] = [
  { keys: 'Ctrl/Cmd+K', description: 'Open command palette', category: 'Global' },
  { keys: 'Ctrl/Cmd+F', description: 'Find in response body', category: 'Response' },
  { keys: 'Ctrl/Cmd+/', description: 'Toggle keyboard shortcuts panel', category: 'Global' },
  { keys: 'Esc', description: 'Close dialog / palette / overlay', category: 'Global' },
  { keys: 'Enter', description: 'Run highlighted command / send request', category: 'General' },
  { keys: '↑ / ↓', description: 'Navigate lists in palette & dropdowns', category: 'Navigation' },
];

@Injectable({ providedIn: 'root' })
export class ShortcutsPanelService {
  private readonly open$ = new BehaviorSubject<boolean>(false);

  isOpen(): Observable<boolean> {
    return this.open$.asObservable();
  }

  getSnapshot(): boolean {
    return this.open$.value;
  }

  open(): void {
    this.open$.next(true);
  }

  close(): void {
    this.open$.next(false);
  }

  toggle(): void {
    this.open$.next(!this.open$.value);
  }
}
