import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import {
  WebSocketConnectionStatus,
  WebSocketFrame,
  WebSocketTabState,
} from '@models/websocket';

interface ConnectionState {
  status: WebSocketConnectionStatus;
  connectionId: string | null;
  tab: WebSocketTabState;
  frames: WebSocketFrame[];
  error?: string;
  unsubscribe?: () => void;
}

/**
 * Per-tab state container for WebSocket/SSE sessions. Mirrors the shape of
 * `TabViewState` but lives here so the component can reload across mount
 * cycles without losing frames.
 */
@Injectable({ providedIn: 'root' })
export class WebSocketService {
  private readonly tabs = new Map<string, BehaviorSubject<ConnectionState>>();

  /** Retrieves the BehaviorSubject for a tab, creating it on first use. */
  ensure(tabId: string, initial?: Partial<WebSocketTabState>): BehaviorSubject<ConnectionState> {
    const existing = this.tabs.get(tabId);
    if (existing) return existing;
    const tabState: WebSocketTabState = {
      id: tabId,
      title: initial?.title || 'WebSocket',
      mode: initial?.mode || 'ws',
      url: initial?.url || '',
      protocols: initial?.protocols || [],
      headers: initial?.headers || [],
      messageDraft: initial?.messageDraft || '',
      messageHistory: initial?.messageHistory || [],
      auth: initial?.auth,
    };
    const subject = new BehaviorSubject<ConnectionState>({
      status: 'disconnected',
      connectionId: null,
      tab: tabState,
      frames: tabState.messageHistory.slice(),
    });
    this.tabs.set(tabId, subject);
    return subject;
  }

  state$(tabId: string): Observable<ConnectionState> {
    return this.ensure(tabId).asObservable();
  }

  getSnapshot(tabId: string): ConnectionState {
    return this.ensure(tabId).value;
  }

  updateTab(tabId: string, patch: Partial<WebSocketTabState>) {
    const subject = this.ensure(tabId);
    const current = subject.value;
    subject.next({ ...current, tab: { ...current.tab, ...patch } });
  }

  /**
   * @param connectOverrides When set, `url` and `headers` are used for the wire handshake
   * (e.g. after env substitution and auth merge). Otherwise headers are built from tab state only.
   */
  async connect(
    tabId: string,
    connectOverrides?: { url?: string; headers?: Record<string, string> },
  ): Promise<void> {
    const subject = this.ensure(tabId);
    const current = subject.value;
    if (current.status === 'connecting' || current.status === 'connected') return;
    const tab = current.tab;
    const urlToUse = (connectOverrides?.url ?? tab.url)?.trim();
    if (!urlToUse) {
      subject.next({ ...current, status: 'error', error: 'URL is required' });
      return;
    }
    const api = window.awElectron;
    if (!api || !api.wsConnect) {
      subject.next({ ...current, status: 'error', error: 'Electron IPC unavailable' });
      return;
    }
    const connectionId = uuidv4();
    const headers: Record<string, string> = connectOverrides?.headers
      ? { ...connectOverrides.headers }
      : {};
    if (!connectOverrides?.headers) {
      for (const h of tab.headers || []) {
        if (h.enabled === false || !h.key) continue;
        headers[h.key] = h.value || '';
      }
    }
    const unsubscribe = api.onWsEvent(connectionId, (event) => {
      this.handleEvent(tabId, event as unknown as Record<string, unknown> & { type: string });
    });
    subject.next({
      ...current,
      status: 'connecting',
      connectionId,
      unsubscribe,
      error: undefined,
    });

    try {
      await api.wsConnect({
        connectionId,
        url: urlToUse,
        protocols: tab.protocols || [],
        headers,
        mode: tab.mode,
      });
    } catch (err) {
      const msg: string = (err instanceof Error ? err.message : String(err)) || 'WebSocket connect failed';
      unsubscribe();
      subject.next({
        ...subject.value,
        status: 'error',
        error: msg,
        connectionId: null,
        unsubscribe: undefined,
      });
    }
  }

  async disconnect(tabId: string): Promise<void> {
    const subject = this.tabs.get(tabId);
    if (!subject) return;
    const current = subject.value;
    if (!current.connectionId) return;
    subject.next({ ...current, status: 'closing' });
    const api = window.awElectron;
    if (!api || !api.wsClose) return;
    try {
      await api.wsClose({ connectionId: current.connectionId, code: 1000, reason: 'Client close' });
    } catch {
    }
  }

  async send(tabId: string, data: string, isBinary = false): Promise<void> {
    const subject = this.tabs.get(tabId);
    if (!subject) return;
    const current = subject.value;
    if (current.status !== 'connected' || !current.connectionId) return;
    const api = window.awElectron;
    if (!api || !api.wsSend) return;
    try {
      await api.wsSend({ connectionId: current.connectionId, data, isBinary });
    } catch (err) {
      const msg: string = err instanceof Error ? err.message : String(err);
      this.appendFrame(tabId, {
        id: uuidv4(),
        at: Date.now(),
        direction: 'system',
        kind: 'error',
        message: `Send failed: ${msg}`,
      });
    }
  }

  clearFrames(tabId: string) {
    const subject = this.ensure(tabId);
    const current = subject.value;
    subject.next({
      ...current,
      frames: [],
      tab: { ...current.tab, messageHistory: [] },
    });
  }

  dispose(tabId: string) {
    const subject = this.tabs.get(tabId);
    if (!subject) return;
    const current = subject.value;
    if (current.unsubscribe) current.unsubscribe();
    if (current.connectionId && window.awElectron?.wsClose) {
      window.awElectron.wsClose({ connectionId: current.connectionId, code: 1000, reason: 'Tab closed' }).catch(() => {});
    }
    this.tabs.delete(tabId);
  }

  private handleEvent(tabId: string, event: Record<string, unknown> & { type: string }) {
    const subject = this.tabs.get(tabId);
    if (!subject) return;
    switch (event.type) {
      case 'open':
        subject.next({ ...subject.value, status: 'connected', error: undefined });
        this.appendFrame(tabId, {
          id: uuidv4(),
          at: Date.now(),
          direction: 'system',
          kind: 'info',
          message: `Connected${event['protocol'] ? ` (protocol: ${event['protocol']})` : ''}`,
        });
        break;
      case 'message':
        this.appendFrame(tabId, {
          id: uuidv4(),
          at: typeof event['at'] === 'number' ? (event['at'] as number) : Date.now(),
          direction: (event['direction'] as 'in' | 'out') || 'in',
          kind: event['isBinary']
            ? 'binary'
            : event['event']
              ? 'event'
              : 'text',
          data: event['data'] as string | undefined,
          binaryBase64: event['binaryBase64'] as string | undefined,
          event: event['event'] as string | undefined,
        });
        break;
      case 'control':
        this.appendFrame(tabId, {
          id: uuidv4(),
          at: Date.now(),
          direction: 'system',
          kind: 'info',
          message: `${(event['kind'] as string) || 'control'} received`,
        });
        break;
      case 'error': {
        const msg = (event['message'] as string) || 'Unknown WebSocket error';
        this.appendFrame(tabId, {
          id: uuidv4(),
          at: Date.now(),
          direction: 'system',
          kind: 'error',
          message: msg,
        });
        subject.next({ ...subject.value, status: 'error', error: msg });
        break;
      }
      case 'close': {
        const code = event['code'] as number | undefined;
        const reason = event['reason'] as string | undefined;
        this.appendFrame(tabId, {
          id: uuidv4(),
          at: Date.now(),
          direction: 'system',
          kind: 'info',
          message: `Closed${code ? ` (${code})` : ''}${reason ? `: ${reason}` : ''}`,
          code,
          reason,
        });
        const current = subject.value;
        if (current.unsubscribe) current.unsubscribe();
        subject.next({
          ...current,
          status: 'disconnected',
          connectionId: null,
          unsubscribe: undefined,
        });
        break;
      }
    }
  }

  private appendFrame(tabId: string, frame: WebSocketFrame) {
    const subject = this.tabs.get(tabId);
    if (!subject) return;
    const current = subject.value;
    const nextFrames = [...current.frames, frame];
    const capped = nextFrames.length > 2000 ? nextFrames.slice(-2000) : nextFrames;
    subject.next({
      ...current,
      frames: capped,
      tab: { ...current.tab, messageHistory: capped },
    });
  }
}
