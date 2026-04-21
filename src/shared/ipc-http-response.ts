/** Shape returned from the main process `http-request` IPC (Node HTTP stack). */
export interface IpcHttpResponse {
  status: number;
  statusText?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  timeMs?: number;
  size?: number;
  cookies?: unknown[];
  /** True when the body is a non-text payload (image, octet-stream, …). */
  isBinary?: boolean;
  /** Base64-encoded raw bytes, present only when `isBinary` is true. */
  binaryBase64?: string;
  /** Lower-cased content-type header value for quick classification. */
  contentType?: string;
  /** Wire protocol (`HTTP/1.1`, `HTTP/2`). Populated by the Node HTTP stack. */
  httpVersion?: string;
}
