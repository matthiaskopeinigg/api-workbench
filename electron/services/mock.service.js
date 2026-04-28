const http = require('http');
const crypto = require('crypto');
const fs = require('fs/promises');
const { logInfo, logError } = require('./logger.service');
const scriptService = require('./script.service');
const dbService = require('./db.service');

/**
 * Lightweight local mock server. Variants are registered by request id and
 * served under `/mock/:requestId[/:variantId]`. Standalone endpoints can also
 * be registered by `${method}:${path}` for mocks that aren't bound to a saved
 * request (e.g. quick `/healthz`).
 *
 * Response bodies and response header values may include templates evaluated
 * per hit: `{{header.Name}}`, `{{headerJson.Name}}` (JSON-safe string),
 * `{{body}}`, `{{bodyJson}}` (full incoming body as a JSON string literal),
 * `{{bodyJson.accessToken}}` / `{{bodyJson.user.id}}` (dot path on parsed JSON;
 * request body must be valid JSON; value is JSON.stringify’d for safe embed).
 *
 * A single server instance is shared across the app; starting again reuses
 * the running instance unless options have changed (in which case the caller
 * should restart).
 */

const MAX_HITS = 500;
const MAX_BODY_BYTES = 64 * 1024; 
const BROADCAST_INTERVAL_MS = 100;

let server = null;
let state = {
  port: 0,
  host: '127.0.0.1',
  status: 'stopped', 
  error: null,
};

let options = {
  port: null,                  
  bindAddress: '127.0.0.1',
  defaultDelayMs: 0,
  defaultContentType: 'application/json; charset=utf-8',
  corsMode: 'all',             
  corsOrigins: [],
  autoStart: false,
  captureBodies: true,
};

const registry = new Map();

const standalone = new Map();

/** Standalone routes whose path ends with `/*` (one extra segment) or `/**` (any suffix). */
const standaloneWildcards = [];

const hits = [];

let broadcaster = null;
let pendingBatch = [];
let batchTimer = null;

function setHitBroadcaster(fn) {
  broadcaster = typeof fn === 'function' ? fn : null;
}

function flushBatch() {
  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }
  if (!broadcaster || pendingBatch.length === 0) {
    pendingBatch = [];
    return;
  }
  const batch = pendingBatch;
  pendingBatch = [];
  try { broadcaster(batch); } catch (err) { logError('Mock hit broadcast failed', err); }
}

function queueHit(hit) {
  hits.push(hit);
  while (hits.length > MAX_HITS) hits.shift();
  pendingBatch.push(hit);
  if (!batchTimer) {
    batchTimer = setTimeout(flushBatch, BROADCAST_INTERVAL_MS);
  }
}

function normalizePath(p) {
  if (!p) return '/';
  let path = String(p);
  if (path[0] !== '/') path = `/${path}`;
  return path.replace(/\/+$/, '') || '/';
}

/**
 * Suffix `/*`  → one path segment under base.
 * Suffix `/**` → base or any path under it.
 * @returns {{ pathMode: 'single' | 'greedy', basePath: string } | null}
 */
function parsePathWildcard(pathRaw) {
  const raw = String(pathRaw || '').trim();
  if (raw.endsWith('/**')) {
    return { pathMode: 'greedy', basePath: normalizePath(raw.slice(0, -3)) };
  }
  if (raw.endsWith('/*')) {
    return { pathMode: 'single', basePath: normalizePath(raw.slice(0, -2)) };
  }
  return null;
}

function requestPathMatchesWild(entry, requestPath) {
  const p = normalizePath(String(requestPath || '').split('?')[0]);
  if (entry.pathMode === 'greedy') {
    const b = entry.basePath;
    if (!b || b === '/') {
      return true;
    }
    return p === b || p.startsWith(`${b}/`);
  }
  if (entry.pathMode === 'single') {
    const b = entry.basePath;
    if (b === '/' || b === '') {
      return p.split('/').filter(Boolean).length === 1;
    }
    if (!p.startsWith(`${b}/`)) return false;
    const rest = p.slice(b.length + 1);
    return rest.length > 0 && !rest.includes('/');
  }
  return false;
}

function findWildcardStandalone(method, requestPath) {
  const m = String(method).toUpperCase();
  const matches = standaloneWildcards.filter(
    (e) => e && e.method === m && requestPathMatchesWild(e, requestPath),
  );
  matches.sort((a, b) => b.basePath.length - a.basePath.length);
  return matches[0] || null;
}

function removeWildcardById(id) {
  for (let i = standaloneWildcards.length - 1; i >= 0; i--) {
    if (standaloneWildcards[i].id === id) standaloneWildcards.splice(i, 1);
  }
}

function getStatus() {
  return {
    ...state,
    baseUrl: state.status === 'running' ? `http://${options.bindAddress}:${state.port}` : null,
    options: { ...options },
    registered: Array.from(registry.entries()).map(([id, entry]) => ({
      requestId: id,
      variantCount: Array.isArray(entry.variants) ? entry.variants.length : 0,
      activeVariantId: entry.activeVariantId || null,
      activeVariantIds: Array.isArray(entry.activeVariantIds) ? entry.activeVariantIds : null,
    })),
    standalone: [
      ...Array.from(standalone.values()).map((e) => ({
        id: e.id,
        name: e.name || '',
        method: e.method,
        path: e.path,
        variantCount: e.variants.length,
        activeVariantId: e.activeVariantId || null,
        activeVariantIds: Array.isArray(e.activeVariantIds) ? e.activeVariantIds : null,
      })),
      ...standaloneWildcards.map((e) => ({
        id: e.id,
        name: e.name || '',
        method: e.method,
        path: e.path,
        variantCount: e.variants.length,
        activeVariantId: e.activeVariantId || null,
        activeVariantIds: Array.isArray(e.activeVariantIds) ? e.activeVariantIds : null,
      })),
    ],
  };
}

function parseRequestPath(urlPath) {
  try {
    const url = new URL(urlPath, 'http://internal');
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2 || parts[0] !== 'mock') return null;
    return {
      requestId: decodeURIComponent(parts[1] || ''),
      variantId: parts[2] ? decodeURIComponent(parts[2]) : null,
    };
  } catch {
    return null;
  }
}

function hasMatcherRules(m) {
  if (!m || typeof m !== 'object') return false;
  if (Array.isArray(m.methods) && m.methods.length > 0) return true;
  if (m.method && String(m.method).trim()) return true;
  if (m.methodRegex && String(m.methodRegex).trim()) return true;
  if (m.pathContains && String(m.pathContains).trim()) return true;
  if (m.pathRegex && String(m.pathRegex).trim()) return true;
  if (Array.isArray(m.headers) && m.headers.some((h) => h && String(h.name || '').trim())) return true;
  if (m.bodyContains != null && String(m.bodyContains).length > 0) return true;
  if (m.bodyRegex && String(m.bodyRegex).trim()) return true;
  if (Array.isArray(m.queryParams) && m.queryParams.some((p) => p && String(p.name || '').trim())) return true;
  if (m.bodyJsonPath && String(m.bodyJsonPath).trim()) return true;
  return false;
}

function getSearchString(pathNoQuery, rawUrl) {
  let q = '';
  try {
    q = new URL(rawUrl || '/', 'http://internal').search || '';
  } catch {
    q = '';
  }
  return `${pathNoQuery}${q}`;
}

function variantMatchesRequest(variant, req, pathNoQuery, rawUrl, capturedBody) {
  const m = variant && variant.matchOn;
  if (!hasMatcherRules(m)) return false;
  if (Array.isArray(m.methods) && m.methods.length > 0) {
    const up = String(req.method || 'GET').toUpperCase();
    if (!m.methods.some((x) => String(x || '').trim().toUpperCase() === up)) return false;
  } else {
    if (m.method && String(m.method).trim()) {
      if (String(req.method || 'GET').toUpperCase() !== String(m.method).trim().toUpperCase()) return false;
    }
    if (m.methodRegex && String(m.methodRegex).trim()) {
      try {
        if (!new RegExp(String(m.methodRegex).trim(), 'i').test(String(req.method || 'GET'))) return false;
      } catch {
        return false;
      }
    }
  }
  if (m.pathContains && String(m.pathContains).trim()) {
    const hay = getSearchString(pathNoQuery, rawUrl);
    if (!hay.includes(String(m.pathContains))) return false;
  }
  if (m.pathRegex && String(m.pathRegex).trim()) {
    const hay = getSearchString(pathNoQuery, rawUrl);
    try {
      if (!new RegExp(String(m.pathRegex).trim(), 's').test(hay)) return false;
    } catch {
      return false;
    }
  }
  if (Array.isArray(m.headers)) {
    for (const rule of m.headers) {
      if (!rule || !String(rule.name || '').trim()) continue;
      const val = getHeaderInsensitive(req.headers, rule.name);
      if (rule.equals !== undefined && rule.equals !== null && String(rule.equals).length > 0) {
        if (String(val) !== String(rule.equals)) return false;
      } else if (rule.matches !== undefined && rule.matches !== null && String(rule.matches).trim()) {
        try {
          if (!new RegExp(String(rule.matches).trim()).test(String(val ?? ''))) return false;
        } catch {
          return false;
        }
      } else if (rule.contains !== undefined && rule.contains !== null && String(rule.contains).length > 0) {
        if (!String(val).includes(String(rule.contains))) return false;
      } else {
        if (!val || !String(val).trim()) return false;
      }
    }
  }
  if (m.bodyContains != null && String(m.bodyContains).length > 0) {
    const b = capturedBody == null ? '' : String(capturedBody);
    if (!b.includes(String(m.bodyContains))) return false;
  }
  if (m.bodyRegex && String(m.bodyRegex).trim()) {
    try {
      if (!new RegExp(String(m.bodyRegex), 's').test(String(capturedBody || ''))) return false;
    } catch {
      return false;
    }
  }
  if (Array.isArray(m.queryParams)) {
    let u;
    try {
      u = new URL(rawUrl || '/', 'http://internal');
    } catch {
      return false;
    }
    for (const p of m.queryParams) {
      if (!p || !String(p.name || '').trim()) continue;
      const rawVal = u.searchParams.get(p.name);
      if (p.valueRegex && String(p.valueRegex).trim()) {
        try {
          if (!new RegExp(String(p.valueRegex).trim()).test(String(rawVal ?? ''))) return false;
        } catch {
          return false;
        }
      } else if (rawVal !== String(p.value ?? '')) {
        return false;
      }
    }
  }
  if (m.bodyJsonPath && String(m.bodyJsonPath).trim()) {
    const json = parseRequestBodyJson(capturedBody);
    const got = getJsonPath(json, m.bodyJsonPath);
    if (m.bodyJsonEquals !== undefined && String(m.bodyJsonEquals).trim()) {
      let want;
      try {
        want = JSON.parse(String(m.bodyJsonEquals));
      } catch {
        return false;
      }
      if (JSON.stringify(got) !== JSON.stringify(want)) return false;
    } else if (m.bodyJsonMatches && String(m.bodyJsonMatches).trim()) {
      const s = got === undefined || got === null
        ? ''
        : (typeof got === 'object' ? JSON.stringify(got) : String(got));
      try {
        if (!new RegExp(String(m.bodyJsonMatches).trim()).test(s)) return false;
      } catch {
        return false;
      }
    } else if (got === undefined) {
      return false;
    }
  }
  return true;
}

/** Variants eligible for unpinned `/mock/<id>` resolution, in saved list order. */
function eligibleVariantsInOrder(entry) {
  const all = (entry.variants || []).filter((v) => v && v.id);
  const idsRaw = entry.activeVariantIds;
  if (!Array.isArray(idsRaw)) {
    return all;
  }
  if (idsRaw.length === 0) {
    return [];
  }
  const set = new Set(idsRaw.map(String));
  const picked = all.filter((v) => set.has(String(v.id)));
  return picked.length ? picked : all;
}

/**
 * @param {object} entry registry or standalone entry
 * @param {string|null} preferredVariantId from URL segment (explicit variant)
 */
function pickVariant(entry, preferredVariantId, req, pathNoQuery, rawUrl, capturedBody) {
  if (!entry || !Array.isArray(entry.variants) || entry.variants.length === 0) return null;
  if (preferredVariantId) {
    const hit = entry.variants.find((v) => v && v.id === preferredVariantId);
    if (hit) return hit;
  }
  const ordered = eligibleVariantsInOrder(entry);
  if (!ordered.length) return null;
  for (const v of ordered) {
    if (v && hasMatcherRules(v.matchOn) && variantMatchesRequest(v, req, pathNoQuery, rawUrl, capturedBody)) {
      return v;
    }
  }
  for (const v of ordered) {
    if (v && !hasMatcherRules(v.matchOn)) return v;
  }
  if (entry.activeVariantId) {
    const hit = ordered.find((x) => x && x.id === entry.activeVariantId);
    if (hit) return hit;
  }
  if (Array.isArray(entry.activeVariantIds) && entry.activeVariantIds.length > 0) {
    for (const id of entry.activeVariantIds) {
      const hit = ordered.find((x) => x && x.id === id);
      if (hit) return hit;
    }
  }
  return ordered[0];
}

function getHeaderInsensitive(headers, rawName) {
  const want = String(rawName || '').trim().toLowerCase();
  if (!want) return '';
  for (const [k, v] of Object.entries(headers || {})) {
    if (String(k).toLowerCase() === want) {
      return Array.isArray(v) ? v.join(', ') : String(v ?? '');
    }
  }
  return '';
}

function parseRequestBodyJson(bodyStr) {
  const s = bodyStr == null ? '' : String(bodyStr).trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Dot-separated path on a parsed JSON object/array (e.g. `user.token`, `items.0`). */
function getJsonPath(obj, rawPath) {
  const path = String(rawPath || '').trim();
  if (!path || obj == null || typeof obj !== 'object') return undefined;
  const parts = path.split('.').filter(Boolean);
  if (parts.length === 0) return undefined;
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * Replace `{{header.Name}}`, `{{headerJson.Name}}`, `{{body}}`, `{{bodyJson}}`,
 * `{{bodyJson.path.to.field}}` and `$uuid` using the incoming request. `headerJson` /
 * dotted `bodyJson` use JSON.stringify so you can embed them inside JSON
 * bodies without manual escaping.
 * Order matters: `{{bodyJson.x}}` before `{{bodyJson}}`, then `{{body}}`, etc.
 */
/**
 * @param {Record<string, unknown>} [cache] Values from response pipeline (DB + script steps), e.g. `{{cache.name}}`
 */
function expandCacheTemplates(str, cache) {
  if (typeof str !== 'string' || str.indexOf('{{cache.') === -1) return str;
  const c = cache || {};
  return str.replace(/\{\{cache\.([^}]+)\}\}/g, (_, rawPath) => {
    const v = getJsonPath(c, rawPath);
    if (v === undefined) return '';
    if (v === null) return 'null';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  });
}

function expandDynamicMockPlaceholders(str) {
  if (typeof str !== 'string' || str.indexOf('$') === -1) return str;
  // Postman-style dynamic placeholder support for generated ids.
  return str.replace(/\$uuid\b/g, () => crypto.randomUUID());
}

function expandMockResponseTemplates(str, req, capturedReqBody, cache) {
  if (typeof str !== 'string') return str;
  if (str.indexOf('{{') === -1 && str.indexOf('$uuid') === -1) return str;
  const bodyStr = capturedReqBody == null ? '' : String(capturedReqBody);
  let out = str;
  out = out.replace(/\{\{bodyJson\.([^}]+)\}\}/g, (_, rawPath) => {
    const json = parseRequestBodyJson(bodyStr);
    const v = getJsonPath(json, rawPath);
    return v === undefined ? 'null' : JSON.stringify(v);
  });
  out = out.replace(/\{\{bodyJson\}\}/g, () => JSON.stringify(bodyStr));
  out = out.replace(/\{\{body\}\}/g, () => bodyStr);
  out = out.replace(/\{\{headerJson\.([^}]+)\}\}/g, (_, rawName) => JSON.stringify(getHeaderInsensitive(req.headers, rawName)));
  out = out.replace(/\{\{header\.([^}]+)\}\}/g, (_, rawName) => getHeaderInsensitive(req.headers, rawName));
  out = expandCacheTemplates(out, cache);
  out = expandDynamicMockPlaceholders(out);
  return out;
}

function applyCorsHeaders(req, headers) {
  if (options.corsMode === 'off') return;
  const reqOrigin = req.headers.origin || '*';
  if (options.corsMode === 'all') {
    headers['Access-Control-Allow-Origin'] = reqOrigin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  } else if (options.corsMode === 'list' && Array.isArray(options.corsOrigins)) {
    if (options.corsOrigins.includes(reqOrigin)) {
      headers['Access-Control-Allow-Origin'] = reqOrigin;
      headers['Access-Control-Allow-Credentials'] = 'true';
    }
  }
}

function buildResponseHeaders(req, variant, capturedReqBody, cache) {
  const headers = {};
  if (Array.isArray(variant && variant.headers)) {
    for (const h of variant.headers) {
      if (!h || !h.key) continue;
      const rawVal = String(h.value ?? '');
      headers[String(h.key)] = expandMockResponseTemplates(rawVal, req, capturedReqBody, cache);
    }
  }
  if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = options.defaultContentType || 'application/json; charset=utf-8';
  }
  applyCorsHeaders(req, headers);
  return headers;
}

/**
 * @returns {Promise<Record<string, unknown>>}
 */
async function runResponseSteps(req, variant, capturedReqBody) {
  /** @type {Record<string, unknown>} */
  const cache = {};
  const steps = Array.isArray(variant.responseSteps) ? variant.responseSteps : [];
  const headerPairs = () => Object.entries(req.headers || {}).map(([k, v]) => [
    k,
    Array.isArray(v) ? v.join(', ') : String(v ?? ''),
  ]);
  for (const step of steps) {
    if (!step || !step.kind) continue;
    if (step.kind === 'db') {
      const id = String(step.connectionId || '').trim();
      const cmd = String(step.command || '').trim();
      if (!id || !cmd) continue;
      const conn = dbService.getConnectionByIdFromSettings(id);
      if (!conn) {
        throw new Error(`Unknown database connection: ${id}`);
      }
      const result = await dbService.query(conn, cmd);
      const assignTo = String(step.assignTo || '').trim();
      if (assignTo) {
        cache[assignTo] = result;
      }
    } else if (step.kind === 'script') {
      const code = String(step.script || '');
      if (!code.trim()) continue;
      const scriptCtx = {
        request: {
          method: String(req.method || 'GET'),
          url: String(req.url || '/'),
          headers: headerPairs(),
          body: capturedReqBody,
        },
        environment: {},
        globals: {},
        variables: {},
        session: {},
        mockCache: cache,
      };
      await scriptService.executeScript(code, scriptCtx);
    }
  }
  return cache;
}

async function writeResponse(req, res, variant, ctx) {
  const status = Number(variant && variant.statusCode) || 200;
  const statusText = variant && variant.statusText ? String(variant.statusText) : undefined;
  const capturedReqBody = ctx && ctx.capturedReqBody != null ? ctx.capturedReqBody : '';
  let cache = ctx && ctx.cache ? ctx.cache : {};
  if (Array.isArray(variant.responseSteps) && variant.responseSteps.length > 0) {
    try {
      cache = await runResponseSteps(req, variant, capturedReqBody);
    } catch (err) {
      logError('Mock response steps failed', err);
      const headers = { 'Content-Type': 'application/json; charset=utf-8' };
      applyCorsHeaders(req, headers);
      const errBody = JSON.stringify({
        error: 'Mock response steps failed',
        message: err && err.message ? String(err.message) : String(err),
      });
      res.writeHead(500, headers);
      res.end(errBody);
      recordHit({
        req,
        res: { status: 500, headers, body: errBody },
        matchedRequestId: ctx.matchedRequestId,
        matchedVariant: variant,
        matchedKind: ctx.matchedKind,
        startedAt: ctx.startedAt,
        capturedReqBody: ctx.capturedReqBody,
      });
      return;
    }
  }
  const headers = buildResponseHeaders(req, variant, capturedReqBody, cache);
  const rawBody = typeof (variant && variant.body) === 'string' ? variant.body : '';
  const contentTypeHeader = Object.entries(headers).find(([k]) => String(k).toLowerCase() === 'content-type');
  const contentType = String(contentTypeHeader?.[1] || '').toLowerCase();
  const isBinary = contentType.includes('application/octet-stream');
  let body = expandMockResponseTemplates(rawBody, req, capturedReqBody, cache);
  if (isBinary) {
    try {
      body = await fs.readFile(String(rawBody || '').trim());
    } catch (err) {
      const message = err && err.message ? String(err.message) : String(err);
      const errBody = JSON.stringify({ error: 'Binary response file not found', message, path: rawBody || '' });
      const errHeaders = { 'Content-Type': 'application/json; charset=utf-8' };
      applyCorsHeaders(req, errHeaders);
      res.writeHead(500, errHeaders);
      res.end(errBody);
      recordHit({
        req,
        res: { status: 500, headers: errHeaders, body: errBody },
        matchedRequestId: ctx.matchedRequestId,
        matchedVariant: variant,
        matchedKind: ctx.matchedKind,
        startedAt: ctx.startedAt,
        capturedReqBody: ctx.capturedReqBody,
      });
      return;
    }
  }
  if (statusText) res.statusMessage = statusText;
  res.writeHead(status, headers);
  res.end(body);

  recordHit({
    req,
    res: { status, headers, body },
    matchedRequestId: ctx.matchedRequestId,
    matchedVariant: variant,
    matchedKind: ctx.matchedKind,
    startedAt: ctx.startedAt,
    capturedReqBody: ctx.capturedReqBody,
  });
}

function recordHit({ req, res, matchedRequestId, matchedVariant, matchedKind, startedAt, capturedReqBody }) {
  const reqHeaders = Object.entries(req.headers || {}).map(([k, v]) => ({
    key: k,
    value: Array.isArray(v) ? v.join(', ') : String(v ?? ''),
  }));
  const resHeaders = Object.entries(res.headers || {}).map(([k, v]) => ({
    key: k,
    value: Array.isArray(v) ? v.join(', ') : String(v ?? ''),
  }));
  queueHit({
    id: crypto.randomUUID(),
    receivedAt: startedAt,
    method: String(req.method || 'GET'),
    path: String(req.url || '/'),
    matchedKind: matchedKind || 'none', 
    matchedRequestId: matchedRequestId || null,
    matchedVariantId: matchedVariant ? matchedVariant.id || null : null,
    matchedVariantName: matchedVariant ? matchedVariant.name || null : null,
    status: Number(res.status) || 0,
    latencyMs: Math.max(0, Date.now() - startedAt),
    reqHeaders,
    reqBody: options.captureBodies ? truncate(capturedReqBody) : null,
    resHeaders,
    resBody: options.captureBodies ? truncate(res.body) : null,
  });
}

function truncate(body) {
  if (typeof body !== 'string') return null;
  if (Buffer.byteLength(body) <= MAX_BODY_BYTES) return body;
  return `${body.slice(0, MAX_BODY_BYTES)}\n…[truncated]`;
}

function readRequestBody(req) {
  return new Promise((resolve) => {
    /** Always read up to MAX_BODY_BYTES so matchers and response templates can use the body. */
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(Buffer.concat(chunks).toString('utf8'));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

async function handleRequest(req, res) {
  const startedAt = Date.now();
  const method = String(req.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    const headers = {
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };
    applyCorsHeaders(req, headers);
    res.writeHead(204, headers);
    res.end();
    return;
  }

  const capturedReqBody = await readRequestBody(req);

  const pathNoQuery = normalizePath((req.url || '/').split('?')[0]);
  const standaloneKey = `${method}:${pathNoQuery}`;
  let standaloneEntry = standalone.get(standaloneKey);
  if (!standaloneEntry) {
    standaloneEntry = findWildcardStandalone(method, pathNoQuery);
  }
  if (standaloneEntry) {
    const variant = pickVariant(standaloneEntry, null, req, pathNoQuery, req.url || '/', capturedReqBody);
    if (variant) {
      const delay = Math.max(0, Math.min(Number(variant.delayMs) || options.defaultDelayMs || 0, 30000));
      const send = async () => {
        await writeResponse(req, res, variant, {
          matchedRequestId: standaloneEntry.id,
          matchedKind: 'standalone',
          startedAt,
          capturedReqBody,
        });
      };
      if (delay > 0) setTimeout(() => { void send(); }, delay);
      else void send();
      return;
    }
  }

  const parsed = parseRequestPath(req.url || '/');
  if (!parsed) {
    const headers = { 'Content-Type': 'application/json; charset=utf-8' };
    applyCorsHeaders(req, headers);
    const body = JSON.stringify({ error: 'Mock route not found', expected: '/mock/<requestId>[/<variantId>]' });
    res.writeHead(404, headers);
    res.end(body);
    recordHit({
      req,
      res: { status: 404, headers, body },
      matchedRequestId: null,
      matchedVariant: null,
      matchedKind: 'none',
      startedAt,
      capturedReqBody,
    });
    return;
  }
  const entry = registry.get(parsed.requestId);
  const variant = pickVariant(entry, parsed.variantId, req, pathNoQuery, req.url || '/', capturedReqBody);
  if (!variant) {
    const headers = { 'Content-Type': 'application/json; charset=utf-8' };
    applyCorsHeaders(req, headers);
    const body = JSON.stringify({ error: 'No mock variant registered', requestId: parsed.requestId });
    res.writeHead(404, headers);
    res.end(body);
    recordHit({
      req,
      res: { status: 404, headers, body },
      matchedRequestId: parsed.requestId,
      matchedVariant: null,
      matchedKind: 'none',
      startedAt,
      capturedReqBody,
    });
    return;
  }
  const delay = Math.max(0, Math.min(Number(variant.delayMs) || options.defaultDelayMs || 0, 30000));
  const send = async () => {
    await writeResponse(req, res, variant, {
      matchedRequestId: parsed.requestId,
      matchedKind: 'request',
      startedAt,
      capturedReqBody,
    });
  };
  if (delay > 0) setTimeout(() => { void send(); }, delay);
  else void send();
}

function start(portOverride) {
  if (state.status === 'running' || state.status === 'starting') {
    return Promise.resolve(getStatus());
  }
  state = { ...state, status: 'starting', error: null };
  return new Promise((resolve, reject) => {
    try {
      const desiredPort = Number(portOverride ?? options.port) || 0;
      const bind = options.bindAddress || '127.0.0.1';
      server = http.createServer(handleRequest);

      const onListenError = (err) => {
        const msg = String(err && err.message ? err.message : err);
        state = { ...state, status: 'error', error: msg };
        logError('Mock server listen error', err);
        try {
          server.close();
        } catch {
          /* ignore */
        }
        server = null;
        reject(err);
      };

      server.once('error', onListenError);
      server.listen(desiredPort, bind, () => {
        server.removeListener('error', onListenError);
        server.on('error', (err) => {
          state = { ...state, status: 'error', error: String(err && err.message ? err.message : err) };
          logError('Mock server error', err);
        });
        const addr = server.address();
        state = {
          host: bind,
          port: addr && typeof addr === 'object' ? addr.port : desiredPort,
          status: 'running',
          error: null,
        };
        logInfo('Mock server started', { port: state.port, bind });
        resolve(getStatus());
      });
    } catch (err) {
      state = { ...state, status: 'error', error: String(err && err.message || err) };
      reject(err);
    }
  });
}

function stop() {
  return new Promise((resolve) => {
    flushBatch();
    if (!server) {
      state = { ...state, status: 'stopped', error: null };
      resolve(getStatus());
      return;
    }
    server.close(() => {
      server = null;
      state = { ...state, status: 'stopped', error: null };
      resolve(getStatus());
    });
  });
}

async function restart() {
  if (state.status === 'running' || state.status === 'starting') {
    await stop();
  }
  return start();
}

function setOptions(partial) {
  if (!partial || typeof partial !== 'object') return { ...options };
  const next = { ...options };
  if ('port' in partial) next.port = partial.port == null ? null : Number(partial.port) || null;
  if ('bindAddress' in partial && (partial.bindAddress === '127.0.0.1' || partial.bindAddress === '0.0.0.0')) {
    next.bindAddress = partial.bindAddress;
  }
  if ('defaultDelayMs' in partial) next.defaultDelayMs = Math.max(0, Number(partial.defaultDelayMs) || 0);
  if ('defaultContentType' in partial && typeof partial.defaultContentType === 'string') {
    next.defaultContentType = partial.defaultContentType;
  }
  if ('corsMode' in partial && ['off', 'all', 'list'].includes(partial.corsMode)) {
    next.corsMode = partial.corsMode;
  }
  if ('corsOrigins' in partial && Array.isArray(partial.corsOrigins)) {
    next.corsOrigins = partial.corsOrigins.map(String);
  }
  if ('autoStart' in partial) next.autoStart = !!partial.autoStart;
  if ('captureBodies' in partial) next.captureBodies = !!partial.captureBodies;
  options = next;
  return { ...options };
}

function getOptions() {
  return { ...options };
}

function registerVariants(requestId, variants, activeVariantId, activeVariantIds) {
  if (!requestId) return;
  if (!Array.isArray(variants) || variants.length === 0) {
    registry.delete(requestId);
    return;
  }
  const normalizedIds = Array.isArray(activeVariantIds) ? activeVariantIds.map(String) : null;
  registry.set(requestId, {
    variants: variants.map((v) => ({
      id: String(v.id || ''),
      name: String(v.name || ''),
      statusCode: Number(v.statusCode) || 200,
      statusText: v.statusText,
      headers: Array.isArray(v.headers) ? v.headers : [],
      body: typeof v.body === 'string' ? v.body : '',
      delayMs: Number(v.delayMs) || 0,
      matchOn: v.matchOn,
      responseSteps: Array.isArray(v.responseSteps) ? v.responseSteps : [],
    })),
    activeVariantId: activeVariantId || null,
    activeVariantIds: normalizedIds,
  });
}

function unregister(requestId) {
  if (requestId) registry.delete(requestId);
}

function clearAll() {
  registry.clear();
  standalone.clear();
  standaloneWildcards.length = 0;
}

function registerStandalone(endpoint) {
  if (!endpoint || !endpoint.method || !endpoint.path) return null;
  const id = endpoint.id || crypto.randomUUID();
  const method = String(endpoint.method).toUpperCase();
  const path = normalizePath(endpoint.path.split('?')[0]);
  for (const [key, value] of standalone.entries()) {
    if (value.id === id) standalone.delete(key);
  }
  removeWildcardById(id);
  const wild = parsePathWildcard(endpoint.path);
  const variants = Array.isArray(endpoint.variants) ? endpoint.variants : [];
  const rawName = typeof endpoint.name === 'string' ? String(endpoint.name).trim() : '';
  const name = rawName.slice(0, 200);
  const value = {
    id,
    name,
    method,
    path: String(endpoint.path).trim() || path,
    variants: variants.map((v) => ({
      id: String(v.id || crypto.randomUUID()),
      name: String(v.name || ''),
      statusCode: Number(v.statusCode) || 200,
      statusText: v.statusText,
      headers: Array.isArray(v.headers) ? v.headers : [],
      body: typeof v.body === 'string' ? v.body : '',
      delayMs: Number(v.delayMs) || 0,
      matchOn: v.matchOn,
      responseSteps: Array.isArray(v.responseSteps) ? v.responseSteps : [],
    })),
    activeVariantId: endpoint.activeVariantId || null,
    activeVariantIds: Array.isArray(endpoint.activeVariantIds) ? endpoint.activeVariantIds.map(String) : null,
  };
  if (wild && wild.basePath) {
    Object.assign(value, {
      pathMode: wild.pathMode,
      basePath: wild.basePath,
    });
    standaloneWildcards.push(value);
    return value;
  }
  const exactPath = path;
  standalone.set(`${method}:${exactPath}`, { ...value, path: exactPath });
  return standalone.get(`${method}:${exactPath}`);
}

function unregisterStandalone(id) {
  for (const [key, value] of standalone.entries()) {
    if (value.id === id) { standalone.delete(key); return true; }
  }
  const before = standaloneWildcards.length;
  removeWildcardById(id);
  return standaloneWildcards.length < before;
}

function listStandalone() {
  return [
    ...Array.from(standalone.values()).map((e) => ({ ...e })),
    ...standaloneWildcards.map((e) => ({ ...e })),
  ];
}

function listHits() {
  return hits.slice();
}

function clearHits() {
  hits.length = 0;
}

module.exports = {
  start,
  stop,
  restart,
  getStatus,
  getOptions,
  setOptions,
  registerVariants,
  unregister,
  clearAll,
  registerStandalone,
  unregisterStandalone,
  listStandalone,
  listHits,
  clearHits,
  setHitBroadcaster,
};
