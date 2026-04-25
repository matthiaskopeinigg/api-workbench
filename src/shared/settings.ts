import { HttpHeader, HttpMethod } from './request';

export interface Settings {
  ui: UiSettings;
  requests: RequestSettings;
  retries: RetrySettings;
  headers: HeaderSettings;
  ssl: SslSettings;
  dns: DnsSettings;
  proxy: ProxySettings;
  logging: LoggingSettings;
  databases: DatabaseSettings;
  /** Optional keyboard chord overrides (action id → chord, e.g. Mod+KeyK). */
  keyboard?: KeyboardSettings;
}

/** Per-action chord overrides; omitted keys use built-in defaults from the shortcut catalog. */
export interface KeyboardSettings {
  bindings?: Record<string, string>;
}

export interface UiSettings {
  theme: Theme;
  closeSidebarOnOutsideClick: boolean;
  saveOpenTabs: boolean;
  folderClickBehavior: 'open' | 'expand' | 'both';
  compactMode: boolean;
  hideRequestMethod: boolean;
}

/**
 * Sub-tabs in the main request editor (URL bar area). Per-tab view state, when
 * present, overrides {@link RequestSettings.defaultRequestEditorSection}.
 */
export type RequestEditorSection =
  | 'params'
  | 'headers'
  | 'body'
  | 'scripts'
  | 'auth'
  | 'settings';

export interface RequestSettings {
  defaultHttpMethod: HttpMethod;
  timeoutMs: number;
  useCookies: boolean;
  /**
   * When true and the target server advertises h2 via ALPN, the HTTP stack
   * speaks HTTP/2. Off by default so existing HTTP/1.1-tuned workflows are
   * unaffected.
   */
  allowHttp2?: boolean;
  /**
   * Which section is active when a request tab opens and has no saved
   * per-tab UI state (or only partial state without `activeRequestTab`).
   */
  defaultRequestEditorSection: RequestEditorSection;
}

export interface RetrySettings {
  retryOnFailure: boolean;
  retryCount: number;
  retryDelayMs: number;
  exponentialBackoff: boolean;
}

export interface HeaderSettings {
  addDefaultHeaders: boolean;
  defaultHeaders: HttpHeader[];
}

export interface SslSettings {
  certificates: Certificate[];
  ignoreInvalidSsl: boolean;            
  verifyHostname: boolean;
  useSystemCaStore: boolean;
  customCaPaths: string[];
}

export interface Certificate {
  hostname: string;
  crtFilePath: string;
  keyFilePath: string;
  pfxFilePath: string;
  passphrase: string;
}

export interface DnsSettings {
  customDnsServer: string | null;
}

export interface ProxySettings {
  useSystem: boolean;
  /**
   * `socks` is kept as a backwards-compatible alias for SOCKS5. New values
   * (`socks4`/`socks5`/`socks5h`) let users opt into a specific variant and,
   * in the case of `socks5h`, defer DNS resolution to the proxy.
   */
  type: 'http' | 'https' | 'socks' | 'socks4' | 'socks5' | 'socks5h';
  host: string;
  port: number;
  user: string;
  password: string;
  noProxy: string[];
}

export interface LoggingSettings {
  enableRequestLogging: boolean;
  enableResponseLogging: boolean;
  logToFile: boolean;
  logFilePath: string;
  maxLogFileSizeKb: number;
}

export enum Theme {
  SYSTEM = 'system',
  LIGHT = 'light',
  DARK = 'dark',
  HIGH_CONTRAST_DARK = 'high-contrast-dark',
  HIGH_CONTRAST_DARKLIGHT = 'high-contrast-darklight',
  AYU_LIGHT = 'ayu-light',
  AYU_DARK = 'ayu-dark',
  DRACULA = 'dracula',
  MONOKAI = 'monokai',
  NIGHT_OWL_LIGHT = 'night-owl-light',
  NIGHT_OWL_DARK = 'night-owl-dark',
  SOLARIZED_LIGHT = 'solarized-light',
  SOLARIZED_DARK = 'solarized-dark'
}

export interface DatabaseSettings {
  connections: DatabaseConnection[];
}

export interface DatabaseConnection {
  id: string;
  name: string;
  type: 'redis' | 'postgresql' | 'mysql' | 'mssql';
  host: string;
  port: number;
  user?: string;
  password?: string;
  database?: string;
  tls?: boolean;
}

