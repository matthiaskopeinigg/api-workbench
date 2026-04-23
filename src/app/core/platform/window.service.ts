import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class WindowService {

  minimize(): void {
    window.awElectron.minimizeWindow();
  }

  maximize(): void {
    window.awElectron.maximizeWindow();
  }

  close(): void {
    window.awElectron.closeWindow();
  }

  /**
   * Opens a link in the default browser. In Electron, uses the main-process
   * `shell.openExternal` path so the page does not load inside the app window.
   * Falls back to `window.open` when the bridge is unavailable (e.g. web build).
   */
  openUrlInSystemBrowser(url: string): void {
    if (typeof window === 'undefined' || !url) return;
    if (window.awElectron?.openExternalUrl) {
      void window.awElectron.openExternalUrl(url);
      return;
    }
    const w = window.open(url, '_blank', 'noopener,noreferrer');
    if (w) w.opener = null;
  }

}


