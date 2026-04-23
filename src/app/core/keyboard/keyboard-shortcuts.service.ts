import { DestroyRef, Injectable, NgZone, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { fromEvent } from 'rxjs';
import { SettingsService } from '@core/settings/settings.service';
import type { Settings } from '@models/settings';
import {
  KEYBOARD_SHORTCUT_CATALOG,
  type KeyboardShortcutDefinition,
} from './keyboard-shortcut-catalog';
import { keyboardEventMatchesChord } from './chord-matcher';

type HandlerFn = () => boolean | void;

/**
 * Global shortcuts: document keydown (capture). Handlers register by catalog id; first
 * handler that returns `true` stops propagation. Settings merge overrides onto default chords.
 *
 * Precedence: catalog order; skip flags on definitions; skip shortcuts panel Mod+Slash when
 * focus is in a code-editor textarea so the editor can use the same chord.
 */
@Injectable({ providedIn: 'root' })
export class KeyboardShortcutsService {
  private readonly handlers = new Map<string, HandlerFn[]>();
  private readonly settings = inject(SettingsService);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.zone.runOutsideAngular(() => {
      fromEvent<KeyboardEvent>(document, 'keydown', { capture: true })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((ev) => this.onDocumentKeydownCapture(ev));
    });
  }

  /** Effective chord for an action (user override or catalog default). */
  effectiveChord(actionId: string): string {
    const entry = KEYBOARD_SHORTCUT_CATALOG.find((d) => d.id === actionId);
    if (!entry) return '';
    const s: Settings = this.settings.getSettings();
    const o = s.keyboard?.bindings?.[actionId];
    return (o && o.trim()) || entry.defaultChord;
  }

  /** Whether a keydown matches an editor-scoped action (for use inside CodeEditorComponent). */
  matchesEditorAction(actionId: string, ev: KeyboardEvent): boolean {
    const def = KEYBOARD_SHORTCUT_CATALOG.find((d) => d.id === actionId && d.scope === 'editor');
    if (!def) return false;
    return keyboardEventMatchesChord(ev, this.effectiveChord(actionId));
  }

  /**
   * Register a handler for a catalog action. Returns unregister function.
   * Multiple handlers per id are invoked newest-first until one returns `true`.
   */
  register(actionId: string, fn: HandlerFn): () => void {
    let list = this.handlers.get(actionId);
    if (!list) {
      list = [];
      this.handlers.set(actionId, list);
    }
    list.push(fn);
    return () => {
      const l = this.handlers.get(actionId);
      if (!l) return;
      const i = l.lastIndexOf(fn);
      if (i !== -1) l.splice(i, 1);
    };
  }

  /** Labels + categories for settings UI (global + editor). */
  getCatalog(): readonly KeyboardShortcutDefinition[] {
    return KEYBOARD_SHORTCUT_CATALOG;
  }

  private onDocumentKeydownCapture(ev: KeyboardEvent): void {
    if (ev.defaultPrevented) return;
    const target = ev.target as HTMLElement | null;

    for (const def of KEYBOARD_SHORTCUT_CATALOG) {
      if (def.scope !== 'global') continue;
      const chord = this.effectiveChord(def.id);
      if (!chord || !keyboardEventMatchesChord(ev, chord)) continue;
      if (def.skipWhenInEditableField && this.isInEditableField(target)) continue;
      if (def.skipWhenInCodeEditorTextarea && this.isInCodeEditorTextarea(target)) continue;

      const list = this.handlers.get(def.id);
      if (!list?.length) continue;

      let handled = false;
      this.zone.run(() => {
        for (let i = list.length - 1; i >= 0; i--) {
          const consumed = list[i]();
          if (consumed !== false) {
            handled = true;
            return;
          }
        }
      });
      if (handled) {
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
    }
  }

  private isInEditableField(el: HTMLElement | null): boolean {
    return !!el?.closest?.('input, textarea, select, [contenteditable="true"]');
  }

  private isInCodeEditorTextarea(el: HTMLElement | null): boolean {
    return !!el?.closest?.(
      '.code-editor-container textarea.code-input, .simple-editor-container textarea.code-input',
    );
  }
}
