const vm = require('node:vm');
const url = require('node:url');
const crypto = require('node:crypto');
const util = require('node:util');
const { logInfo, logError } = require('./logger.service');

const SCRIPT_TIMEOUT_MS = 30_000;

/**
 * Optional dependency injected by `init()` — the HTTP handler that
 * `pm.sendRequest()` delegates to. Kept as a module-level variable so we can
 * avoid a circular require between `script.service` and `http.service`.
 * @type {((req: any) => Promise<any>) | null}
 */
let httpHandler = null;

function init({ httpRequest }) {
  httpHandler = typeof httpRequest === 'function' ? httpRequest : null;
}

/**
 * Execute a user script in a sandboxed VM with a Postman-compatible `pm.*`
 * surface. Because the script runs in the main process, it cannot call back
 * into renderer services; instead it accumulates side-effects (env changes,
 * test results, logs) which are returned to the renderer as structured data.
 *
 * The `context` argument is a plain JSON object produced by the renderer:
 *
 *   {
 *     environment: { [key: string]: string },
 *     globals:     { [key: string]: string },
 *     request: { method, url, headers: [[k, v]], body },
 *     response: { code, status, headers: [[k, v]], body, responseTime, size } | null
 *   }
 *
 * The returned value has this shape:
 *
 *   {
 *     value: <last expression>,          // whatever the script evaluated to
 *     testResults: [{ name, passed, message, durationMs }],
 *     envChanges:   [{ op: 'set'|'unset', key, value? }],
 *     varChanges:   [{ op, key, value? }],       // collectionVariables
 *     sessionChanges:[{ op, key, value? }],      // pm.session (app session store)
 *     globalChanges:[{ op, key, value? }],
 *     consoleLogs:  [{ level, args: string[] }],
 *     errors:       [{ message, stack? }]        // uncaught errors (non-test)
 *   }
 */
async function executeScript(code, context = {}) {
  const env = { ...(context.environment || {}) };
  const globals = { ...(context.globals || {}) };
  const vars = { ...(context.variables || {}) };
  const session = { ...(context.session || {}) };

  const envChanges = [];
  const varChanges = [];
  const sessionChanges = [];
  const globalChanges = [];
  const testResults = [];
  const consoleLogs = [];
  const errors = [];

  const recordEnv = (op, key, value) => envChanges.push({ op, key, value });
  const recordVar = (op, key, value) => varChanges.push({ op, key, value });
  const recordSession = (op, key, value) => sessionChanges.push({ op, key, value });
  const recordGlobal = (op, key, value) => globalChanges.push({ op, key, value });

  const makeScope = (store, record) => ({
    get: (key) => store[key],
    set: (key, value) => {
      const v = String(value);
      store[key] = v;
      record('set', key, v);
    },
    unset: (key) => {
      delete store[key];
      record('unset', key);
    },
    has: (key) => Object.prototype.hasOwnProperty.call(store, key),
    toObject: () => ({ ...store }),
  });

  const pushLog = (level) => (...args) => {
    const serialized = args.map(a => safeStringify(a));
    consoleLogs.push({ level, args: serialized });
    (level === 'error' ? logError : logInfo)('Script:', ...serialized);
  };
  const sandboxConsole = Object.freeze({
    log: pushLog('log'),
    info: pushLog('info'),
    warn: pushLog('warn'),
    error: pushLog('error'),
    debug: pushLog('debug'),
  });

  const pmResponse = buildPmResponse(context.response);
  const pmRequest = buildPmRequest(context.request);

  const varScope = makeScope(vars, recordVar);
  const sessionScope = makeScope(session, recordSession);

  const pm = {
    environment: makeScope(env, recordEnv),
    variables: varScope,
    /** Postman alias — same backing store as `pm.variables`. */
    collectionVariables: varScope,
    session: sessionScope,
    globals:     makeScope(globals, recordGlobal),
    response: pmResponse,
    request: pmRequest,
    test: (name, fn) => {
      const start = Date.now();
      try {
        const result = fn();
        if (result && typeof result.then === 'function') {
          return result.then(
            () => testResults.push({ name: String(name), passed: true, durationMs: Date.now() - start }),
            (err) => testResults.push({
              name: String(name),
              passed: false,
              message: err && err.message ? err.message : String(err),
              durationMs: Date.now() - start,
            }),
          );
        }
        testResults.push({ name: String(name), passed: true, durationMs: Date.now() - start });
      } catch (err) {
        testResults.push({
          name: String(name),
          passed: false,
          message: err && err.message ? err.message : String(err),
          durationMs: Date.now() - start,
        });
      }
      return undefined;
    },
    expect: (actual) => makeExpectation(actual),
    sendRequest: (reqOrUrl, callback) => sendRequestFromSandbox(reqOrUrl, callback),
  };

  const sandbox = {
    pm,
    expect: (actual) => makeExpectation(actual),
    client: context.client || {},
    url,
    crypto,
    util,
    console: sandboxConsole,
    Buffer: Buffer,
    setTimeout: undefined,
    setInterval: undefined,
  };

  /** Mock response pipeline: read/write `cache` between DB and script steps. */
  if (context.mockCache && typeof context.mockCache === 'object') {
    sandbox.cache = context.mockCache;
  }

  let value;
  try {
    logInfo('Executing user script (node:vm)');
    const wrapped = `(async () => {\n${code}\n})()`;
    const script = new vm.Script(wrapped, { filename: 'script.js' });
    const ctx = vm.createContext(sandbox);
    const maybePromise = script.runInContext(ctx, { timeout: SCRIPT_TIMEOUT_MS });
    value = await Promise.resolve(maybePromise);
  } catch (err) {
    logError('Script execution failed', err);
    errors.push({ message: err && err.message ? err.message : String(err), stack: err && err.stack });
  }

  return {
    value: safeValue(value),
    testResults,
    envChanges,
    varChanges,
    sessionChanges,
    globalChanges,
    consoleLogs,
    errors,
  };
}

function buildPmResponse(response) {
  if (!response) return null;
  const headers = response.headers || [];
  const headerPairs = Array.isArray(headers) ? headers : [];
  const findHeader = (name) => {
    const needle = String(name).toLowerCase();
    const hit = headerPairs.find(pair => String((pair && pair[0]) || '').toLowerCase() === needle);
    return hit ? hit[1] : undefined;
  };
  return {
    code: response.code,
    status: response.status,
    responseTime: response.responseTime,
    responseSize: response.size,
    headers: {
      get: findHeader,
      has: (name) => findHeader(name) !== undefined,
      all: () => headerPairs.map(([k, v]) => ({ key: k, value: v })),
    },
    text: () => response.body == null ? '' : String(response.body),
    json: () => {
      try { return JSON.parse(response.body || '{}'); }
      catch (err) { throw new Error(`pm.response.json(): ${err.message}`); }
    },
    to: {
      have: {
        status: (expected) => {
          if (response.code !== expected) {
            throw new Error(`expected status ${expected} but got ${response.code}`);
          }
        },
        header: (name) => {
          if (findHeader(name) === undefined) {
            throw new Error(`expected response to have header "${name}"`);
          }
        },
        body: (expected) => {
          const body = response.body == null ? '' : String(response.body);
          if (expected instanceof RegExp) {
            if (!expected.test(body)) throw new Error(`body did not match ${expected}`);
          } else if (!body.includes(String(expected))) {
            throw new Error(`body did not include "${expected}"`);
          }
        },
      },
      be: {
        ok: () => {
          if (!(response.code >= 200 && response.code < 300)) {
            throw new Error(`expected response to be ok (2xx), got ${response.code}`);
          }
        },
      },
    },
  };
}

function buildPmRequest(request) {
  if (!request) return null;
  const headers = Array.isArray(request.headers) ? request.headers : [];
  return {
    method: request.method,
    url: { toString: () => String(request.url || ''), raw: request.url || '' },
    headers: {
      get: (name) => {
        const needle = String(name).toLowerCase();
        const hit = headers.find(pair => String((pair && pair[0]) || '').toLowerCase() === needle);
        return hit ? hit[1] : undefined;
      },
      all: () => headers.map(([k, v]) => ({ key: k, value: v })),
    },
    body: request.body,
  };
}

/**
 * A tiny chai-compatible BDD assertion chain. Enough to run the vast majority
 * of Postman tests without pulling in actual chai.
 */
function makeExpectation(actual) {
  const negated = { value: false };

  const assert = (cond, message) => {
    const pass = negated.value ? !cond : cond;
    if (!pass) throw new Error(`expected ${repr(actual)} ${negated.value ? 'not ' : ''}${message}`);
  };

  const chain = {};

  Object.defineProperty(chain, 'not', {
    get() { negated.value = !negated.value; return chain; },
  });
  Object.defineProperty(chain, 'to', { get() { return chain; } });
  Object.defineProperty(chain, 'be', { get() { return chain; } });
  Object.defineProperty(chain, 'have', { get() { return chain; } });
  Object.defineProperty(chain, 'a', { get() { return (type) => {
    assert(typeof actual === type, `to be a ${type}`); return chain;
  }; } });
  Object.defineProperty(chain, 'an', { get() { return (type) => {
    assert(typeof actual === type, `to be an ${type}`); return chain;
  }; } });

  chain.equal = (expected) => {
    assert(actual === expected, `to equal ${repr(expected)}`);
    return chain;
  };
  chain.eql = (expected) => {
    assert(deepEqual(actual, expected), `to deep-equal ${repr(expected)}`);
    return chain;
  };
  chain.deep = {
    equal: (expected) => {
      assert(deepEqual(actual, expected), `to deep-equal ${repr(expected)}`);
      return chain;
    },
  };
  chain.include = (expected) => {
    if (Array.isArray(actual)) {
      assert(actual.includes(expected), `to include ${repr(expected)}`);
    } else if (actual && typeof actual === 'object') {
      const ok = Object.entries(expected).every(([k, v]) => deepEqual(actual[k], v));
      assert(ok, `to include ${repr(expected)}`);
    } else {
      assert(String(actual).includes(String(expected)), `to include ${repr(expected)}`);
    }
    return chain;
  };
  chain.match = (regex) => {
    assert(regex.test(String(actual)), `to match ${repr(regex)}`);
    return chain;
  };
  chain.lengthOf = (n) => {
    assert(actual != null && actual.length === n, `to have length ${n}`);
    return chain;
  };
  chain.above = (n) => {
    assert(actual > n, `to be above ${n}`);
    return chain;
  };
  chain.below = (n) => {
    assert(actual < n, `to be below ${n}`);
    return chain;
  };
  chain.exist = chain;
  Object.defineProperty(chain, 'ok', {
    get() { assert(Boolean(actual), 'to be ok'); return chain; },
  });
  Object.defineProperty(chain, 'true', {
    get() { assert(actual === true, 'to be true'); return chain; },
  });
  Object.defineProperty(chain, 'false', {
    get() { assert(actual === false, 'to be false'); return chain; },
  });
  Object.defineProperty(chain, 'null', {
    get() { assert(actual === null, 'to be null'); return chain; },
  });
  Object.defineProperty(chain, 'undefined', {
    get() { assert(actual === undefined, 'to be undefined'); return chain; },
  });
  chain.status = (expected) => {
    const code = actual && typeof actual === 'object' ? actual.code : actual;
    assert(code === expected, `to have status ${expected}`);
    return chain;
  };
  return chain;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  if (ak.length !== bk.length) return false;
  return ak.every((k, i) => k === bk[i] && deepEqual(a[k], b[k]));
}

function repr(value) {
  try { return JSON.stringify(value); } catch { return String(value); }
}

function safeValue(value) {
  if (value === undefined) return undefined;
  try { return JSON.parse(JSON.stringify(value)); }
  catch { return String(value); }
}

function safeStringify(value) {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return util.inspect(value, { depth: 2 }); }
}

/**
 * Implementation of `pm.sendRequest(request, callback)` and its Promise
 * variant. Accepts either a URL string or a Postman-shaped request object
 * (`{ url, method, header, body }`). Resolves with a sandbox-friendly
 * response object the user can pass through `pm.expect` / `pm.response`.
 */
function sendRequestFromSandbox(reqOrUrl, callback) {
  const normalized = normalizeSandboxRequest(reqOrUrl);
  if (!httpHandler) {
    const err = new Error('pm.sendRequest is unavailable (HTTP handler not initialized)');
    if (typeof callback === 'function') { callback(err); return Promise.reject(err); }
    return Promise.reject(err);
  }

  const promise = httpHandler(normalized).then(
    (raw) => toSandboxResponse(raw),
    (err) => { throw err; },
  );

  if (typeof callback === 'function') {
    promise.then(
      (res) => { try { callback(null, res); } catch (cbErr) { logError('pm.sendRequest callback threw', cbErr); } },
      (err) => { try { callback(err); } catch (cbErr) { logError('pm.sendRequest callback threw', cbErr); } },
    );
  }
  return promise;
}

function normalizeSandboxRequest(reqOrUrl) {
  if (typeof reqOrUrl === 'string') {
    return {
      url: reqOrUrl,
      method: 'GET',
      headers: [],
      body: '',
      settings: {},
    };
  }
  const r = reqOrUrl || {};
  const method = String(r.method || 'GET').toUpperCase();
  const headerSource = r.header || r.headers || [];
  const headers = Array.isArray(headerSource)
    ? headerSource.map(h => ({ key: h.key || h.name, value: h.value }))
        .filter(h => h.key)
    : Object.entries(headerSource).map(([key, value]) => ({ key, value }));

  let body = '';
  if (r.body) {
    if (typeof r.body === 'string') body = r.body;
    else if (r.body.mode === 'raw') body = r.body.raw || '';
    else body = r.body;
  }

  return {
    url: r.url && typeof r.url === 'object' ? (r.url.raw || r.url.toString()) : (r.url || ''),
    method,
    headers,
    body,
    settings: r.settings || {},
  };
}

function toSandboxResponse(raw) {
  if (!raw) return null;
  const headerPairs = Array.isArray(raw.headers)
    ? raw.headers.map(h => [h.key ?? '', String(h.value ?? '')])
    : Object.entries(raw.headers || {}).map(([k, v]) => [k, String(v)]);

  const body = typeof raw.body === 'string' ? raw.body : safeStringify(raw.body);
  return {
    code: raw.status ?? raw.statusCode ?? 0,
    status: raw.statusText ?? '',
    responseTime: raw.timeMs,
    responseSize: raw.size,
    headers: {
      get: (name) => {
        const needle = String(name).toLowerCase();
        const hit = headerPairs.find(([k]) => String(k).toLowerCase() === needle);
        return hit ? hit[1] : undefined;
      },
      all: () => headerPairs.map(([k, v]) => ({ key: k, value: v })),
    },
    text: () => body,
    json: () => {
      try { return JSON.parse(body || '{}'); }
      catch (err) { throw new Error(`response.json(): ${err.message}`); }
    },
  };
}

module.exports = { executeScript, init };
