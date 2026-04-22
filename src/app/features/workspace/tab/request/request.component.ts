import { Component, Input, OnChanges, OnInit, ViewChild, ElementRef, ChangeDetectionStrategy, ChangeDetectorRef, OnDestroy, SecurityContext, SimpleChanges, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Certificate } from '@models/settings';
import { SettingsService } from '@core/settings.service';
import { RequestService } from '@core/request.service';
import { CollectionService } from '@core/collection.service';
import { HttpMethod, Request, AuthType, RequestBodyMode, RequestBody, FormDataField, UrlencodedField, MockVariant } from '@models/request';
import type { IpcStructuredBody } from '@models/ipc-http-request';
import { Response, TestResult } from '@models/response';

/**
 * Structured result of a main-process script run. Mirrors what
 * `electron/services/script.service.js` returns.
 */
interface ScriptRunResult {
  value?: unknown;
  testResults?: TestResult[];
  envChanges?: Array<{ op: 'set' | 'unset'; key: string; value?: string }>;
  varChanges?: Array<{ op: 'set' | 'unset'; key: string; value?: string }>;
  globalChanges?: Array<{ op: 'set' | 'unset'; key: string; value?: string }>;
  consoleLogs?: Array<{ level: string; args: string[] }>;
  errors?: Array<{ message: string; stack?: string }>;
}
import { TabItem, TabService, TabType } from '@core/tab.service';
import { RequestHistoryService } from '@core/request-history.service';
import { RequestHistoryEntry } from '@models/request-history';
import { v4 as uuidv4 } from 'uuid';
import { CodeEditorComponent, EditorLanguage } from '../../shared/code-editor/code-editor.component';
import { EnvironmentsService } from '@core/environments.service';
import { Environment } from '@models/environment';
import { VariableInputComponent } from '@shared-app/components/variable-input/variable-input.component';
import { Subject, takeUntil } from 'rxjs';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { CodeSnippetsDialogComponent } from '../../shared/code-snippets-dialog/code-snippets-dialog.component';
import { ScriptService } from '@core/script.service';
import { DropdownComponent, DropdownOption } from '../../shared/dropdown/dropdown.component';
import { ResponseSearchComponent, ResponseSearchSegment, ResponseSearchMatch } from '../../shared/response-search/response-search.component';
import { ViewStateService, TabViewState } from '@core/view-state.service';
import { cleanKv, hasKey, pruneEmptyKv } from '@core/kv-utils';
import { AuthSignerService } from '@core/auth-signer.service';
import { ResponseHistoryService } from '@core/response-history.service';
import { ResponseDiffComponent } from './response-diff/response-diff.component';
import { MockServerService } from '@core/mock-server.service';
import type { MockServerStatus } from '@models/electron';

@Component({
  selector: 'app-request',
  imports: [CommonModule, CodeEditorComponent, VariableInputComponent, FormsModule, CodeSnippetsDialogComponent, DropdownComponent, ResponseSearchComponent, ResponseDiffComponent],
  templateUrl: './request.component.html',
  styleUrl: './request.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RequestComponent implements OnInit, OnChanges, OnDestroy {

  @Input() tab!: TabItem;

  request!: Request;
  response?: Response;
  environments: Environment[] = [];
  selectedEnvironmentId: string | null = null;
  activeVariables: Record<string, string> = {};

  mockStatus: MockServerStatus = {
    host: '127.0.0.1',
    port: 0,
    status: 'stopped',
    error: null,
    baseUrl: '',
    registered: [],
  };

  httpMethods: DropdownOption[] = Object.keys(HttpMethod)
    .filter(k => isNaN(Number(k)))
    .map(k => ({ label: k, value: k }));

  HttpMethod = HttpMethod;

  activeRequestTab: 'params' | 'auth' | 'headers' | 'body' | 'scripts' | 'settings' = 'body';
  activeResponseTab: 'body' | 'preview' | 'headers' | 'cookies' | 'raw' | 'tests' | 'diff' = 'body';
  isLoading = false;
  showSnippets = false;
  requestTabsHeight = 400;
  private isResizing = false;
  isRequestHidden = false;
  isResponseHidden = false;

  authTypeOptions: DropdownOption[] = [
    { label: 'Inherit from parent', value: 'inherit' },
    { label: 'No Auth', value: 'none' },
    { label: 'Bearer Token', value: 'bearer' },
    { label: 'Basic Auth', value: 'basic' },
    { label: 'API Key', value: 'api_key' },
    { label: 'OAuth 2.0', value: 'oauth2' },
    { label: 'Digest Auth', value: 'digest' },
    { label: 'AWS Signature v4', value: 'aws_sigv4' },
    { label: 'Hawk', value: 'hawk' },
    { label: 'NTLM', value: 'ntlm' }
  ];

  digestAlgorithmOptions: DropdownOption[] = [
    { label: 'MD5', value: 'MD5' },
    { label: 'MD5-sess', value: 'MD5-sess' },
    { label: 'SHA-256', value: 'SHA-256' },
    { label: 'SHA-256-sess', value: 'SHA-256-sess' },
  ];

  digestQopOptions: DropdownOption[] = [
    { label: 'None', value: '' },
    { label: 'auth', value: 'auth' },
    { label: 'auth-int', value: 'auth-int' },
  ];

  awsAddToOptions: DropdownOption[] = [
    { label: 'Request Headers', value: 'header' },
    { label: 'Query Params (presign)', value: 'query' },
  ];

  hawkAlgorithmOptions: DropdownOption[] = [
    { label: 'SHA-256', value: 'sha256' },
    { label: 'SHA-1', value: 'sha1' },
  ];

  apiKeyLocationOptions: DropdownOption[] = [
    { label: 'Header', value: 'header' },
    { label: 'Query Params', value: 'query' }
  ];

  oauthGrantTypeOptions: DropdownOption[] = [
    { label: 'Authorization Code', value: 'authorization_code' },
    { label: 'Client Credentials', value: 'client_credentials' }
  ];

  selectedBodyType: EditorLanguage = 'json';
  /**
   * Canonical body-mode (persisted on the request). `selectedBodyType` continues
   * to drive the editor-language for raw modes (json/xml/plain/graphql) so we
   * don't break existing view-state, but structured modes (form-data,
   * urlencoded, binary) live here exclusively.
   */
  bodyMode: RequestBodyMode = 'json';

  /** Response-body search overlay state. */
  isResponseSearchOpen = false;
  responseSearchSegments: ResponseSearchSegment[] = [];
  responseSearchMatches: ResponseSearchMatch[] = [];
  responseSearchActiveIndex = 0;
  isParamsBulkEdit = false;
  paramsBulkText = '';
  isPathBulkEdit = false;
  pathBulkText = '';
  isHeadersBulkEdit = false;
  headersBulkText = '';

  @ViewChild('requestArea') requestArea!: ElementRef;

  private destroy$ = new Subject<void>();

  constructor(
    private requestService: RequestService,
    private requestHistoryService: RequestHistoryService,
    private settingsService: SettingsService,
    private scriptService: ScriptService,
    private collectionService: CollectionService,
    private environmentsService: EnvironmentsService,
    private viewState: ViewStateService,
    private authSigner: AuthSignerService,
    private responseHistory: ResponseHistoryService,
    private mockServer: MockServerService,
    private tabService: TabService,
    private cdr: ChangeDetectorRef,
    private sanitizer: DomSanitizer) {
  }

  /** Open the singleton Mock Server tab from the inline mock variant section. */
  openMockServerTab(): void {
    this.tabService.openMockServerTab();
  }

  setActiveRequestTab(tab: 'params' | 'auth' | 'headers' | 'body' | 'scripts' | 'settings') {
    this.activeRequestTab = tab;
    this.persistViewState({ activeRequestTab: tab });
    this.cdr.markForCheck();
  }

  setActiveResponseTab(tab: 'body' | 'preview' | 'headers' | 'cookies' | 'raw' | 'tests' | 'diff') {
    this.activeResponseTab = tab;
    this.persistViewState({ activeResponseTab: tab });
    this.cdr.markForCheck();
  }

  private persistViewState(partial: TabViewState) {
    if (!this.tab?.id) return;
    this.viewState.patch(this.tab.id, partial);
  }

  private restoreViewState() {
    if (!this.tab?.id) return;
    const saved = this.viewState.get(this.tab.id);
    if (!saved) return;

    if (saved.activeRequestTab) this.activeRequestTab = saved.activeRequestTab;
    if (saved.activeResponseTab) this.activeResponseTab = saved.activeResponseTab;
    if (typeof saved.responseHeight === 'number' && saved.responseHeight >= 60) {
      this.responseHeight = saved.responseHeight;
    }
    if (typeof saved.isRequestHidden === 'boolean') this.isRequestHidden = saved.isRequestHidden;
    if (typeof saved.isResponseHidden === 'boolean') this.isResponseHidden = saved.isResponseHidden;
    if (saved.selectedBodyType) this.selectedBodyType = saved.selectedBodyType as EditorLanguage;
  }

  async ngOnInit() {
    this.loadRequest();

    this.environmentsService.getEnvironmentsObservable()
      .pipe(takeUntil(this.destroy$))
      .subscribe(envs => {
        this.environments = envs;
        this.updateActiveVariables();
        this.cdr.markForCheck();
      });

    this.environmentsService.getActiveContextAsObservable()
      .pipe(takeUntil(this.destroy$))
      .subscribe(env => {
        this.selectedEnvironmentId = env?.id || null;
        this.updateActiveVariables();
        this.cdr.markForCheck();
      });

    this.mockServer.statusChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe(status => {
        this.mockStatus = status;
        this.cdr.markForCheck();
      });
    void this.mockServer.refreshStatus();
    void this.syncActiveMockVariants();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngOnChanges(changes: SimpleChanges) {
    const tabChange = changes['tab'];
    const prevId = tabChange?.previousValue?.id;
    const newId = tabChange?.currentValue?.id ?? this.tab?.id;
    if (tabChange && !tabChange.firstChange && prevId === newId) {
      return;
    }
    this.loadRequest();
    this.restoreViewState();
  }

  private loadRequest() {
    this.request = (undefined as any); 
    const original = this.collectionService.findRequestById(this.tab.id);
    if (!original) return;

    this.request = JSON.parse(JSON.stringify(original)); 
    if (!this.request.requestBody) {
      this.request.requestBody = '{}';
    }
    if (!this.request.script) {
      this.request.script = { preRequest: '', postRequest: '' };
    }

    if (this.request.script.preRequest) {

    }
    if (!this.request.httpHeaders) {
      this.request.httpHeaders = [];
    }
    this.request.httpHeaders.forEach(h => {
      if (h.enabled === undefined) h.enabled = true;
    });
    if (!this.request.httpParameters) {
      this.request.httpParameters = [];
    }

    this.request.httpParameters.forEach(p => {
      if (!p.type) p.type = 'query';
      if (p.enabled === undefined) p.enabled = true;
    });

    if (!this.request.auth) {
      this.request.auth = { type: AuthType.NONE };
    }
    if (!this.request.auth.type) {
      this.request.auth.type = AuthType.NONE;
    }
    if (this.request.auth.type === 'bearer' && !this.request.auth.bearer) this.request.auth.bearer = { token: '' };
    if (this.request.auth.type === 'basic' && !this.request.auth.basic) this.request.auth.basic = { username: '', password: '' };
    if (this.request.auth.type === 'api_key' && !this.request.auth.apiKey) this.request.auth.apiKey = { key: '', value: '', addTo: 'header' };
    if (this.request.auth.type === 'oauth2' && !this.request.auth.oauth2) this.request.auth.oauth2 = { grantType: 'authorization_code', accessToken: '' };
    if (this.request.auth.type === 'digest' && !this.request.auth.digest) this.request.auth.digest = { username: '', password: '', algorithm: 'MD5', qop: '' };
    if (this.request.auth.type === 'aws_sigv4' && !this.request.auth.awsSigV4) this.request.auth.awsSigV4 = { accessKeyId: '', secretAccessKey: '', region: 'us-east-1', service: 'execute-api', addTo: 'header' };
    if (this.request.auth.type === 'hawk' && !this.request.auth.hawk) this.request.auth.hawk = { authId: '', authKey: '', algorithm: 'sha256', includePayloadHash: false };
    if (this.request.auth.type === 'ntlm' && !this.request.auth.ntlm) this.request.auth.ntlm = { username: '', password: '' };

    if (!this.request.settings) {
      this.request.settings = { followRedirects: true, useCookies: true };
    }

    this.selectedBodyType = this.getBodyLanguage() as EditorLanguage;

    if (this.request.body?.mode) {
      this.bodyMode = this.request.body.mode;
      if (this.bodyMode === 'json' || this.bodyMode === 'xml' || this.bodyMode === 'text' || this.bodyMode === 'graphql') {
        this.selectedBodyType = this.bodyMode === 'text' ? 'plain' : (this.bodyMode as EditorLanguage);
      }
    } else {
      this.bodyMode = this.rawBodyModeFromLanguage(this.selectedBodyType);
    }

    this.syncPathVariablesFromUrl();

    const cached = this.requestService.getCachedResponse(this.request.id);
    if (cached) {
      this.response = cached;
    }
  }

  get queryParams() {
    const params = (this.request?.httpParameters || []).filter(p => p.type === 'query' || !p.type);

    if (this.request?.auth?.type === 'api_key' && this.request.auth.apiKey?.addTo === 'query') {
      const apiKey = this.request.auth.apiKey;
      if (apiKey.key) {
        params.push({
          key: apiKey.key,
          value: apiKey.value || '',
          enabled: true,
          type: 'query'
        } as any);
      }
    }

    return params;
  }

  get pathParams() {
    return (this.request?.httpParameters || []).filter(p => p.type === 'path');
  }

  get effectiveHeaders() {
    if (!this.request) return [];

    const settings = this.settingsService.getSettings();
    const headers: any[] = [];

    if (this.request.auth) {
      const auth = this.request.auth;
      if (auth.type === 'bearer' && auth.bearer?.token) {
        headers.push({
          key: 'Authorization',
          value: `Bearer ${auth.bearer.token}`,
          enabled: true,
          isDefault: true,
          isAuth: true
        });
      } else if (auth.type === 'basic' && (auth.basic?.username || auth.basic?.password)) {
        const credentials = btoa(`${auth.basic.username || ''}:${auth.basic.password || ''}`);
        headers.push({
          key: 'Authorization',
          value: `Basic ${credentials}`,
          enabled: true,
          isDefault: true,
          isAuth: true
        });
      } else if (auth.type === 'api_key' && auth.apiKey?.addTo === 'header' && auth.apiKey.key) {
        headers.push({
          key: auth.apiKey.key,
          value: auth.apiKey.value || '',
          enabled: true,
          isDefault: true,
          isAuth: true
        });
      }
    }

    const userHeaders = this.request.httpHeaders || [];
    const disabledDefaults = this.request.disabledDefaultHeaders || [];

    if (settings.headers?.addDefaultHeaders && settings.headers.defaultHeaders) {
      settings.headers.defaultHeaders.forEach(h => {
        const isOverridden = userHeaders.some(uh => uh.key.toLowerCase() === h.key.toLowerCase());
        const isEnabledInSettings = h.enabled !== false;
        const isDisabledInRequest = disabledDefaults.includes(h.key);

        headers.push({
          key: h.key,
          value: h.value,
          enabled: isEnabledInSettings && !isDisabledInRequest && !isOverridden,
          isDefault: true,
          isOverridden,
          isDisabled: isDisabledInRequest
        });
      });
    }

    userHeaders.forEach((h, index) => {
      headers.push({
        ...h,
        index,
        isDefault: false
      });
    });

    return headers;
  }

  toggleHeaderEnabled(header: any) {
    if (header.isDefault) {
      if (!this.request.disabledDefaultHeaders) {
        this.request.disabledDefaultHeaders = [];
      }

      const idx = this.request.disabledDefaultHeaders.indexOf(header.key);
      if (idx === -1) {
        this.request.disabledDefaultHeaders.push(header.key);
      } else {
        this.request.disabledDefaultHeaders.splice(idx, 1);
      }
    } else {
      const h = this.request.httpHeaders![header.index];
      if (h) {
        h.enabled = !h.enabled;
      }
    }
    this.saveRequest();
    this.cdr.markForCheck();
  }

  addOrUpdateHeader(key: string, value: string, onlyIfMissing = false) {
    if (!this.request.httpHeaders) this.request.httpHeaders = [];
    const existing = this.request.httpHeaders.find(h => h.key.toLowerCase() === key.toLowerCase());

    if (existing) {
      if (!onlyIfMissing) {
        existing.value = value;
        existing.enabled = true;
      }
    } else {
      this.request.httpHeaders.push({ key, value, enabled: true });
    }
    this.saveRequest();
  }

  private autoDetectBodySettings() {
    const body = this.request.requestBody?.trim();
    if (!body) return;

    let detectedLang: EditorLanguage = 'plain';
    let contentType = '';

    if ((body.startsWith('{') && body.endsWith('}')) || (body.startsWith('[') && body.endsWith(']'))) {
      try {
        JSON.parse(body);
        detectedLang = 'json';
        contentType = 'application/json';
      } catch (e) { }
    } else if (body.startsWith('<') && body.endsWith('>')) {
      if (body.toLowerCase().includes('<html')) {
        detectedLang = 'html';
        contentType = 'text/html';
      } else {
        detectedLang = 'xml';
        contentType = 'application/xml';
      }
    }

    if (detectedLang !== 'plain') {
      this.selectedBodyType = detectedLang;
      if (contentType) {
        this.addOrUpdateHeader('Content-Type', contentType, true);
      }
    }
  }

  get environmentOptions(): DropdownOption[] {
    const opts: DropdownOption[] = [{ label: 'No Environment', value: 'none' }];
    this.environments.forEach(e => {
      opts.push({ label: e.title, value: e.id });
    });
    return opts;
  }

  updateMethod(method: any) {
    this.request.httpMethod = HttpMethod[method as keyof typeof HttpMethod];
    this.saveRequest();
    this.cdr.markForCheck();
  }

  onEnvironmentChange(envId: any) {
    this.selectedEnvironmentId = envId === 'none' ? null : envId;
    if (this.selectedEnvironmentId) {
      const env = this.environmentsService.getEnvironmentById(this.selectedEnvironmentId);
      this.environmentsService.setActiveContext(env);
    } else {
      this.environmentsService.setActiveContext(null);
    }
    this.cdr.markForCheck();
  }

  updateUrl(event: Event) {
    let value = (event.target as HTMLInputElement).value.trim();
    if (value && !/^https?:\/\//i.test(value)) value = 'https://' + value;
    this.request.url = value;
    this.saveRequest();
    this.cdr.markForCheck();
  }

  updateUrlManual(value: string | null) {
    if (typeof value === 'string') {
      value = value.trim();
      if (value && !/^https?:\/\//i.test(value)) {

        if (!value.startsWith('{')) {
          value = 'https://' + value;
        }
      }
    }
    this.request.url = value || '';
    this.syncPathVariablesFromUrl();
    this.saveRequest();
    this.cdr.markForCheck();
  }

  private syncPathVariablesFromUrl() {
    if (!this.request.url) return;

    const pathVarRegex = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;
    const matches = [...this.request.url.matchAll(pathVarRegex)];
    const pathVarNames = matches.map(m => m[1]);

    if (!this.request.httpParameters) {
      this.request.httpParameters = [];
    }

    const existingPathParamsMap = new Map(
      this.request.httpParameters
        .filter(p => p.type === 'path')
        .map(p => [p.key, p])
    );

    pathVarNames.forEach(varName => {
      const existing = existingPathParamsMap.get(varName);
      if (!existing) {

        this.request.httpParameters!.push({
          key: varName,
          value: '',
          description: '',
          type: 'path',
          enabled: true
        });
      }

    });

    const currentPathVarSet = new Set(pathVarNames);
    this.request.httpParameters = this.request.httpParameters.filter(p => {
      if (p.type === 'path') {
        return currentPathVarSet.has(p.key);
      }
      return true;
    });
  }

  updateBody(body: string) {
    this.request.requestBody = body;
    if (this.request.body?.mode && ['json', 'xml', 'text', 'graphql'].includes(this.request.body.mode)) {
      this.request.body.raw = body;
    }
    this.autoDetectBodySettings();
    this.saveRequest();
    this.cdr.markForCheck();
  }

  getBodyLanguage(): EditorLanguage {
    return this.selectedBodyType;
  }

  setBodyType(type: EditorLanguage) {
    this.selectedBodyType = type;
    this.persistViewState({ selectedBodyType: type });
    this.bodyMode = this.rawBodyModeFromLanguage(type);

    const currentBody = (this.request.requestBody || '').trim();
    const isJsonDefault = currentBody === '{}';
    const isXmlDefault = currentBody === '<root>\n</root>' || currentBody === '<root></root>';
    const isPlainDefault = currentBody === '';

    if (isJsonDefault || isXmlDefault || isPlainDefault) {
      if (type === 'json') {
        this.request.requestBody = '{}';
      } else if (type === 'xml') {
        this.request.requestBody = '<root>\n</root>';
      } else { // plain, javascript, etc.
        this.request.requestBody = '';
      }
    }

    if (type === 'json') this.addOrUpdateHeader('Content-Type', 'application/json');
    else if (type === 'xml') this.addOrUpdateHeader('Content-Type', 'application/xml');
    else if (type === 'html') this.addOrUpdateHeader('Content-Type', 'text/html');
    else if (type === 'plain') this.addOrUpdateHeader('Content-Type', 'text/plain');

    this.syncBodyToRequest();
    this.saveRequest();
    this.cdr.markForCheck();
  }

  /** Map an editor language to the persisted body mode for raw modes. */
  private rawBodyModeFromLanguage(lang: EditorLanguage): RequestBodyMode {
    if (lang === 'json') return 'json';
    if (lang === 'xml') return 'xml';
    if (lang === 'graphql') return 'graphql';
    return 'text';
  }

  /**
   * Switch to a structured body mode (form-data, urlencoded, binary). Raw
   * modes go through `setBodyType` to keep the existing editor-language
   * tracking. Creates empty collections when switching in for the first time.
   */
  setBodyMode(mode: RequestBodyMode) {
    this.bodyMode = mode;
    if (mode === 'json' || mode === 'xml' || mode === 'text' || mode === 'graphql') {
      this.setBodyType((mode === 'text' ? 'plain' : mode) as EditorLanguage);
      return;
    }
    this.removeHeaderByName('Content-Type');
    this.syncBodyToRequest();
    this.saveRequest();
    this.cdr.markForCheck();
  }

  /**
   * Rebuild `request.body` from the current UI state so we persist the full
   * structured body. The raw string body is still mirrored onto
   * `request.requestBody` for back-compat with code that reads the old field.
   */
  private syncBodyToRequest() {
    const body: RequestBody = { mode: this.bodyMode };
    if (this.bodyMode === 'json' || this.bodyMode === 'xml' || this.bodyMode === 'text' || this.bodyMode === 'graphql') {
      body.raw = this.request.requestBody;
    } else if (this.bodyMode === 'form-data') {
      body.form = (this.request.body?.form || []).map(f => ({ ...f }));
    } else if (this.bodyMode === 'urlencoded') {
      body.urlencoded = (this.request.body?.urlencoded || []).map(f => ({ ...f }));
    } else if (this.bodyMode === 'binary') {
      body.binary = this.request.body?.binary ? { ...this.request.body.binary } : { filePath: '' };
    }
    this.request.body = body;
  }

  /** Remove the first header matching `name` (case-insensitive). */
  private removeHeaderByName(name: string) {
    if (!this.request.httpHeaders) return;
    const lower = name.toLowerCase();
    this.request.httpHeaders = this.request.httpHeaders.filter(h =>
      ((h.key as string) || '').toLowerCase().trim() !== lower
    );
  }

  get formDataFields(): FormDataField[] {
    if (!this.request.body) return [];
    if (!this.request.body.form) this.request.body.form = [];
    return this.request.body.form;
  }

  addFormDataField(type: 'text' | 'file' = 'text') {
    if (!this.request.body || this.request.body.mode !== 'form-data') {
      this.setBodyMode('form-data');
    }
    this.request.body!.form = this.request.body!.form || [];
    this.request.body!.form.push({ key: '', value: '', type, enabled: true });
    this.saveRequest();
    this.cdr.markForCheck();
  }

  removeFormDataField(index: number) {
    if (!this.request.body?.form) return;
    this.request.body.form.splice(index, 1);
    this.saveRequest();
    this.cdr.markForCheck();
  }

  async pickFormDataFile(index: number) {
    const picked = await window.awElectron.pickFilePath();
    if (!picked?.path || !this.request.body?.form) return;
    const field = this.request.body.form[index];
    if (!field) return;
    field.filePath = picked.path;
    this.saveRequest();
    this.cdr.markForCheck();
  }

  get urlencodedFields(): UrlencodedField[] {
    if (!this.request.body) return [];
    if (!this.request.body.urlencoded) this.request.body.urlencoded = [];
    return this.request.body.urlencoded;
  }

  addUrlencodedField() {
    if (!this.request.body || this.request.body.mode !== 'urlencoded') {
      this.setBodyMode('urlencoded');
    }
    this.request.body!.urlencoded = this.request.body!.urlencoded || [];
    this.request.body!.urlencoded.push({ key: '', value: '', enabled: true });
    this.saveRequest();
    this.cdr.markForCheck();
  }

  removeUrlencodedField(index: number) {
    if (!this.request.body?.urlencoded) return;
    this.request.body.urlencoded.splice(index, 1);
    this.saveRequest();
    this.cdr.markForCheck();
  }

  /**
   * Persist the current response body to disk via the main-process file
   * service. Uses the response's content-type to pick a sensible default
   * filename; binary bodies are written from their base64 payload.
   */
  /** Open the response search overlay; scrolls active match into view on next frame. */
  openResponseSearch() {
    if (!this.response) return;
    this.isResponseSearchOpen = true;
    this.cdr.markForCheck();
  }

  closeResponseSearch() {
    this.isResponseSearchOpen = false;
    this.responseSearchMatches = [];
    this.responseSearchSegments = [];
    this.cdr.markForCheck();
  }

  onResponseSearchSegments(segments: ResponseSearchSegment[]) {
    this.responseSearchSegments = segments;
    this.cdr.markForCheck();
  }

  onResponseSearchMatches(matches: ResponseSearchMatch[]) {
    this.responseSearchMatches = matches;
    this.cdr.markForCheck();
  }

  onResponseSearchActive(index: number) {
    this.responseSearchActiveIndex = index;
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>('.response-search-body mark.is-active');
      if (el?.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 0);
    this.cdr.markForCheck();
  }

  /** Keyboard shortcut: Ctrl/Cmd+F toggles the overlay while the response is visible. */
  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent) {
    const isFind = (event.ctrlKey || event.metaKey) && (event.key === 'f' || event.key === 'F');
    if (!isFind) return;
    if (!this.response || this.isResponseHidden) return;
    event.preventDefault();
    if (this.isResponseSearchOpen) {
      return;
    }
    this.openResponseSearch();
  }

  async saveResponseToFile() {
    if (!this.response) return;
    try {
      const defaultName = this.suggestResponseFilename(this.response);
      await window.awElectron.saveResponseBody({
        body: this.response.body,
        isBinary: this.response.isBinary,
        binaryBase64: this.response.binaryBase64,
        defaultName,
        contentType: this.response.contentType
      });
    } catch (err) {
      console.error('Failed to save response', err);
    }
  }

  private suggestResponseFilename(response: Response): string {
    const url = this.replaceVariables(this.request.url || '').trim();
    let base = 'response';
    try {
      const u = new URL(url);
      const seg = u.pathname.split('/').filter(Boolean).pop();
      if (seg) base = seg;
    } catch { /* leave default */ }
    const ct = (response.contentType || '').toLowerCase();
    let ext = '';
    if (ct.includes('json')) ext = '.json';
    else if (ct.includes('xml')) ext = '.xml';
    else if (ct.includes('html')) ext = '.html';
    else if (ct.includes('csv')) ext = '.csv';
    else if (ct.includes('pdf')) ext = '.pdf';
    else if (ct.startsWith('image/')) ext = '.' + ct.split('/')[1].split(';')[0];
    else if (ct.includes('plain')) ext = '.txt';
    if (ext && base.toLowerCase().endsWith(ext)) return base;
    return `${base}${ext}`;
  }

  async pickBinaryFile() {
    const picked = await window.awElectron.pickFilePath();
    if (!picked?.path) return;
    if (!this.request.body || this.request.body.mode !== 'binary') {
      this.setBodyMode('binary');
    }
    this.request.body!.binary = { filePath: picked.path };
    this.saveRequest();
    this.cdr.markForCheck();
  }

  clearBinaryFile() {
    if (!this.request.body || this.request.body.mode !== 'binary') return;
    this.request.body.binary = { filePath: '' };
    this.saveRequest();
    this.cdr.markForCheck();
  }

  trackByIndex(index: number) {
    return index;
  }

  trackById(index: number, item: { id: string }) {
    return item.id || index;
  }

  trackByKey(index: number, item: { key: string }) {
    return item.key || index;
  }

  trackByTest(index: number, item: { name: string }) {
    return item.name + index;
  }

  testSummary(): { passed: number; failed: number; total: number } {
    const results = this.response?.testResults || [];
    let passed = 0;
    let failed = 0;
    for (const r of results) {
      if (r.passed) passed++; else failed++;
    }
    return { passed, failed, total: results.length };
  }

  toggleHeadersBulkEdit() {
    this.isHeadersBulkEdit = !this.isHeadersBulkEdit;
    if (this.isHeadersBulkEdit) {
      this.headersBulkText = (this.request.httpHeaders || [])
        .filter(p => p.key)
        .map(p => `${p.key}: ${p.value}`)
        .join('\n');
    } else {
      this.request.httpHeaders = this.parseBulkText(this.headersBulkText);
      this.saveRequest();
    }
    this.cdr.markForCheck();
  }

  onAuthTypeChange() {
    if (this.request.auth) {
      if (this.request.auth.type === 'bearer' && !this.request.auth.bearer) {
        this.request.auth.bearer = { token: '' };
      } else if (this.request.auth.type === 'basic' && !this.request.auth.basic) {
        this.request.auth.basic = { username: '', password: '' };
      } else if (this.request.auth.type === 'api_key' && !this.request.auth.apiKey) {
        this.request.auth.apiKey = { key: '', value: '', addTo: 'header' };
      } else if (this.request.auth.type === 'oauth2' && !this.request.auth.oauth2) {
        this.request.auth.oauth2 = { grantType: 'authorization_code' };
      } else if (this.request.auth.type === 'digest' && !this.request.auth.digest) {
        this.request.auth.digest = { username: '', password: '', algorithm: 'MD5', qop: '' };
      } else if (this.request.auth.type === 'aws_sigv4' && !this.request.auth.awsSigV4) {
        this.request.auth.awsSigV4 = { accessKeyId: '', secretAccessKey: '', region: 'us-east-1', service: 'execute-api', addTo: 'header' };
      } else if (this.request.auth.type === 'hawk' && !this.request.auth.hawk) {
        this.request.auth.hawk = { authId: '', authKey: '', algorithm: 'sha256', includePayloadHash: false };
      } else if (this.request.auth.type === 'ntlm' && !this.request.auth.ntlm) {
        this.request.auth.ntlm = { username: '', password: '' };
      }
    }
    this.saveRequest();
    this.cdr.markForCheck();
  }

  async fetchOAuth2Token() {
    const auth = this.request.auth?.oauth2;
    if (!auth) return;

    try {
      if (auth.grantType === 'authorization_code') {
        if (!auth.authUrl || !auth.accessTokenUrl || !auth.clientId) {
          console.warn('OAuth2 configuration incomplete for authorization_code');
          return;
        }
        const redirectUri = 'http://127.0.0.1:4200/oauth/callback';
        const authUrl = this.replaceVariables(auth.authUrl || '');
        const clientId = this.replaceVariables(auth.clientId || '');
        const scope = this.replaceVariables(auth.scope || '');

        const authRes = await window.awElectron.getOAuth2Token({
          authUrl,
          clientId,
          redirectUri,
          scope
        });

        if (authRes && authRes.code) {
          const tokenUrl = this.replaceVariables(auth.accessTokenUrl || '');
          const clientSecret = this.replaceVariables(auth.clientSecret || '');

          const tokenRes = await window.awElectron.exchangeOAuth2Code({
            tokenUrl,
            code: authRes.code,
            clientId,
            clientSecret,
            redirectUri
          });

          const accessToken = tokenRes?.['access_token'];
          if (tokenRes && typeof accessToken === 'string' && accessToken) {
            auth.accessToken = accessToken;
            this.saveRequest();
            this.cdr.markForCheck();
          }
        }
      } else if (auth.grantType === 'client_credentials') {
        if (!auth.accessTokenUrl || !auth.clientId || !auth.clientSecret) {
          console.warn('OAuth2 configuration incomplete for client_credentials');
          return;
        }
        const tokenUrl = this.replaceVariables(auth.accessTokenUrl || '');
        const clientId = this.replaceVariables(auth.clientId || '');
        const clientSecret = this.replaceVariables(auth.clientSecret || '');
        const scope = this.replaceVariables(auth.scope || '');

        const tokenRes = await window.awElectron.getOAuth2ClientCredentials({
          tokenUrl,
          clientId,
          clientSecret,
          scope
        });

        const clientCredToken = tokenRes?.['access_token'];
        if (tokenRes && typeof clientCredToken === 'string' && clientCredToken) {
          auth.accessToken = clientCredToken;
          this.saveRequest();
          this.cdr.markForCheck();
        }
      }
    } catch (err) {
      console.error('OAuth Error:', err);
    }
  }

  private parseBulkText(text: string): { key: string, value: string, description: string }[] {
    return text.split('\n')
      .map(line => line.trim())
      .filter(line => line.includes(':'))
      .map(line => {
        const parts = line.split(':');
        const key = parts[0].trim();
        const value = parts.slice(1).join(':').trim();
        return { key, value, description: '' };
      });
  }

  getResponseLanguage(): EditorLanguage {
    if (!this.response || !this.response.body) return 'json';

    const contentType = this.response.headers.find(h => h.key.toLowerCase() === 'content-type')?.value.toLowerCase() || '';
    if (contentType.includes('html')) return 'html';
    if (contentType.includes('xml')) return 'xml';

    if (typeof this.response.body !== 'string') return 'json';
    const trimmed = this.response.body.trim();
    if (/^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) return 'html';
    if (trimmed.startsWith('<')) return 'xml';

    return 'json';
  }

  /** Sanitized HTML for iframe srcdoc; scripts and dangerous markup are stripped by the platform sanitizer. */
  get htmlPreviewSrcdoc(): string {
    if (!this.response?.body || typeof this.response.body !== 'string') return '';
    return this.sanitizer.sanitize(SecurityContext.HTML, this.response.body) ?? '';
  }

  /** Coarse category used to switch the Preview tab between html / image / pdf / none. */
  get previewKind(): 'html' | 'image' | 'pdf' | 'none' {
    if (!this.response) return 'none';
    const ct = (this.response.contentType
      || this.response.headers.find(h => h.key.toLowerCase() === 'content-type')?.value
      || '').toLowerCase();
    if (ct.startsWith('image/')) return 'image';
    if (ct.includes('pdf')) return 'pdf';
    if (ct.includes('html') || this.getResponseLanguage() === 'html') return 'html';
    return 'none';
  }

  /** Data URI for binary previews (image). `<img>` accepts data: URLs directly. */
  get binaryPreviewDataUri(): string {
    if (!this.response?.binaryBase64) return '';
    const ct = (this.response.contentType
      || this.response.headers.find(h => h.key.toLowerCase() === 'content-type')?.value
      || 'application/octet-stream').toLowerCase();
    return `data:${ct};base64,${this.response.binaryBase64}`;
  }

  /**
   * Angular strips `data:` URLs from iframe `src` unless they're explicitly
   * marked safe. Used for PDF preview so the embedded PDF viewer can load it.
   */
  get binaryPreviewSafeUrl(): SafeResourceUrl | null {
    const uri = this.binaryPreviewDataUri;
    if (!uri) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(uri);
  }

  addHeader() {
    if (!this.request.httpHeaders) this.request.httpHeaders = [];
    this.request.httpHeaders.push({ key: '', value: '', description: '', enabled: true });
    this.saveRequest();
    this.cdr.markForCheck();
  }
  removeHeader(i: number) { this.request.httpHeaders!.splice(i, 1); this.saveRequest(); this.cdr.markForCheck(); }
  updateHeaderKey(e: Event, i: number) {
    this.request.httpHeaders![i].key = (e.target as HTMLInputElement).value;
    this.saveRequest();
    this.cdr.markForCheck();
  }
  updateHeaderValue(e: Event, i: number) {
    this.request.httpHeaders![i].value = (e.target as HTMLInputElement).value;
    this.saveRequest();
    this.cdr.markForCheck();
  }

  updateHeaderDescription(e: Event, i: number) {
    this.cdr.markForCheck();
  }

  addQueryParam() {
    if (!this.request.httpParameters) this.request.httpParameters = [];
    this.request.httpParameters.push({ key: '', value: '', description: '', type: 'query', enabled: true });
    this.saveRequest();
    this.cdr.markForCheck();
  }

  addPathParam() {
    if (!this.request.httpParameters) this.request.httpParameters = [];
    this.request.httpParameters.push({ key: '', value: '', description: '', type: 'path', enabled: true });
    this.saveRequest();
    this.cdr.markForCheck();
  }

  updateUrlFromParams() {
    if (!this.request.url) return;

    let url = this.request.url;

    const qIndex = url.indexOf('?');
    let baseUrl = qIndex !== -1 ? url.substring(0, qIndex) : url;

    const queryParams = (this.request.httpParameters || [])
      .filter(p => (p.type === 'query' || !p.type) && p.enabled && hasKey(p));

    if (queryParams.length > 0) {
      const queryString = queryParams
        .map(p => `${(p.key as string).trim()}=${p.value || ''}`)
        .join('&');

      if (queryString) {
        baseUrl += '?' + queryString;
      }
    }

    this.request.url = baseUrl;
    this.syncPathVariablesFromUrl();
  }

  onQueryParamChange() {
    this.updateUrlFromParams();
    this.saveRequest();
  }

  removeQueryParam(i: number) {
    const queryParams = this.queryParams;
    const paramToRemove = queryParams[i];
    const actualIndex = this.request.httpParameters!.indexOf(paramToRemove);
    if (actualIndex !== -1) {
      this.request.httpParameters!.splice(actualIndex, 1);
      this.updateUrlFromParams(); 
      this.saveRequest();
      this.cdr.markForCheck();
    }
  }

  removePathParam(i: number) {
    const pathParams = this.pathParams;
    const paramToRemove = pathParams[i];
    const actualIndex = this.request.httpParameters!.indexOf(paramToRemove);
    if (actualIndex !== -1) {
      this.request.httpParameters!.splice(actualIndex, 1);
      this.saveRequest();
      this.cdr.markForCheck();
    }
  }

  toggleParamsBulkEdit() {
    this.isParamsBulkEdit = !this.isParamsBulkEdit;

    const currentParams = this.request.httpParameters || [];
    const pathParams = currentParams.filter(p => p.type === 'path');

    if (this.isParamsBulkEdit) {

      const queryParams = currentParams.filter(p => p.type !== 'path');
      this.paramsBulkText = queryParams.map(p => `${p.key}: ${p.value}`).join('\n');
    } else {

      const newQueryParams = this.parseBulkText(this.paramsBulkText)
        .map(p => ({ ...p, type: 'query' as const, enabled: true }));

      this.request.httpParameters = [...pathParams, ...newQueryParams];

      this.updateUrlFromParams();
      this.saveRequest();
    }
    this.cdr.markForCheck();
  }

  togglePathBulkEdit() {
    this.isPathBulkEdit = !this.isPathBulkEdit;

    const currentParams = this.request.httpParameters || [];
    const queryParams = currentParams.filter(p => p.type !== 'path');

    if (this.isPathBulkEdit) {

      const pathParams = currentParams.filter(p => p.type === 'path');
      this.pathBulkText = pathParams.map(p => `${p.key}: ${p.value}`).join('\n');
    } else {

      const newPathParams = this.parseBulkText(this.pathBulkText)
        .map(p => ({ ...p, type: 'path' as const, enabled: true }));

      this.request.httpParameters = [...queryParams, ...newPathParams];

      this.saveRequest();
    }
    this.cdr.markForCheck();
  }

  updatePreRequestScript(e: Event) {
    if (!this.request.script) this.request.script = { preRequest: '', postRequest: '' };
    this.request.script.preRequest = (e.target as HTMLTextAreaElement).value;
    this.saveRequest();
    this.cdr.markForCheck();
  }

  updatePostRequestScript(e: Event) {
    if (!this.request.script) this.request.script = { preRequest: '', postRequest: '' };
    this.request.script.postRequest = (e.target as HTMLTextAreaElement).value;
    this.saveRequest();
    this.cdr.markForCheck();
  }

  updateParamDescription(e: Event, i: number) {
    this.cdr.markForCheck();
  }

  onResizeStart(event: MouseEvent) {
    this.isResizing = true;
    event.preventDefault();
    document.addEventListener('mousemove', this.onResizeMove);
    document.addEventListener('mouseup', this.onResizeEnd);
    document.body.style.cursor = 'row-resize';
  }

  responseHeight = 300;

  onResizeMove = (event: MouseEvent) => {
    if (!this.isResizing || !this.requestArea) return;

    const containerRect = this.requestArea.nativeElement.getBoundingClientRect();

    const computedStyle = window.getComputedStyle(this.requestArea.nativeElement);
    const paddingBottom = parseFloat(computedStyle.paddingBottom || '0');

    const newHeight = (containerRect.bottom - paddingBottom) - event.clientY;

    if (newHeight < 60) {
      this.isResponseHidden = true;
      this.onResizeEnd(); 
      this.cdr.markForCheck();
      return;
    }

    if (newHeight >= 60 && newHeight < containerRect.height - 10) {
      this.responseHeight = newHeight;
      this.cdr.markForCheck();
    }
  };

  onResizeEnd = () => {
    this.isResizing = false;
    document.removeEventListener('mousemove', this.onResizeMove);
    document.removeEventListener('mouseup', this.onResizeEnd);
    document.body.style.cursor = '';
    this.persistViewState({
      responseHeight: this.responseHeight,
      isResponseHidden: this.isResponseHidden,
    });
  };

  async getCertificateForHost(hostname: string): Promise<Certificate | undefined> {
    const settings = this.settingsService.getSettings();
    return (settings?.ssl.certificates || []).find(cert => {
      try {
        const pattern = cert.hostname.replace(/\./g, '\\.').replace(/\*/g, '.*');
        return new RegExp(`^${pattern}$`, 'i').test(hostname);
      } catch {
        return false;
      }
    });
  }

  private replaceVariables(text: string): string {
    if (!text || typeof text !== 'string') return text;
    return text.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
      const val = this.activeVariables[key];
      return val !== undefined ? val : match;
    });
  }

  /**
   * Run a user script in the main-process VM sandbox. The sandbox returns a
   * structured result (env changes, test results, logs, errors) that we apply
   * to renderer state here — functions can't cross the IPC boundary, so this
   * dispatch-based model is the only safe path.
   */
  private async executeScript(code: string, responseContext?: Response): Promise<ScriptRunResult | null> {
    if (!code) return null;

    const context = this.buildScriptContext(responseContext);
    let raw: unknown;
    try {
      raw = await this.scriptService.runScript(code, context);
    } catch (err) {
      console.warn('Script Execution Error:', err);
      return null;
    }

    const result = (raw && typeof raw === 'object') ? raw as ScriptRunResult : null;
    if (!result) return null;

    if (Array.isArray(result.envChanges)) {
      this.applyEnvChanges(result.envChanges);
    }
    if (Array.isArray(result.consoleLogs)) {
      for (const log of result.consoleLogs) {
        const level = log.level === 'error' ? 'error' : log.level === 'warn' ? 'warn' : 'log';
        (console as any)[level]('[script]', ...(log.args || []));
      }
    }
    if (Array.isArray(result.errors) && result.errors.length) {
      for (const e of result.errors) console.warn('Script Error:', e.message);
    }
    this.cdr.markForCheck();
    return result;
  }

  private buildScriptContext(responseContext?: Response) {
    const request = this.request;
    const headerPairs = pruneEmptyKv(request.httpHeaders || []).map(h => [String(h.key), String(h.value || '')]);
    const response = responseContext ? {
      code: responseContext.statusCode,
      status: responseContext.statusText,
      headers: (responseContext.headers || []).map(h => [String(h.key), String(h.value || '')]),
      body: responseContext.body ?? '',
      responseTime: responseContext.timeMs,
      size: responseContext.size,
    } : null;
    return {
      environment: { ...this.activeVariables },
      globals: {},
      variables: {},
      request: {
        method: request.httpMethod,
        url: request.url,
        headers: headerPairs,
        body: request.requestBody,
      },
      response,
    };
  }

  private applyEnvChanges(changes: Array<{ op: 'set' | 'unset'; key: string; value?: string }>) {
    if (!changes.length) return;
    const next = { ...this.activeVariables };
    const activeEnv = this.environmentsService.getActiveContext();
    for (const change of changes) {
      const trimmed = (change.key ?? '').trim();
      if (!trimmed) continue;
      if (change.op === 'set') {
        next[trimmed] = String(change.value ?? '');
        if (activeEnv) {
          if (!activeEnv.variables) activeEnv.variables = [];
          const existingVar = activeEnv.variables.find(v => v.key === trimmed);
          if (existingVar) existingVar.value = String(change.value ?? '');
          else activeEnv.variables.push({ key: trimmed, value: String(change.value ?? '') });
        }
      } else if (change.op === 'unset') {
        delete next[trimmed];
        if (activeEnv?.variables) {
          activeEnv.variables = activeEnv.variables.filter(v => v.key !== trimmed);
        }
      }
    }
    this.activeVariables = next;
    if (activeEnv) this.environmentsService.saveEnvironment(activeEnv);
  }

  async sendRequest() {
    if (this.isLoading || !this.request) return;

    this.isLoading = true;
    this.saveRequest();
    await this.collectionService.flushPendingSaves();

    try {

      const parents = this.collectionService.getParentFolders(this.request.id);

      let effectiveAuth = this.request.auth;
      if (!effectiveAuth || effectiveAuth.type === AuthType.INHERIT) {
        for (const parent of [...parents].reverse()) {
          if (parent.auth && parent.auth.type !== AuthType.INHERIT) {
            effectiveAuth = parent.auth;
            break;
          }
        }
      }

      for (const p of [...parents].reverse()) {
        if (p.script?.preRequest) {
          await this.executeScript(p.script.preRequest);
        }
      }

      if (this.request.script.preRequest) {
        await this.executeScript(this.request.script.preRequest);
      }

      let substitutedUrl = this.replaceVariables(this.request.url).trim();
      let substitutedBody: string | IpcStructuredBody = '';

      if (this.selectedBodyType === 'graphql') {
        const query = this.replaceVariables(this.request.graphqlQuery || '');
        const variablesText = this.replaceVariables(this.request.graphqlVariables || '{}');
        let variables = {};
        try { variables = JSON.parse(variablesText); } catch { }
        substitutedBody = JSON.stringify({ query, variables });
      } else if (this.bodyMode === 'form-data') {
        substitutedBody = {
          mode: 'form-data',
          form: (this.request.body?.form || [])
            .filter(f => f && f.enabled !== false && (f.key || '').trim() !== '')
            .map(f => ({
              ...f,
              key: this.replaceVariables(f.key),
              value: f.type === 'file' ? f.value : this.replaceVariables(f.value || '')
            }))
        };
      } else if (this.bodyMode === 'urlencoded') {
        substitutedBody = {
          mode: 'urlencoded',
          urlencoded: (this.request.body?.urlencoded || [])
            .filter(f => f && f.enabled !== false && (f.key || '').trim() !== '')
            .map(f => ({
              ...f,
              key: this.replaceVariables(f.key),
              value: this.replaceVariables(f.value || '')
            }))
        };
      } else if (this.bodyMode === 'binary') {
        substitutedBody = {
          mode: 'binary',
          binary: this.request.body?.binary
            ? { filePath: this.request.body.binary.filePath, contentType: this.request.body.binary.contentType }
            : { filePath: '' }
        };
      } else {
        substitutedBody = this.replaceVariables(this.request.requestBody);
      }

      if (substitutedUrl && !/^https?:\/\//i.test(substitutedUrl)) {
        substitutedUrl = 'https://' + substitutedUrl;
      }

      const settings = this.settingsService.getSettings();

      let effectiveSettings = { ...settings, ...this.request.settings };
      const parentSettings = [...parents].reverse().map(p => p.settings).filter(s => !!s);

      const resolvedSettings = {
        verifySsl: this.request.settings?.verifySsl,
        followRedirects: this.request.settings?.followRedirects,
        useCookies: this.request.settings?.useCookies
      };

      for (const ps of parentSettings) {
        if (resolvedSettings.verifySsl === undefined) resolvedSettings.verifySsl = ps?.verifySsl;
        if (resolvedSettings.followRedirects === undefined) resolvedSettings.followRedirects = ps?.followRedirects;
        if (resolvedSettings.useCookies === undefined) resolvedSettings.useCookies = ps?.useCookies;
      }

      if (resolvedSettings.followRedirects === undefined) resolvedSettings.followRedirects = true;
      if (resolvedSettings.useCookies === undefined) resolvedSettings.useCookies = settings.requests?.useCookies;

      const headersObj: Record<string, string> = {};

      const disabledDefaults = this.request.disabledDefaultHeaders || [];

      const addHeader = (h: { key?: string; value?: string; enabled?: boolean }) => {
        if (h.enabled === false || !hasKey(h)) return;
        const key = this.replaceVariables((h.key as string).trim());
        if (!key) return;
        headersObj[key] = this.replaceVariables(h.value || '');
      };

      if (settings.headers?.addDefaultHeaders && settings.headers.defaultHeaders) {
        settings.headers.defaultHeaders.forEach(h => {
          if (!hasKey(h) || disabledDefaults.includes((h.key as string).trim())) return;
          addHeader(h);
        });
      }

      parents.forEach(p => (p.httpHeaders || []).forEach(addHeader));
      (this.request.httpHeaders || []).forEach(addHeader);

      const paramsObj: Record<string, string> = {};
      (this.request.httpParameters || []).forEach(p => {
        if (p.enabled === false || !hasKey(p)) return;
        const key = this.replaceVariables((p.key as string).trim());
        if (!key) return;
        paramsObj[key] = this.replaceVariables(p.value || '');
      });

      try {
        if (!substitutedUrl) throw new Error('URL is required');
        const urlObj = new URL(substitutedUrl);
        const cert = await this.getCertificateForHost(urlObj.hostname);

        if (effectiveAuth && effectiveAuth.type !== AuthType.NONE) {
          if (effectiveAuth.type === AuthType.BEARER && effectiveAuth.bearer?.token) {
            headersObj['Authorization'] = `Bearer ${this.replaceVariables(effectiveAuth.bearer.token)}`;
          } else if (effectiveAuth.type === AuthType.BASIC && (effectiveAuth.basic?.username || effectiveAuth.basic?.password)) {
            const auth = btoa(`${this.replaceVariables(effectiveAuth.basic.username || '')}:${this.replaceVariables(effectiveAuth.basic.password || '')}`);
            headersObj['Authorization'] = `Basic ${auth}`;
          } else if (effectiveAuth.type === AuthType.API_KEY && effectiveAuth.apiKey?.key) {
            const key = this.replaceVariables(effectiveAuth.apiKey.key);
            const val = this.replaceVariables(effectiveAuth.apiKey.value || '');
            if (effectiveAuth.apiKey.addTo === 'query') {
              paramsObj[key] = val;
            } else {
              headersObj[key] = val;
            }
          } else if (
            effectiveAuth.type === AuthType.DIGEST ||
            effectiveAuth.type === AuthType.AWS_SIGV4 ||
            effectiveAuth.type === AuthType.HAWK
          ) {
            const signed = await this.authSigner.sign(
              effectiveAuth,
              {
                method: HttpMethod[this.request.httpMethod],
                url: substitutedUrl,
                headers: headersObj,
                params: paramsObj,
                body: typeof substitutedBody === 'string' ? substitutedBody : '',
              },
              (s: string) => this.replaceVariables(s || '')
            );
            Object.assign(headersObj, signed.headers);
            Object.assign(paramsObj, signed.params);
          } else if (effectiveAuth.type === AuthType.NTLM) {
            console.warn('NTLM auth is not yet supported; request will be sent without Authorization.');
          }
        }

        let ignoreInvalidSsl = false;
        if (resolvedSettings.verifySsl === true) {
          ignoreInvalidSsl = false;
        } else if (resolvedSettings.verifySsl === false) {
          ignoreInvalidSsl = true;
        } else {
          ignoreInvalidSsl = settings.ssl?.ignoreInvalidSsl === true;
        }

        const res = await this.requestService.sendRequest({
          method: HttpMethod[this.request.httpMethod],
          url: substitutedUrl,
          headers: headersObj,
          params: paramsObj,
          body: substitutedBody,
          certificate: cert,

          timeoutMs: settings.requests.timeoutMs,
          retries: settings.retries,
          dns: settings.dns,
          proxy: settings.proxy,
          ignoreInvalidSsl,
          followRedirects: resolvedSettings.followRedirects,
          verifyHostname: settings.ssl?.verifyHostname,
          useSystemCaStore: settings.ssl?.useSystemCaStore,
          customCaPaths: settings.ssl?.customCaPaths,
          useCookies: resolvedSettings.useCookies,
          allowHttp2: settings.requests?.allowHttp2 === true,
        });

        if (!res) {
          throw new Error('No response from HTTP layer');
        }

        const responseHeaders = Object.entries(res.headers || {}).map(([key, value]) => ({
          key,
          value: String(value)
        }));

        const response: Response = {
          headers: responseHeaders,
          body: typeof res.body === 'string' ? res.body : JSON.stringify(res.body, null, 2),
          statusCode: res.status,
          statusText: res.statusText,
          timeMs: res.timeMs,
          size: res.size,
          receivedAt: new Date(),
          isBinary: res.isBinary,
          binaryBase64: res.binaryBase64,
          contentType: res.contentType,
          httpVersion: res.httpVersion,
        }

        this.response = response;
        this.requestService.cacheResponse(this.request.id, response);
        void this.responseHistory.append(this.request.id, response);

        const contentType = (response.contentType || response.headers.find(h => h.key.toLowerCase() === 'content-type')?.value || '').toLowerCase();
        if (contentType.includes('text/html') || contentType.startsWith('image/') || contentType.includes('pdf')) {
          this.activeResponseTab = 'preview';
        } else {
          this.activeResponseTab = 'body';
        }

        const collectedTests: TestResult[] = [];

        if (this.request.script?.postRequest) {
          const res = await this.executeScript(this.request.script.postRequest, this.response);
          if (res?.testResults) collectedTests.push(...res.testResults);
        }

        for (const p of [...parents].reverse()) {
          if (p.script?.postRequest) {
            const res = await this.executeScript(p.script.postRequest, this.response);
            if (res?.testResults) collectedTests.push(...res.testResults);
          }
        }

        if (collectedTests.length) {
          this.response.testResults = collectedTests;
          if (this.activeResponseTab !== 'preview') {
            this.activeResponseTab = 'tests';
          }
          this.cdr.markForCheck();
        }

        const historyRequest: Request = JSON.parse(JSON.stringify(this.request));
        historyRequest.url = substitutedUrl;
        historyRequest.requestBody = typeof substitutedBody === 'string'
          ? substitutedBody
          : JSON.stringify(substitutedBody);
        historyRequest.httpHeaders = pruneEmptyKv(historyRequest.httpHeaders).map(h => ({
          ...h,
          key: this.replaceVariables((h.key as string).trim()),
          value: this.replaceVariables(h.value || '')
        }));
        historyRequest.httpParameters = pruneEmptyKv(historyRequest.httpParameters).map(p => ({
          ...p,
          key: this.replaceVariables((p.key as string).trim()),
          value: this.replaceVariables(p.value || '')
        }));

        const history = this.requestHistoryService.getHistory();
        const requestHistoryEntry: RequestHistoryEntry = {
          id: uuidv4(),
          request: historyRequest,
          response: response,
          createdAt: new Date()
        };

        history.entries.push(requestHistoryEntry);
        await this.requestHistoryService.saveHistory(history);
      } catch (err: any) {
        console.error('Request error', err);
        this.response = {
          headers: [],
          body: err.message || 'Unknown error',
          statusCode: 0,
          statusText: 'Error',
          timeMs: 0,
          size: 0,
          receivedAt: new Date(),
        }
      }

    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  requestSslVerifyForUi(): boolean {
    const s = this.request?.settings;
    if (s && s.verifySsl !== undefined) return s.verifySsl;
    return this.settingsService.getSettings().ssl?.ignoreInvalidSsl === false;
  }

  onRequestVerifySslChange(checked: boolean): void {
    if (!this.request.settings) {
      this.request.settings = { followRedirects: true, useCookies: true };
    }
    this.request.settings.verifySsl = checked;
    void this.saveRequest();
    this.cdr.markForCheck();
  }

  public async saveRequest() {
    if (this.request) {
      const sanitized: Request = {
        ...this.request,
        httpHeaders: pruneEmptyKv(this.request.httpHeaders),
        httpParameters: pruneEmptyKv(this.request.httpParameters)
      };
      if (sanitized.disabledDefaultHeaders) {
        sanitized.disabledDefaultHeaders = sanitized.disabledDefaultHeaders.filter(h => h && h.trim() !== '');
      }
      this.collectionService.updateRequest(sanitized);
      this.cdr.markForCheck();
    }
  }

  private updateActiveVariables() {
    this.activeVariables = {};

    const parents = this.collectionService.getParentFolders(this.request.id);

    parents.reverse().forEach(folder => {
      cleanKv(folder.variables).forEach(v => {
        this.activeVariables[v.key as string] = v.value as string;
      });
    });

    if (this.selectedEnvironmentId) {
      const env = this.environmentsService.getEnvironmentById(this.selectedEnvironmentId);
      cleanKv(env?.variables).forEach(v => {
        this.activeVariables[v.key as string] = v.value as string;
      });
    }
    this.cdr.markForCheck();
  }

  copyResponseBody() {
    if (this.response?.body) {
      navigator.clipboard.writeText(this.response.body);
    }
  }

  toggleRequestVisibility() {
    this.isRequestHidden = !this.isRequestHidden;
    this.persistViewState({ isRequestHidden: this.isRequestHidden });
    this.cdr.markForCheck();
  }

  toggleResponseVisibility() {
    this.isResponseHidden = !this.isResponseHidden;

    if (!this.isResponseHidden && this.responseHeight < 100) {
      this.responseHeight = 300;
    }
    this.persistViewState({
      isResponseHidden: this.isResponseHidden,
      responseHeight: this.responseHeight,
    });
    this.cdr.markForCheck();
  }

  trackByMockId = (_i: number, variant: MockVariant) => variant.id;

  async startMockServer(): Promise<void> {
    await this.mockServer.start();
    await this.syncActiveMockVariants();
  }

  async stopMockServer(): Promise<void> {
    await this.mockServer.stop();
  }

  addMockVariant(): void {
    if (!this.request) return;
    this.request.mockVariants = this.request.mockVariants || [];
    const nextId = uuidv4();
    const variant: MockVariant = {
      id: nextId,
      name: `Variant ${this.request.mockVariants.length + 1}`,
      statusCode: 200,
      headers: [{ key: 'Content-Type', value: 'application/json' }],
      body: '{\n  "ok": true\n}',
      delayMs: 0,
    };
    this.request.mockVariants.push(variant);
    if (!this.request.activeMockVariantId) {
      this.request.activeMockVariantId = nextId;
    }
    this.saveRequest();
    void this.syncActiveMockVariants();
    this.cdr.markForCheck();
  }

  removeMockVariant(index: number): void {
    if (!this.request?.mockVariants) return;
    const [removed] = this.request.mockVariants.splice(index, 1);
    if (removed && this.request.activeMockVariantId === removed.id) {
      this.request.activeMockVariantId = this.request.mockVariants[0]?.id;
    }
    this.saveRequest();
    void this.syncActiveMockVariants();
    this.cdr.markForCheck();
  }

  duplicateMockVariant(index: number): void {
    if (!this.request?.mockVariants) return;
    const original = this.request.mockVariants[index];
    if (!original) return;
    const copy: MockVariant = {
      ...original,
      id: uuidv4(),
      name: `${original.name || 'Variant'} (copy)`,
      headers: original.headers ? original.headers.map(h => ({ ...h })) : undefined,
      matchOn: original.matchOn ? { ...original.matchOn } : undefined,
    };
    this.request.mockVariants.splice(index + 1, 0, copy);
    this.saveRequest();
    void this.syncActiveMockVariants();
    this.cdr.markForCheck();
  }

  /** Maps an HTTP status code to a tone class for the variant chip. */
  mockStatusClass(code: number | null | undefined): 'is-success' | 'is-warning' | 'is-error' | 'is-neutral' {
    if (!code) return 'is-neutral';
    if (code >= 500) return 'is-error';
    if (code >= 400) return 'is-warning';
    if (code >= 200 && code < 400) return 'is-success';
    return 'is-neutral';
  }

  setActiveMockVariant(id: string): void {
    if (!this.request) return;
    this.request.activeMockVariantId = id;
    this.saveRequest();
    void this.syncActiveMockVariants();
  }

  onMockVariantChanged(): void {
    this.saveRequest();
    void this.syncActiveMockVariants();
  }

  mockUrlFor(variantId: string): string {
    if (!this.request) return '';
    return this.mockServer.mockUrl(this.request.id, variantId);
  }

  async copyMockUrl(variantId: string): Promise<void> {
    const url = this.mockUrlFor(variantId);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* ignore clipboard errors */
    }
  }

  private async syncActiveMockVariants(): Promise<void> {
    if (!this.request) return;
    await this.mockServer.syncRequest({
      id: this.request.id,
      mockVariants: this.request.mockVariants,
      activeMockVariantId: this.request.activeMockVariantId,
    });
  }
}

