/** Persisted WebSocket/SSE tab configuration. */
export interface WebSocketTabState {
  id: string;
  title: string;
  mode: 'ws' | 'sse';
  url: string;
  protocols: string[];
  headers: Array<{ key: string; value: string; enabled?: boolean }>;
  messageDraft: string;
  messageHistory: WebSocketFrame[];
}

export interface WebSocketFrame {
  id: string;
  at: number;
  direction: 'in' | 'out' | 'system';
  kind: 'text' | 'binary' | 'event' | 'error' | 'info';
  data?: string;
  binaryBase64?: string;
  event?: string;
  code?: number;
  reason?: string;
  message?: string;
}

export type WebSocketConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'closing'
  | 'error';
