import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { Subject, takeUntil } from 'rxjs';
import { TabItem } from '@core/tabs/tab.service';
import { WebSocketService } from '@core/websocket/websocket.service';
import { CollectionService } from '@core/collection/collection.service';
import { EnvironmentsService } from '@core/environments/environments.service';
import { cleanKv } from '@core/utils/kv-utils';
import { DropdownComponent, DropdownOption } from '../../shared/dropdown/dropdown.component';
import { formatTimestampForUi } from '../../shared/utils/timestamp.util';
import {
  WebSocketConnectionStatus,
  WebSocketFrame,
  WebSocketTabState,
} from '@models/websocket';
import { AuthType, type RequestAuth } from '@models/request';
import {
  authHeadersForWebSocketConnect,
  manualHeadersForWebSocketConnect,
  mergeWebSocketConnectHeaders,
  substituteWsVariables,
} from '@core/websocket/websocket-auth.util';

type ConnectionView = {
  status: WebSocketConnectionStatus;
  tab: WebSocketTabState;
  frames: WebSocketFrame[];
  error?: string;
};

const PERSIST_DEBOUNCE_MS = 300;

/**
 * WebSocket / SSE playground. Owns the per-tab UI state (URL, headers,
 * message draft) while delegating the actual connection lifecycle to
 * `WebSocketService`, which in turn proxies to the main-process `ws:*`
 * IPC channels.
 */
@Component({
  selector: 'app-websocket',
  standalone: true,
  imports: [CommonModule, FormsModule, DropdownComponent],
  templateUrl: './websocket.component.html',
  styleUrl: './websocket.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WebSocketComponent implements OnInit, OnChanges, OnDestroy {
  @Input() tab!: TabItem;

  view: ConnectionView = {
    status: 'disconnected',
    tab: {
      id: '',
      title: 'WebSocket',
      mode: 'ws',
      url: '',
      protocols: [],
      headers: [],
      messageDraft: '',
      messageHistory: [],
    },
    frames: [],
  };

  activeSection: 'message' | 'headers' | 'auth' | 'protocols' | 'log' = 'message';

  modeOptions: DropdownOption[] = [
    { label: 'WebSocket', value: 'ws' },
    { label: 'Server-Sent Events', value: 'sse' },
  ];

  authTypeOptions: DropdownOption[] = [
    { label: 'No auth', value: AuthType.NONE },
    { label: 'Bearer', value: AuthType.BEARER },
    { label: 'Basic', value: AuthType.BASIC },
    { label: 'API key (header)', value: AuthType.API_KEY },
  ];

  AuthType = AuthType;

  protocolsInput = '';

  private destroy$ = new Subject<void>();
  private boundTabId: string | null = null;
  private stateSub: Subscription | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private isSavedCollectionEntry = false;

  constructor(
    private wsService: WebSocketService,
    private collectionService: CollectionService,
    private environmentsService: EnvironmentsService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.bind(this.tab?.id);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['tab']) {
      this.bind(this.tab?.id);
    }
  }

  ngOnDestroy(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.stateSub?.unsubscribe();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private bind(tabId: string | undefined) {
    if (!tabId) return;

    if (tabId !== this.boundTabId) {
      this.boundTabId = tabId;
      this.stateSub?.unsubscribe();

      const entry = this.collectionService.findWebSocketRequestById(tabId);
      this.isSavedCollectionEntry = !!entry;

      if (entry) {
        this.wsService.ensure(tabId, {
          title: this.tab?.title || entry.title,
          mode: entry.mode,
          url: entry.url || '',
          protocols: entry.protocols || [],
          headers: entry.headers || [],
          messageDraft: entry.messageDraft || '',
          auth: entry.auth ?? { type: AuthType.NONE },
        });
      } else {
        this.wsService.ensure(tabId, { title: this.tab?.title });
      }

      this.stateSub = this.wsService
        .state$(tabId)
        .pipe(takeUntil(this.destroy$))
        .subscribe((state) => {
          this.view = {
            status: state.status,
            tab: state.tab,
            frames: state.frames,
            error: state.error,
          };
          this.protocolsInput = (state.tab.protocols || []).join(', ');
          this.cdr.markForCheck();
        });
    }

    if (this.tab?.title) {
      this.wsService.updateTab(tabId, { title: this.tab.title });
    }
  }

  trackByFrame = (_i: number, f: WebSocketFrame) => f.id;
  trackByHeader = (i: number) => i;

  get isConnected(): boolean {
    return this.view.status === 'connected';
  }

  get authModel(): RequestAuth {
    return this.view.tab.auth || { type: AuthType.NONE };
  }

  get statusLabel(): string {
    switch (this.view.status) {
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Connecting…';
      case 'closing':
        return 'Closing…';
      case 'error':
        return 'Error';
      default:
        return 'Disconnected';
    }
  }

  /** Toolbar: show primary Connect (mirrors request Send idle state). */
  get showPrimaryConnect(): boolean {
    return !this.isConnected && this.view.status !== 'connecting' && this.view.status !== 'closing';
  }

  get showConnectingButton(): boolean {
    return this.view.status === 'connecting';
  }

  /** Toolbar: show outline Disconnect while connected or closing. */
  get showDisconnect(): boolean {
    return this.isConnected || this.view.status === 'closing';
  }

  get showAuthTabDot(): boolean {
    const t = this.authModel.type;
    return t !== AuthType.NONE && t !== AuthType.INHERIT;
  }

  private buildVariableMap(): Record<string, string> {
    const out: Record<string, string> = {};
    const id = this.view.tab.id;
    const parents = this.collectionService.getParentFolders(id);
    parents.reverse().forEach((folder) => {
      cleanKv(folder.variables).forEach((v) => {
        out[v.key as string] = (v.value ?? '') as string;
      });
    });
    const env = this.environmentsService.getActiveContext();
    cleanKv(env?.variables).forEach((v) => {
      out[v.key as string] = (v.value ?? '') as string;
    });
    return out;
  }

  private schedulePersistToCollection() {
    if (!this.isSavedCollectionEntry) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      const st = this.wsService.getSnapshot(this.view.tab.id).tab;
      this.collectionService.updateWebSocketRequest({
        id: st.id,
        title: this.tab?.title || st.title,
        mode: st.mode,
        url: st.url,
        protocols: st.protocols,
        headers: st.headers,
        messageDraft: st.messageDraft,
        auth: st.auth,
      });
    }, PERSIST_DEBOUNCE_MS);
  }

  onUrlChange(url: string) {
    this.wsService.updateTab(this.view.tab.id, { url });
    this.schedulePersistToCollection();
  }

  onModeChange(mode: 'ws' | 'sse') {
    this.wsService.updateTab(this.view.tab.id, { mode });
    this.schedulePersistToCollection();
  }

  onDraftChange(draft: string) {
    this.wsService.updateTab(this.view.tab.id, { messageDraft: draft });
    this.schedulePersistToCollection();
  }

  onProtocolsChange(raw: string) {
    this.protocolsInput = raw;
    const parsed = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    this.wsService.updateTab(this.view.tab.id, { protocols: parsed });
    this.schedulePersistToCollection();
  }

  addHeader() {
    const next = [...(this.view.tab.headers || []), { key: '', value: '', enabled: true }];
    this.wsService.updateTab(this.view.tab.id, { headers: next });
    this.schedulePersistToCollection();
  }

  updateHeader(index: number, field: 'key' | 'value' | 'enabled', value: string | boolean) {
    const headers = (this.view.tab.headers || []).map((h, i) =>
      i === index ? { ...h, [field]: value } : h,
    );
    this.wsService.updateTab(this.view.tab.id, { headers });
    this.schedulePersistToCollection();
  }

  removeHeader(index: number) {
    const headers = (this.view.tab.headers || []).filter((_, i) => i !== index);
    this.wsService.updateTab(this.view.tab.id, { headers });
    this.schedulePersistToCollection();
  }

  onAuthTypeChange(type: AuthType) {
    let next: RequestAuth = { type };
    if (type === AuthType.BEARER) {
      next = { type, bearer: { token: this.authModel.bearer?.token || '' } };
    } else if (type === AuthType.BASIC) {
      next = {
        type,
        basic: {
          username: this.authModel.basic?.username || '',
          password: this.authModel.basic?.password || '',
        },
      };
    } else if (type === AuthType.API_KEY) {
      next = {
        type,
        apiKey: {
          key: this.authModel.apiKey?.key || '',
          value: this.authModel.apiKey?.value || '',
          addTo: 'header',
        },
      };
    }
    this.wsService.updateTab(this.view.tab.id, { auth: next });
    this.schedulePersistToCollection();
  }

  patchAuthBearer(token: string) {
    this.wsService.updateTab(this.view.tab.id, {
      auth: { type: AuthType.BEARER, bearer: { token } },
    });
    this.schedulePersistToCollection();
  }

  patchAuthBasic(field: 'username' | 'password', value: string) {
    const basic = { ...(this.authModel.basic || { username: '', password: '' }), [field]: value };
    this.wsService.updateTab(this.view.tab.id, { auth: { type: AuthType.BASIC, basic } });
    this.schedulePersistToCollection();
  }

  patchAuthApiKey(field: 'key' | 'value', value: string) {
    const apiKey = {
      ...(this.authModel.apiKey || { key: '', value: '', addTo: 'header' as const }),
      addTo: 'header' as const,
      [field]: value,
    };
    this.wsService.updateTab(this.view.tab.id, { auth: { type: AuthType.API_KEY, apiKey } });
    this.schedulePersistToCollection();
  }

  async connect() {
    const vars = this.buildVariableMap();
    const sub = (s: string) => substituteWsVariables(s || '', vars);
    const snap = this.wsService.getSnapshot(this.view.tab.id);
    const tab = snap.tab;
    const url = sub(tab.url || '').trim();
    const manual = manualHeadersForWebSocketConnect(tab.headers, sub);
    const authH = authHeadersForWebSocketConnect(tab.auth, sub);
    const headers = mergeWebSocketConnectHeaders(manual, authH);
    await this.wsService.connect(this.view.tab.id, { url, headers });
  }

  async disconnect() {
    await this.wsService.disconnect(this.view.tab.id);
  }

  async send() {
    const draft = this.view.tab.messageDraft || '';
    if (!draft) return;
    await this.wsService.send(this.view.tab.id, draft, false);
    this.wsService.updateTab(this.view.tab.id, { messageDraft: '' });
  }

  clear() {
    this.wsService.clearFrames(this.view.tab.id);
  }

  formatTimestamp(at: number | undefined): string {
    return formatTimestampForUi(at, 'HH:mm:ss.SSS');
  }
}
