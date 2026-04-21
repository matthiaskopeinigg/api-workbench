import { HttpHeader } from "./request";


export interface Response {

  statusCode: number;


  statusText?: string;


  timeMs?: number;


  size?: number;


  headers: HttpHeader[];


  body?: string;


  receivedAt: Date;
  cookies?: any[];

  /** True when the server returned a non-text payload (image, pdf, binary). */
  isBinary?: boolean;

  /** Base64-encoded raw bytes; only set when `isBinary` is true. */
  binaryBase64?: string;

  /** Lower-cased content-type, used for preview routing (image/png, application/pdf, …). */
  contentType?: string;

  /** Results of `pm.test(...)` invocations executed during the post-request script. */
  testResults?: TestResult[];

  /** Wire protocol used for the request (`HTTP/1.1`, `HTTP/2`). */
  httpVersion?: string;
}

export interface TestResult {
  name: string;
  passed: boolean;
  message?: string;
  durationMs?: number;
}


