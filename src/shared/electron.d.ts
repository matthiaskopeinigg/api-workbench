import { Settings } from './settings';
import { Collection } from './collection';
import { Environment } from './environment';
import { FileDialogResult, OpenFilesDialogResult, ReadImportFolderOptions, SaveFileOptions, WriteFilesToDirectoryResult } from './file-dialog';
import type { IpcHttpRequest } from './ipc-http-request';
import type { IpcHttpResponse } from './ipc-http-response';

export interface OAuth2AuthConfig {
  authUrl: string;
  clientId: string;
  redirectUri: string;
  scope?: string;
}

export interface OAuth2TokenExchangeConfig {
  tokenUrl: string;
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface OAuth2ClientCredentialsConfig {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
}

export type UpdaterState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'disabled';

export interface UpdaterStatus {
  state: UpdaterState;
  currentVersion: string;
  supported: boolean;
  info:
    | null
    | {
        version?: string;
        releaseNotes?: string | null;
        releaseDate?: string;
        percent?: number;
        bytesPerSecond?: number;
        transferred?: number;
        total?: number;
        message?: string;
        reason?: string;
      };
}

export interface StorageInfo {
  userData: string;
  databasePath: string;
  markerFile: string;
  markerDir: string;
  overrideSource: 'env' | 'marker' | null;
  overrideTarget: string | null;
  env: string | null;
}

export interface AwElectronApi {
  getSettings: () => Promise<Settings | undefined>;
  saveSettings: (settings: Settings) => Promise<void>;

  getCollections: () => Promise<Collection[]>;
  saveCollections: (collections: Collection[]) => Promise<void>;

  getEnvironments: () => Promise<Environment[]>;
  saveEnvironments: (environments: Environment[]) => Promise<void>;

  getSession: <T = unknown>(key: string) => Promise<T | null | undefined>;
  saveSession: <T = unknown>(key: string, value: T) => Promise<void>;

  openFileDialog: <T = unknown>(extensions?: string[]) => Promise<FileDialogResult<T> | null>;
  /** Multi-select. Returns `{ files: [...] }` or `null` if cancelled. */
  openFilesDialog: <T = unknown>(extensions?: string[]) => Promise<OpenFilesDialogResult | null>;
  readImportFolder: (options?: ReadImportFolderOptions) => Promise<OpenFilesDialogResult | null>;
  openDirectoryDialog: () => Promise<string | null>;
  writeFilesToDirectory: (options: { dir: string; files: Array<{ name: string; data: string }> }) => Promise<WriteFilesToDirectoryResult>;
  saveFileDialog: <T = unknown>(options: SaveFileOptions<T>) => Promise<string | null>;

  /** Path-only file picker used when main reads the file at send time. */
  pickFilePath: (options?: { filters?: Array<{ name: string; extensions: string[] }> }) => Promise<{ path: string; size?: number } | null>;

  /** Save a response body to disk (text or base64 binary). */
  saveResponseBody: (payload: {
    body: string | unknown;
    isBinary?: boolean;
    binaryBase64?: string;
    defaultName?: string;
    contentType?: string;
  }) => Promise<string | null>;

  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;
  /** Open a URL in the system default browser. */
  openExternalUrl: (url: string) => Promise<{ ok: boolean; error?: string }>;

  httpRequest: (request: IpcHttpRequest) => Promise<IpcHttpResponse | null>;
  getAllCookies: () => Promise<object[]>;
  deleteCookie: (domain: string, path: string, name: string) => Promise<void>;
  clearAllCookies: () => Promise<void>;
  runScript: (code: string, context: unknown) => Promise<unknown>;
  appReady: () => void;

  getOAuth2Token: (config: OAuth2AuthConfig) => Promise<{ code: string } | null>;
  exchangeOAuth2Code: (config: OAuth2TokenExchangeConfig) => Promise<Record<string, unknown>>;
  getOAuth2ClientCredentials: (config: OAuth2ClientCredentialsConfig) => Promise<Record<string, unknown>>;

  getUpdaterStatus: () => Promise<UpdaterStatus>;
  checkForUpdates: () => Promise<UpdaterStatus>;
  downloadUpdate: () => Promise<UpdaterStatus>;
  installUpdate: () => void;
  onUpdaterStatus: (listener: (status: UpdaterStatus) => void) => () => void;

  mockStart: (port?: number) => Promise<MockServerStatus>;
  mockStop: () => Promise<MockServerStatus>;
  mockRestart: () => Promise<MockServerStatus>;
  mockStatus: () => Promise<MockServerStatus>;
  mockGetOptions: () => Promise<MockServerOptions>;
  mockSetOptions: (partial: Partial<MockServerOptions>) => Promise<{ ok: boolean; options?: MockServerOptions; error?: string }>;
  mockRegister: (payload: MockRegisterPayload) => Promise<{ ok: boolean; status?: MockServerStatus; error?: string }>;
  mockUnregister: (requestId: string) => Promise<{ ok: boolean }>;
  mockClear: () => Promise<{ ok: boolean }>;
  mockHitsList: () => Promise<MockHit[]>;
  mockHitsClear: () => Promise<{ ok: boolean }>;
  mockStandaloneRegister: (endpoint: StandaloneMockEndpointInput) => Promise<{ ok: boolean; endpoint?: StandaloneMockEndpoint | null; error?: string }>;
  mockStandaloneUnregister: (id: string) => Promise<{ ok: boolean }>;
  mockStandaloneList: () => Promise<StandaloneMockEndpoint[]>;
  onMockHits: (listener: (batch: MockHit[]) => void) => () => void;

  historyAppend: (entry: ResponseHistoryEntryInput) => Promise<number | null>;
  historyList: (requestId: string, limit?: number) => Promise<ResponseHistoryListItem[]>;
  historyGet: (id: number) => Promise<ResponseHistoryFullEntry | null>;
  historyClear: (requestId: string) => Promise<boolean>;

  wsConnect: (payload: {
    connectionId: string;
    url: string;
    protocols?: string[];
    headers?: Record<string, string>;
    mode?: 'ws' | 'sse';
  }) => Promise<{ connectionId: string }>;
  wsSend: (payload: { connectionId: string; data: string; isBinary?: boolean }) => Promise<{ ok: boolean }>;
  wsClose: (payload: { connectionId: string; code?: number; reason?: string }) => Promise<{ ok: boolean }>;
  onWsEvent: (
    connectionId: string,
    listener: (event: WebSocketIncomingEvent) => void
  ) => () => void;

  testingList: <T = unknown>(kind: TestingArtifactKind) => Promise<T[]>;
  testingSave: (kind: TestingArtifactKind, items: unknown[]) => Promise<{ ok: boolean; error?: string }>;

  loadStart: (config: import('./testing/load-test').LoadTestConfig) =>
    Promise<{ ok: boolean; runId?: string; error?: string }>;
  loadCancel: (runId: string) => Promise<{ ok: boolean }>;
  loadStatus: (runId: string) => Promise<import('./testing/load-test').LoadProgressEvent | null>;
  onLoadProgress: (
    runId: string,
    listener: (event: import('./testing/load-test').LoadProgressEvent) => void,
  ) => () => void;
  onLoadDone: (
    runId: string,
    listener: (result: import('./testing/load-test').LoadRunResult) => void,
  ) => () => void;

  getStorageInfo: () => Promise<StorageInfo>;
  openUserDataDirectory: () => Promise<{ ok: boolean; path?: string; error?: string }>;
  openConfigMarkerDirectory: () => Promise<{ ok: boolean; path?: string; error?: string }>;
  chooseDataDirectory: () => Promise<
    | { ok: true; path: string; needsRestart: true }
    | { ok: false; cancelled?: boolean; error?: string }
  >;
  resetDataDirectoryOverride: () => Promise<
    { ok: true; needsRestart: true } | { ok: false; error?: string }
  >;
}

export type TestingArtifactKind =
  | 'loadTests'
  | 'testSuites'
  | 'contractTests'
  | 'flows'
  | 'testSuiteSnapshots';

export type MockServerState = 'stopped' | 'starting' | 'running' | 'error';

export interface MockServerOptions {
  /** null means auto-assign an ephemeral port. */
  port: number | null;
  bindAddress: '127.0.0.1' | '0.0.0.0';
  defaultDelayMs: number;
  defaultContentType: string;
  corsMode: 'off' | 'all' | 'list';
  corsOrigins?: string[];
  /** Auto-start the mock server when the app launches. */
  autoStart: boolean;
  /** Capture request/response bodies in the activity feed (truncated at 64 KB). */
  captureBodies: boolean;
}

export interface MockServerStatus {
  host: string;
  port: number;
  status: MockServerState;
  error: string | null;
  baseUrl: string;
  /** Currently-effective server options. */
  options?: MockServerOptions;
  registered: Array<{ requestId: string; variantCount: number; activeVariantId: string | null }>;
  standalone?: Array<{
    id: string;
    name?: string;
    method: string;
    path: string;
    variantCount: number;
    activeVariantId: string | null;
  }>;
}

/**
 * One served (or 404'd) request through the mock server. Streamed in batches
 * over the `mock:hits` channel.
 */
export interface MockHit {
  id: string;
  receivedAt: number;
  method: string;
  path: string;
  matchedKind: 'request' | 'standalone' | 'none';
  matchedRequestId: string | null;
  matchedVariantId: string | null;
  matchedVariantName: string | null;
  status: number;
  latencyMs: number;
  reqHeaders: Array<{ key: string; value: string }>;
  reqBody: string | null;
  resHeaders: Array<{ key: string; value: string }>;
  resBody: string | null;
}

export interface StandaloneMockEndpointInput {
  id?: string;
  /** Optional label for the sidebar; empty means show path. */
  name?: string;
  method: string;
  path: string;
  variants: Array<{
    id?: string;
    name?: string;
    statusCode: number;
    statusText?: string;
    headers?: Array<{ key: string; value: string }>;
    body?: string;
    delayMs?: number;
  }>;
  activeVariantId?: string | null;
}

export interface StandaloneMockEndpoint {
  id: string;
  /** Display name in the list; empty string means use path as the main label. */
  name: string;
  method: string;
  path: string;
  variants: Array<{
    id: string;
    name: string;
    statusCode: number;
    statusText?: string;
    headers: Array<{ key: string; value: string }>;
    body: string;
    delayMs: number;
  }>;
  activeVariantId: string | null;
}

export interface MockRegisterPayload {
  requestId: string;
  variants: Array<{
    id: string;
    name: string;
    statusCode: number;
    statusText?: string;
    headers?: Array<{ key: string; value: string }>;
    body?: string;
    delayMs?: number;
    matchOn?: { method?: string; pathContains?: string };
  }>;
  activeVariantId?: string;
}

export interface ResponseHistoryEntryInput {
  requestId: string;
  receivedAt: number;
  statusCode?: number;
  statusText?: string;
  timeMs?: number;
  size?: number;
  httpVersion?: string;
  contentType?: string;
  headers?: Array<{ key: string; value: string }>;
  body?: string;
  isBinary?: boolean;
}

export interface ResponseHistoryListItem {
  id: number;
  requestId: string;
  receivedAt: number;
  statusCode: number | null;
  statusText: string | null;
  timeMs: number | null;
  size: number | null;
  httpVersion: string | null;
  contentType: string | null;
  isBinary: boolean;
}

export interface ResponseHistoryFullEntry extends ResponseHistoryListItem {
  headers: Array<{ key: string; value: string }>;
  body: string | null;
}

export type WebSocketEventType = 'open' | 'message' | 'close' | 'error' | 'control';

export interface WebSocketIncomingEvent {
  type: WebSocketEventType;
  direction?: 'in' | 'out';
  data?: string;
  binaryBase64?: string;
  isBinary?: boolean;
  event?: string;
  id?: string;
  code?: number;
  reason?: string;
  message?: string;
  kind?: 'ping' | 'pong';
  protocol?: string;
  at?: number;
}

declare global {
  interface Window {
    awElectron: AwElectronApi;
  }
}

export {};
