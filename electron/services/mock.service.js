const http = require('http');
const crypto = require('crypto');
const { logInfo, logError } = require('./logger.service');

/**
 * Lightweight local mock server. Variants are registered by request id and
 * served under `/mock/:requestId[/:variantId]`. Standalone endpoints can also
 * be registered by `${method}:${path}` for mocks that aren't bound to a saved
 * request (e.g. quick `/healthz`).
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
    })),
    standalone: [
      ...Array.from(standalone.values()).map((e) => ({
        id: e.id,
        name: e.name || '',
        method: e.method,
        path: e.path,
        variantCount: e.variants.length,
        activeVariantId: e.activeVariantId || null,
      })),
      ...standaloneWildcards.map((e) => ({
        id: e.id,
        name: e.name || '',
        method: e.method,
        path: e.path,
        variantCount: e.variants.length,
        activeVariantId: e.activeVariantId || null,
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

function pickVariant(entry, preferredVariantId) {
  if (!entry || !Array.isArray(entry.variants) || entry.variants.length === 0) return null;
  if (preferredVariantId) {
    const hit = entry.variants.find((v) => v && v.id === preferredVariantId);
    if (hit) return hit;
  }
  if (entry.activeVariantId) {
    const hit = entry.variants.find((v) => v && v.id === entry.activeVariantId);
    if (hit) return hit;
  }
  return entry.variants[0];
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

function buildResponseHeaders(req, variant) {
  const headers = {};
  if (Array.isArray(variant && variant.headers)) {
    for (const h of variant.headers) {
      if (!h || !h.key) continue;
      headers[String(h.key)] = String(h.value ?? '');
    }
  }
  if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = options.defaultContentType || 'application/json; charset=utf-8';
  }
  applyCorsHeaders(req, headers);
  return headers;
}

function writeResponse(req, res, variant, ctx) {
  const status = Number(variant && variant.statusCode) || 200;
  const statusText = variant && variant.statusText ? String(variant.statusText) : undefined;
  const headers = buildResponseHeaders(req, variant);
  const body = typeof (variant && variant.body) === 'string' ? variant.body : '';
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
    if (!options.captureBodies) { resolve(null); return; }
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
    const variant = pickVariant(standaloneEntry, null);
    if (variant) {
      const delay = Math.max(0, Math.min(Number(variant.delayMs) || options.defaultDelayMs || 0, 30000));
      const send = () => writeResponse(req, res, variant, {
        matchedRequestId: standaloneEntry.id,
        matchedKind: 'standalone',
        startedAt,
        capturedReqBody,
      });
      if (delay > 0) setTimeout(send, delay); else send();
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
  const variant = pickVariant(entry, parsed.variantId);
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
  const send = () => writeResponse(req, res, variant, {
    matchedRequestId: parsed.requestId,
    matchedKind: 'request',
    startedAt,
    capturedReqBody,
  });
  if (delay > 0) setTimeout(send, delay); else send();
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
      server.on('error', (err) => {
        state = { ...state, status: 'error', error: String(err && err.message || err) };
        logError('Mock server error', err);
      });
      server.listen(desiredPort, bind, () => {
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

function registerVariants(requestId, variants, activeVariantId) {
  if (!requestId) return;
  if (!Array.isArray(variants) || variants.length === 0) {
    registry.delete(requestId);
    return;
  }
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
    })),
    activeVariantId: activeVariantId || null,
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
    })),
    activeVariantId: endpoint.activeVariantId || null,
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
