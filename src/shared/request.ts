import { Response } from "./response";


export interface Request {

  id: string;


  order?: number;


  title: string;


  url: string;


  httpMethod: HttpMethod;


  httpHeaders?: HttpHeader[];


  httpParameters?: HttpParameter[];


  /** @deprecated Use `body` instead. Kept for backwards-compat loading. */
  requestBody: string;


  /** Structured body (preferred). Populated by migration or new writes. */
  body?: RequestBody;


  script: Script;


  lastResponse?: Response;


  disabledDefaultHeaders?: string[];
  auth?: RequestAuth;
  graphqlQuery?: string;
  graphqlVariables?: string;
  settings?: {
    followRedirects?: boolean;
    verifySsl?: boolean;
    useCookies?: boolean;
  };

  /** Mock variants served by the built-in mock server for this request. */
  mockVariants?: MockVariant[];
  /** Currently-selected variant id, consumed by the mock server when present. */
  activeMockVariantId?: string;

  /** Starred/favorited by the user; surfaced via the starred filter. */
  starred?: boolean;
}

/**
 * A single mock response variant owned by a request. Variants are keyed by
 * their stable `id`, so switching the active variant is a lightweight
 * reassignment.
 */
export interface MockVariant {
  id: string;
  name: string;
  statusCode: number;
  statusText?: string;
  headers?: Array<{ key: string; value: string }>;
  body?: string;
  /** Simulated latency in ms. Clamped on the server to [0, 30s]. */
  delayMs?: number;
  /** Optional match hint — reserved for future rule-based routing. */
  matchOn?: {
    method?: string;
    pathContains?: string;
  };
}

export type RequestBodyMode =
  | 'none'
  | 'json'
  | 'xml'
  | 'text'
  | 'graphql'
  | 'form-data'
  | 'urlencoded'
  | 'binary';

export interface RequestBody {
  mode: RequestBodyMode;
  /** Used when mode is json/xml/text. */
  raw?: string;
  /** Used when mode is form-data. */
  form?: FormDataField[];
  /** Used when mode is urlencoded. */
  urlencoded?: UrlencodedField[];
  /** Used when mode is binary. */
  binary?: BinaryBody;
}

export interface FormDataField {
  key: string;
  /** 'text' sends a plain value; 'file' sends a file read from disk in main. */
  type: 'text' | 'file';
  value?: string;
  /** Absolute path, populated when `type === 'file'`. */
  filePath?: string;
  /** Optional override for file parts; inferred from extension otherwise. */
  contentType?: string;
  enabled?: boolean;
  description?: string;
}

export interface UrlencodedField {
  key: string;
  value?: string;
  enabled?: boolean;
  description?: string;
}

export interface BinaryBody {
  filePath: string;
  contentType?: string;
}

export interface RequestAuth {
  type: AuthType;
  bearer?: {
    token: string;
  };
  basic?: {
    username?: string;
    password?: string;
  };
  apiKey?: {
    key?: string;
    value?: string;
    addTo?: 'header' | 'query';
  };
  oauth2?: {
    accessToken?: string;
    grantType?: string;
    clientId?: string;
    clientSecret?: string;
    authUrl?: string;
    accessTokenUrl?: string;
    scope?: string;
  };
  digest?: {
    username?: string;
    password?: string;
    realm?: string;
    nonce?: string;
    algorithm?: 'MD5' | 'MD5-sess' | 'SHA-256' | 'SHA-256-sess';
    qop?: '' | 'auth' | 'auth-int';
    nonceCount?: string;
    clientNonce?: string;
    opaque?: string;
  };
  awsSigV4?: {
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
    region?: string;
    service?: string;
    addTo?: 'header' | 'query';
  };
  hawk?: {
    authId?: string;
    authKey?: string;
    algorithm?: 'sha256' | 'sha1';
    user?: string;
    nonce?: string;
    extData?: string;
    app?: string;
    delegatedBy?: string;
    timestamp?: string;
    includePayloadHash?: boolean;
  };
  ntlm?: {
    username?: string;
    password?: string;
    domain?: string;
    workstation?: string;
  };
}

export enum AuthType {
  INHERIT = 'inherit',
  NONE = 'none',
  BEARER = 'bearer',
  BASIC = 'basic',
  API_KEY = 'api_key',
  OAUTH2 = 'oauth2',
  DIGEST = 'digest',
  AWS_SIGV4 = 'aws_sigv4',
  HAWK = 'hawk',
  NTLM = 'ntlm'
}


export interface Script {

  preRequest: string;


  postRequest: string;
}


export interface HttpParameter {

  key: string;


  value: string;

  description?: string;


  type?: 'query' | 'path';


  enabled?: boolean;
}


export interface HttpHeader {

  key: string;


  value: string;

  description?: string;


  enabled?: boolean;
}


export enum HttpMethod {
  GET,
  POST,
  PUT,
  PATCH,
  DELETE,
  HEAD,
  OPTIONS
}


