import type { RequestAuth } from './request';

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
  /** Structured auth (Bearer / Basic / API key); merged into connect headers (auth wins key conflicts). */
  auth?: RequestAuth;
}

/**
 * A WebSocket/SSE definition stored under a collection or folder (like an HTTP request row).
 * Frame history is not persisted.
 */
export interface WebSocketCollectionEntry {
  id: string;
  order?: number;
  title: string;
  mode: 'ws' | 'sse';
  url: string;
  protocols?: string[];
  headers?: Array<{ key: string; value: string; enabled?: boolean }>;
  messageDraft?: string;
  auth?: RequestAuth;
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
