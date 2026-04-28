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
  /**
   * @deprecated Legacy single “primary” id for UI/templates. Derived from
   * {@link activeMockVariantIds} when that list is set; otherwise first variant.
   */
  activeMockVariantId?: string;
  /**
   * Variant ids that participate in automatic `/mock/<requestId>` selection
   * (matchers + fallbacks). When **undefined** or **null**, **all** variants are served.
   * When **[]**, none are served for the unpinned URL (explicit `/mock/id/variantId` still works).
   */
  activeMockVariantIds?: string[] | null;

  /** Starred/favorited by the user; surfaced via the starred filter. */
  starred?: boolean;
}

/** One header predicate; name is case-insensitive on the wire. */
export interface MockVariantHeaderMatchRule {
  name: string;
  /** Substring match on the header value (case-sensitive). */
  contains?: string;
  /** Exact header value (case-sensitive). */
  equals?: string;
  /**
   * Regex matched against the header value. Server precedence when multiple are set:
   * **equals** → **matches** → **contains** → header must be present and non-empty.
   */
  matches?: string;
}

export interface MockVariantQueryParamMatchRule {
  name: string;
  /** Exact value for the first occurrence of this query name. */
  value?: string;
  /** If set (non-empty), the first query value must match this regex instead of `value`. */
  valueRegex?: string;
}

/**
 * When any field here is set, the variant only serves requests that satisfy **all**
 * of those predicates (AND). Variants with **no** matchers act as a default/fallback.
 * Order in the variant list is the match priority (first winning variant wins), similar to WireMock priorities.
 */
/** HTTP verbs offered for mock variant method matching (multi-select in UI). */
export const MOCK_MATCH_HTTP_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
  'TRACE',
  'CONNECT',
] as const;

export interface MockVariantMatchRules {
  /** @deprecated Prefer `methods`. Single method (case-insensitive). */
  method?: string;
  /**
   * When non-empty, incoming method must be one of these (case-insensitive OR).
   * If set, it replaces legacy `method` / `methodRegex` for matching (UI clears those when using chips).
   */
  methods?: string[];
  /** @deprecated Prefer `methods`. If `methods` is empty, both `method` and this may still apply (AND). */
  methodRegex?: string;
  /** Path plus query string must contain this substring (useful for `?scenario=paid`). */
  pathContains?: string;
  /** Path plus query string (same haystack as `pathContains`) must match this regex (`s` flag). */
  pathRegex?: string;
  headers?: MockVariantHeaderMatchRule[];
  /** Request body must contain this substring (UTF-8). */
  bodyContains?: string;
  /** Request body must match this regular expression (`RegExp` string form; `s` flag). */
  bodyRegex?: string;
  queryParams?: MockVariantQueryParamMatchRule[];
  /** Dot path into parsed JSON body (body must be JSON). Compared to `bodyJsonEquals` after JSON.parse. */
  bodyJsonPath?: string;
  /** JSON text for the expected value at `bodyJsonPath` (e.g. `"premium"` or `true` or `{"a":1}`). Takes precedence over `bodyJsonMatches` when both are set. */
  bodyJsonEquals?: string;
  /** Regex on the string form of the value at `bodyJsonPath` (objects JSON-stringified). Used when `bodyJsonEquals` is unset or empty. */
  bodyJsonMatches?: string;
}

/** DB interaction step before the final mock response; result stored in `cache[assignTo]`. */
export interface MockResponseStepDb {
  id: string;
  kind: 'db';
  /** Saved connection id from Settings → Databases. */
  connectionId: string;
  /** SQL, Redis command, etc. */
  command: string;
  /** Name for `{{cache.name}}` templates in the final response. */
  assignTo: string;
}

/** Optional script between DB steps; mutates the shared `cache` object. */
export interface MockResponseStepScript {
  id: string;
  kind: 'script';
  script: string;
}

export type MockResponseStep = MockResponseStepDb | MockResponseStepScript;

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
  /** Optional request matchers (see {@link MockVariantMatchRules}). */
  matchOn?: MockVariantMatchRules;
  /**
   * Ordered steps (DB, then script) run before the static response; use `{{cache.key}}` in body/headers.
   */
  responseSteps?: MockResponseStep[];
}

/** Deep-clone {@link MockVariantMatchRules} for duplicate-variant flows. */
export function cloneMockVariantMatchRules(
  m?: MockVariantMatchRules
): MockVariantMatchRules | undefined {
  if (!m) return undefined;
  return {
    method: m.method,
    methods: m.methods ? [...m.methods] : undefined,
    methodRegex: m.methodRegex,
    pathContains: m.pathContains,
    pathRegex: m.pathRegex,
    bodyContains: m.bodyContains,
    bodyRegex: m.bodyRegex,
    bodyJsonPath: m.bodyJsonPath,
    bodyJsonEquals: m.bodyJsonEquals,
    bodyJsonMatches: m.bodyJsonMatches,
    headers: m.headers?.map((h) => ({ ...h })),
    queryParams: m.queryParams?.map((p) => ({ ...p })),
  };
}

/** Whether this variant is included when the mock resolves `/mock/<requestId>` without a variant segment. */
export function isMockVariantServed(
  variantId: string,
  mockVariants: MockVariant[] | undefined,
  activeMockVariantIds: string[] | null | undefined
): boolean {
  const list = mockVariants || [];
  if (!list.some((v) => v.id === variantId)) return false;
  if (activeMockVariantIds == null) return true;
  if (activeMockVariantIds.length === 0) return false;
  return activeMockVariantIds.includes(variantId);
}

/**
 * Keeps {@link Request.activeMockVariantId} in sync for older UI / exports:
 * first served id in variant list order, or undefined when none served.
 */
export function syncLegacyPrimaryMockVariantId(request: {
  mockVariants?: MockVariant[];
  activeMockVariantIds?: string[] | null;
  activeMockVariantId?: string;
}): void {
  const list = request.mockVariants || [];
  if (!list.length) {
    request.activeMockVariantId = undefined;
    return;
  }
  const ids = request.activeMockVariantIds;
  if (ids == null) {
    request.activeMockVariantId = list[0]?.id;
    return;
  }
  if (ids.length === 0) {
    request.activeMockVariantId = undefined;
    return;
  }
  const first = list.find((v) => ids.includes(v.id));
  request.activeMockVariantId = first?.id;
}

/**
 * Toggle whether a variant participates in unpinned mock URL resolution.
 * `activeIds` **undefined** means “all served”; persists as omitted / undefined when all are on.
 */
export function toggleVariantServed(
  variants: Array<{ id: string }>,
  variantId: string,
  read: () => string[] | null | undefined,
  write: (next: string[] | null | undefined) => void,
): void {
  const list = variants || [];
  if (!list.some((v) => v.id === variantId)) return;
  const allIds = list.map((v) => v.id);
  const ids = read();
  if (ids == null) {
    const next = allIds.filter((x) => x !== variantId);
    write(next.length === 0 ? [] : next);
    return;
  }
  if (ids.includes(variantId)) {
    write(ids.filter((x) => x !== variantId));
    return;
  }
  const next = [...ids, variantId];
  if (next.length === allIds.length && allIds.every((x) => next.includes(x))) {
    write(undefined);
  } else {
    write(next);
  }
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


