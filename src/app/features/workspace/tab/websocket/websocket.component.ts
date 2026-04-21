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
import { Subject, takeUntil } from 'rxjs';
import { TabItem } from '@core/tab.service';
import { WebSocketService } from '@core/websocket.service';
import { DropdownComponent, DropdownOption } from '../../shared/dropdown/dropdown.component';
import {
  WebSocketConnectionStatus,
  WebSocketFrame,
  WebSocketTabState,
} from '@models/websocket';

type ConnectionView = {
  status: WebSocketConnectionStatus;
  tab: WebSocketTabState;
  frames: WebSocketFrame[];
  error?: string;
};

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

  activeSection: 'message' | 'headers' | 'protocols' = 'message';

  modeOptions: DropdownOption[] = [
    { label: 'WebSocket', value: 'ws' },
    { label: 'Server-Sent Events', value: 'sse' },
  ];

  protocolsInput = '';

  private destroy$ = new Subject<void>();
  private boundTabId: string | null = null;

  constructor(
    private wsService: WebSocketService,
    private cdr: ChangeDetectorRef
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
    this.destroy$.next();
    this.destroy$.complete();
  }

  private bind(tabId: string | undefined) {
    if (!tabId || tabId === this.boundTabId) return;
    this.boundTabId = tabId;
    this.wsService.ensure(tabId, { title: this.tab.title });
    this.wsService
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

  trackByFrame = (_i: number, f: WebSocketFrame) => f.id;
  trackByHeader = (i: number) => i;

  get isConnected(): boolean {
    return this.view.status === 'connected';
  }

  get statusLabel(): string {
    switch (this.view.status) {
      case 'connected': return 'Connected';
      case 'connecting': return 'Connecting…';
      case 'closing': return 'Closing…';
      case 'error': return 'Error';
      default: return 'Disconnected';
    }
  }

  onUrlChange(url: string) {
    this.wsService.updateTab(this.view.tab.id, { url });
  }

  onModeChange(mode: 'ws' | 'sse') {
    this.wsService.updateTab(this.view.tab.id, { mode });
  }

  onDraftChange(draft: string) {
    this.wsService.updateTab(this.view.tab.id, { messageDraft: draft });
  }

  onProtocolsChange(raw: string) {
    this.protocolsInput = raw;
    const parsed = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    this.wsService.updateTab(this.view.tab.id, { protocols: parsed });
  }

  addHeader() {
    const next = [...(this.view.tab.headers || []), { key: '', value: '', enabled: true }];
    this.wsService.updateTab(this.view.tab.id, { headers: next });
  }

  updateHeader(index: number, field: 'key' | 'value' | 'enabled', value: string | boolean) {
    const headers = (this.view.tab.headers || []).map((h, i) =>
      i === index ? { ...h, [field]: value } : h
    );
    this.wsService.updateTab(this.view.tab.id, { headers });
  }

  removeHeader(index: number) {
    const headers = (this.view.tab.headers || []).filter((_, i) => i !== index);
    this.wsService.updateTab(this.view.tab.id, { headers });
  }

  async connect() {
    await this.wsService.connect(this.view.tab.id);
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
    if (!at) return '';
    const d = new Date(at);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  }
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}
