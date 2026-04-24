import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import type { UpdaterStatus } from '../../../shared/electron';

/**
 * Bridges the Electron `updater:*` IPC surface to the Angular world as a single
 * `status$` stream. Every main-process status push is funneled back through
 * `NgZone.run` so templates react without manual `markForCheck`.
 */
@Injectable({ providedIn: 'root' })
export class UpdateService implements OnDestroy {
  private readonly status$ = new BehaviorSubject<UpdaterStatus>({
    state: 'idle',
    currentVersion: '',
    supported: false,
    info: null,
  });

  private unsubscribe?: () => void;
  /** When true, after `downloaded` we immediately invoke quit-and-install (one-shot). */
  private installAfterDownload = false;

  constructor(private zone: NgZone) {
    this.start();
  }

  get statusStream(): Observable<UpdaterStatus> {
    return this.status$.asObservable();
  }

  get currentStatus(): UpdaterStatus {
    return this.status$.value;
  }

  private async start(): Promise<void> {
    const api = window.awElectron;
    if (!api?.getUpdaterStatus) return;

    try {
      const initial = await api.getUpdaterStatus();
      this.zone.run(() => this.status$.next(initial));
    } catch (err) {
      console.error('Failed to read initial updater status', err);
    }

    this.unsubscribe = api.onUpdaterStatus((status) => {
      this.zone.run(() => {
        if (status.state === 'downloaded' && this.installAfterDownload && status.supported) {
          this.installAfterDownload = false;
          this.status$.next(status);
          queueMicrotask(() => window.awElectron?.installUpdate?.());
          return;
        }
        if (status.state === 'error') {
          this.installAfterDownload = false;
        }
        this.status$.next(status);
      });
    });
  }

  /** Clear chained install (e.g. user dismissed banner mid-download). */
  cancelChainedInstall(): void {
    this.installAfterDownload = false;
  }

  /** Download then automatically quit and install once the package is ready. */
  downloadAndInstall(): void {
    this.installAfterDownload = true;
    void this.downloadUpdate();
  }

  async checkForUpdates(): Promise<void> {
    const api = window.awElectron;
    if (!api?.checkForUpdates) return;
    try {
      const status = await api.checkForUpdates();
      this.zone.run(() => this.status$.next(status));
    } catch (err) {
      console.error('Failed to check for updates', err);
    }
  }

  async downloadUpdate(): Promise<void> {
    const api = window.awElectron;
    if (!api?.downloadUpdate) return;
    try {
      const status = await api.downloadUpdate();
      this.zone.run(() => this.status$.next(status));
    } catch (err) {
      console.error('Failed to download update', err);
    }
  }

  installUpdate(): void {
    window.awElectron?.installUpdate?.();
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
  }
}
