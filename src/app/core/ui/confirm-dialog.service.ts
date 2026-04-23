import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface ConfirmDialogOptions {
  /** Dialog title (default: API Workbench). */
  title?: string;
  message: string;
  confirmLabel?: string;
  /** Omit for default “Cancel”; `null` for alert-style (OK only). */
  cancelLabel?: string | null;
  /** Emphasize destructive actions (delete, clear all, …). */
  destructive?: boolean;
}

export interface ConfirmDialogOpenState {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string | null;
  destructive: boolean;
}

type QueuedItem =
  | { mode: 'confirm'; payload: ConfirmDialogOpenState; resolve: (v: boolean) => void }
  | { mode: 'alert'; payload: ConfirmDialogOpenState; resolve: () => void };

const DEFAULT_TITLE = 'API Workbench';

/**
 * In-app confirm / alert modals (replaces {@link window.confirm} / {@link window.alert}).
 * UI is rendered by {@link ConfirmDialogHostComponent} in the app shell.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmDialogService {
  private readonly queue: QueuedItem[] = [];
  private readonly activeSubject = new BehaviorSubject<QueuedItem | null>(null);

  /** Current dialog (or null) — used by the host component. */
  readonly active$ = this.activeSubject.asObservable();

  get activeSnapshot(): QueuedItem | null {
    return this.activeSubject.value;
  }

  /**
   * Shows Cancel + Confirm. Resolves `true` if the user confirms, `false` otherwise
   * (Cancel, backdrop, Escape).
   */
  confirm(options: ConfirmDialogOptions): Promise<boolean> {
    const payload = this.toPayload(options, false);
    return new Promise((resolve) => {
      this.queue.push({ mode: 'confirm', payload, resolve });
      this.pump();
    });
  }

  /** Single OK button (informational). */
  alert(message: string, title?: string): Promise<void> {
    const payload = this.toPayload(
      {
        message,
        title: title ?? 'Notice',
        confirmLabel: 'OK',
        cancelLabel: null,
        destructive: false,
      },
      true,
    );
    return new Promise((resolve) => {
      this.queue.push({
        mode: 'alert',
        payload,
        resolve: () => resolve(),
      });
      this.pump();
    });
  }

  /** Called by the host when the user confirms, cancels, or dismisses. */
  finish(result: boolean): void {
    const cur = this.activeSubject.value;
    if (!cur) {
      return;
    }
    if (cur.mode === 'confirm') {
      cur.resolve(result);
    } else {
      cur.resolve();
    }
    this.activeSubject.next(null);
    this.pump();
  }

  private toPayload(options: ConfirmDialogOptions, alertOnly: boolean): ConfirmDialogOpenState {
    return {
      title: (options.title ?? DEFAULT_TITLE).trim() || DEFAULT_TITLE,
      message: options.message,
      confirmLabel:
        (options.confirmLabel ?? (alertOnly ? 'OK' : 'Confirm')).trim() || (alertOnly ? 'OK' : 'Confirm'),
      cancelLabel:
        options.cancelLabel === undefined
          ? alertOnly
            ? null
            : 'Cancel'
          : options.cancelLabel === null
            ? null
            : String(options.cancelLabel).trim() || 'Cancel',
      destructive: !!options.destructive,
    };
  }

  private pump(): void {
    if (this.activeSubject.value !== null || this.queue.length === 0) {
      return;
    }
    const next = this.queue.shift()!;
    this.activeSubject.next(next);
  }
}
