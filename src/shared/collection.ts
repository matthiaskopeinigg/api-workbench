import { HttpHeader, Request, Script, RequestAuth, AuthType } from "./request";
import type { WebSocketCollectionEntry } from './websocket';


export interface Collection {
  id: string;
  order: number;
  title: string;
  requests: Request[];
  /** Saved WebSocket / SSE endpoints (parallel to `requests`). */
  websocketRequests?: WebSocketCollectionEntry[];
  folders: Folder[];
  auth?: RequestAuth;
  settings?: Request['settings'];
  script?: Script;
}


export interface Folder {
  id: string;
  order: number;
  title: string;
  requests: Request[];
  websocketRequests?: WebSocketCollectionEntry[];
  folders: Folder[];

  variables?: {
    key: string;
    value: string;
    description?: string;
  }[];

  script?: Script;
  httpHeaders?: HttpHeader[];
  auth?: RequestAuth;
  settings?: Request['settings'];
}


