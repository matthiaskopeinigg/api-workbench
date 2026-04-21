import * as yaml from 'js-yaml';

/**
 * A parsed OpenAPI-ish document trimmed down to the pieces the importer and
 * the Contract Validator actually consume.
 *
 * We deliberately avoid dragging in a full OpenAPI schema library — most
 * real-world specs we encounter are lightly malformed, and we'd rather get a
 * best-effort list of operations than hard-fail on a spec that imports fine
 * in Postman / Insomnia. Callers can inspect `errors` to surface warnings.
 */
export interface ParsedSpec {
  /** Meta information. */
  info: { title: string; version: string };
  /** Servers declared at the root. */
  servers: string[];
  /** Flattened list of operations; order matches doc order where possible. */
  operations: SpecOperation[];
  /** Non-fatal parse warnings (e.g. dereference misses). */
  errors: string[];
}

export interface SpecOperation {
  /** Path template, e.g. "/users/{id}". */
  path: string;
  /** HTTP method, uppercase. */
  method: string;
  operationId?: string;
  summary?: string;
  description?: string;
  parameters: SpecParameter[];
  /** Required request body content-types → schema. */
  requestBody?: SpecRequestBody;
  /** Status-code → response descriptor. Key "default" may exist too. */
  responses: Record<string, SpecResponse>;
  /** Security requirements (names from components.securitySchemes). */
  security?: Array<Record<string, string[]>>;
  /** Raw operation object for callers that need something unusual. */
  raw: unknown;
}

export interface SpecParameter {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie';
  required?: boolean;
  description?: string;
  schema?: unknown;
  example?: unknown;
}

export interface SpecRequestBody {
  required?: boolean;
  content: Record<string, { schema?: unknown; example?: unknown }>;
}

export interface SpecResponse {
  description?: string;
  content?: Record<string, { schema?: unknown; example?: unknown }>;
  headers?: Record<string, { schema?: unknown; description?: string }>;
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);

interface OpenApiRoot {
  info?: { title?: string; version?: string };
  servers?: Array<{ url?: string }>;
  host?: string;
  schemes?: string[];
  basePath?: string;
  paths?: Record<string, OpenApiPathItem>;
}

interface OpenApiPathItem {
  parameters?: unknown;
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
  patch?: OpenApiOperation;
  delete?: OpenApiOperation;
  head?: OpenApiOperation;
  options?: OpenApiOperation;
  trace?: OpenApiOperation;
  [method: string]: unknown;
}

interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: unknown;
  requestBody?: unknown;
  responses?: unknown;
  security?: Array<Record<string, string[]>>;
}

/**
 * Parse a YAML or JSON OpenAPI 3.x / Swagger 2.0 document. Callers that only
 * have one format can still pass format: 'auto' — we sniff the first
 * non-whitespace character.
 */
export function parseOpenApi(body: string, format: 'json' | 'yaml' | 'auto' = 'auto'): ParsedSpec {
  const errors: string[] = [];
  const doc = loadDoc(body, format, errors);
  if (!doc || typeof doc !== 'object') {
    return { info: { title: '', version: '' }, servers: [], operations: [], errors };
  }

  const root = doc as OpenApiRoot;
  const info = root.info || {};
  const servers = Array.isArray(root.servers)
    ? root.servers.map((s) => s.url || '').filter(Boolean)
    : typeof root.host === 'string'
      ? [`${(root.schemes && root.schemes[0]) || 'https'}://${root.host}${root.basePath || ''}`]
      : [];

  const paths = root.paths || {};
  const operations: SpecOperation[] = [];

  for (const rawPath of Object.keys(paths)) {
    const pathItem = paths[rawPath];
    if (!pathItem || typeof pathItem !== 'object') continue;
    const commonParams = normalizeParameters(pathItem.parameters);

    for (const method of Object.keys(pathItem)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      const op = pathItem[method as keyof OpenApiPathItem] as OpenApiOperation | undefined;
      if (!op || typeof op !== 'object') continue;

      const opParams = normalizeParameters(op.parameters);
      operations.push({
        path: rawPath,
        method: method.toUpperCase(),
        operationId: op.operationId,
        summary: op.summary,
        description: op.description,
        parameters: [...commonParams, ...opParams],
        requestBody: normalizeRequestBody(op.requestBody),
        responses: normalizeResponses(op.responses),
        security: op.security,
        raw: op,
      });
    }
  }

  return {
    info: { title: info.title || '', version: info.version || '' },
    servers,
    operations,
    errors,
  };
}

/**
 * Resolve a concrete request (method + URL) against a parsed spec.
 * Strips the best-matching server prefix, then walks the operation list
 * looking for a path template that matches after substituting
 * `{param}` segments with greedy non-slash wildcards.
 *
 * Returns `null` when no operation matches — callers typically report this
 * as an "undocumented" finding.
 */
export function matchOperation(
  spec: ParsedSpec,
  method: string,
  url: string,
): { operation: SpecOperation; pathParams: Record<string, string> } | null {
  const stripped = stripServerPrefix(spec.servers, url);
  const normMethod = method.toUpperCase();
  for (const op of spec.operations) {
    if (op.method !== normMethod) continue;
    const match = matchPathTemplate(op.path, stripped);
    if (match) return { operation: op, pathParams: match };
  }
  return null;
}

function loadDoc(body: string, format: 'json' | 'yaml' | 'auto', errors: string[]): unknown {
  if (!body || !body.trim()) return null;
  const detectJson = format === 'json' || (format === 'auto' && body.trimStart().startsWith('{'));
  if (detectJson) {
    try { return JSON.parse(body); }
    catch (err) {
      errors.push(`JSON parse error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  try { return yaml.load(body); }
  catch (err) { errors.push(`YAML parse error: ${err instanceof Error ? err.message : String(err)}`); }
  return null;
}

interface RawParameter {
  name?: unknown;
  in?: unknown;
  required?: unknown;
  description?: unknown;
  schema?: unknown;
  example?: unknown;
}

function normalizeParameters(raw: unknown): SpecParameter[] {
  if (!Array.isArray(raw)) return [];
  const out: SpecParameter[] = [];
  for (const p of raw as RawParameter[]) {
    if (!p || typeof p !== 'object') continue;
    if (typeof p.name !== 'string' || typeof p.in !== 'string') continue;
    if (!['query', 'header', 'path', 'cookie'].includes(p.in)) continue;
    out.push({
      name: p.name,
      in: p.in as SpecParameter['in'],
      required: !!p.required,
      description: typeof p.description === 'string' ? p.description : undefined,
      schema: p.schema,
      example: p.example,
    });
  }
  return out;
}

interface RawRequestBody {
  required?: unknown;
  content?: Record<string, { schema?: unknown; example?: unknown }>;
}

function normalizeRequestBody(raw: unknown): SpecRequestBody | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rb = raw as RawRequestBody;
  return { required: !!rb.required, content: rb.content || {} };
}

interface RawResponseEntry {
  description?: unknown;
  content?: Record<string, { schema?: unknown; example?: unknown }>;
  headers?: Record<string, { schema?: unknown; description?: string }>;
}

function normalizeResponses(raw: unknown): Record<string, SpecResponse> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, SpecResponse> = {};
  for (const [code, resp] of Object.entries(raw as Record<string, RawResponseEntry>)) {
    if (!resp || typeof resp !== 'object') continue;
    out[code] = {
      description: typeof resp.description === 'string' ? resp.description : undefined,
      content: resp.content,
      headers: resp.headers,
    };
  }
  return out;
}

function stripServerPrefix(servers: string[], url: string): string {
  let best = url;
  for (const s of servers) {
    const server = trimTrailing(s, '/');
    if (url.startsWith(server) && (url.length - server.length) < (best.length)) {
      best = url.slice(server.length) || '/';
    }
    try {
      const { pathname } = new URL(server);
      if (pathname && pathname !== '/' && url.startsWith(pathname)) {
        const tail = url.slice(pathname.length) || '/';
        if (tail.length < best.length) best = tail;
      }
    } catch {
      // server may be a relative path; skip URL parsing.
    }
  }
  try {
    const parsed = new URL(best);
    best = parsed.pathname || '/';
  } catch {
    // already a path
  }
  const qIdx = best.indexOf('?');
  if (qIdx >= 0) best = best.slice(0, qIdx);
  return best;
}

function matchPathTemplate(template: string, actual: string): Record<string, string> | null {
  const tParts = template.split('/').filter(Boolean);
  const aParts = actual.split('/').filter(Boolean);
  if (tParts.length !== aParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < tParts.length; i++) {
    const t = tParts[i];
    const a = aParts[i];
    if (t.startsWith('{') && t.endsWith('}')) {
      params[t.slice(1, -1)] = decodeURIComponent(a);
      continue;
    }
    if (t !== a) return null;
  }
  return params;
}

function trimTrailing(s: string, ch: string): string {
  return s.endsWith(ch) ? s.slice(0, -ch.length) : s;
}
