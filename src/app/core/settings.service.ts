import { Injectable } from '@angular/core';
import { Settings, Theme } from '@models/settings';
import { HttpMethod } from '@models/request';

const DEFAULT_SETTINGS: Settings = {
  ui: {
    theme: Theme.SYSTEM,
    closeSidebarOnOutsideClick: false,
    saveOpenTabs: true,
    folderClickBehavior: 'both',
    compactMode: false,
    hideRequestMethod: false
  },
  requests: {
    defaultHttpMethod: HttpMethod.GET,
    timeoutMs: 10000,
    useCookies: true,
    allowHttp2: false,
  },
  retries: {
    retryOnFailure: false,
    retryCount: 0,
    retryDelayMs: 1000,
    exponentialBackoff: false
  },
  headers: {
    addDefaultHeaders: true,
    defaultHeaders: [
      { key: 'User-Agent', value: 'api-workbench/1.0.1', enabled: true },
      { key: 'Accept', value: '*', enabled: true },
      { key: 'Accept-Encoding', value: 'gzip, deflate, br', enabled: true },
      { key: 'Connection', value: 'keep-alive', enabled: true }
    ]
  },
  ssl: {
    certificates: [],
    ignoreInvalidSsl: false,
    verifyHostname: true,
    useSystemCaStore: true,
    customCaPaths: []
  },
  dns: { customDnsServer: null },
  proxy: {
    useSystem: true,
    type: 'http',
    host: '',
    port: 8080,
    user: '',
    password: '',
    noProxy: []
  },
  logging: {
    enableRequestLogging: false,
    enableResponseLogging: false,
    logToFile: false,
    logFilePath: '',
    maxLogFileSizeKb: 1024
  }
};

@Injectable({
  providedIn: 'root',
})
export class SettingsService {

  private cache: Settings | null = null;
  private loadPromise: Promise<void> | null = null;

  async loadSettings(): Promise<void> {
    if (this.cache) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      try {
        const result = await window.awElectron.getSettings();
        if (result) {

          this.cache = this.deepMerge(DEFAULT_SETTINGS, result);
        } else {
          this.cache = { ...DEFAULT_SETTINGS };
        }
      } finally {
        this.loadPromise = null;
      }
    })();

    return this.loadPromise;
  }

  getSettings(): Settings {
    if (!this.cache) {

      return { ...DEFAULT_SETTINGS };
    }
    return this.cache;
  }

  async saveSettings(settings: Settings): Promise<void> {
    this.cache = settings;
    await window.awElectron.saveSettings(settings);
  }

  private deepMerge<T extends object>(target: T, source: Partial<T>): T {
    const output = { ...target };
    if (isObject(target) && isObject(source)) {
      Object.keys(source).forEach(key => {
        const k = key as keyof T;
        if (isObject(source[k])) {
          if (!(k in target)) {
            Object.assign(output, { [k]: source[k] });
          } else {

            (output as any)[k] = this.deepMerge((target as any)[k], (source as any)[k]);
          }
        } else {
          Object.assign(output, { [k]: source[k] });
        }
      });
    }
    return output;
  }
}

function isObject(item: any) {
  return (item && typeof item === 'object' && !Array.isArray(item));
}


