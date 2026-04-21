import { HttpHeader, Request, Script, RequestAuth, AuthType } from "./request";


export interface Collection {
  id: string;
  order: number;
  title: string;
  requests: Request[];
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


