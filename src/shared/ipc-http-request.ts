import type { Certificate, DnsSettings, ProxySettings, RetrySettings } from './settings';
import type { FormDataField, UrlencodedField } from './request';

/** Structured body envelope. When omitted, `body` is treated as a raw string. */
export interface IpcStructuredBody {
  mode: 'form-data' | 'urlencoded' | 'binary';
  form?: FormDataField[];
  urlencoded?: UrlencodedField[];
  binary?: { filePath: string; contentType?: string };
}

/** Payload the renderer sends to the main process for `http-request` IPC. */
export interface IpcHttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  params: Record<string, string>;
  body?: string | IpcStructuredBody | unknown;
  certificate?: Certificate | null;
  timeoutMs?: number;
  retries?: RetrySettings;
  dns?: DnsSettings;
  proxy?: ProxySettings;
  ignoreInvalidSsl?: boolean;
  followRedirects?: boolean;
  verifyHostname?: boolean;
  useSystemCaStore?: boolean;
  customCaPaths?: string[];
  useCookies?: boolean;
  /** Opt-in ALPN negotiation for h2. Plain HTTP/1.1 otherwise. */
  allowHttp2?: boolean;
}
