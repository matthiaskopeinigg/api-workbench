const { BrowserWindow, session } = require('electron');
const { randomUUID } = require('crypto');
const path = require('path');
const { getMainWindow } = require('./window.service');
const { logError, logInfo } = require('./logger.service');

const MAX_ENTRIES = 400;
/**
 * Match all URL schemes; we drop noise in `shouldIgnoreUrl` / `shouldCaptureRequest`.
 * (Electron's WebRequest no longer documents `filterResponseData`; body capture is not
 * available via webRequest alone in supported APIs.)
 */
const CAPTURE_FILTER = { urls: ['<all_urls>'] };

/** Max UTF-8 / raw bytes stored per request body (from `uploadData`). */
const MAX_REQUEST_BODY = 64 * 1024;

/** @typedef {{ id: string; runId: string; method: string; url: string; resourceType?: string; requestHeaders: Array<{ key: string; value: string }>; responseHeaders: Array<{ key: string; value: string }>; statusCode: number | null; statusLine?: string; timeMs: number | null; body: string; bodyTruncated: boolean; bodyIsBinary: boolean; requestBody: string; requestBodyTruncated: boolean; requestBodyIsBinary: boolean; startedAt: number; completedAt?: number }} CaptureEntry */

let captureWindow = null;
let captureSession = null;
/** @type {string | null} */
let activeRunId = null;
/** @type {string | null} */
let activeInitialUrl = null;

/** @type {CaptureEntry[]} */
let entries = [];

/**
 * Per-request data collected before `onCompleted` / `onErrorOccurred`.
 * @typedef {{ startedAt: number; requestHeaders: Array<{ key: string; value: string }>; url: string; method: string; resourceType?: string; requestBody: string; requestBodyTruncated: boolean; requestBodyIsBinary: boolean }} RequestMeta
 */
/** @type {Map<number, RequestMeta>} */
const requestMetaById = new Map();

function broadcastToMain(channel, payload) {
  const main = getMainWindow();
  const targets = [];
  if (main && !main.isDestroyed()) {
    targets.push(main);
  } else {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win || win.isDestroyed()) continue;
      if (captureWindow && win === captureWindow) continue;
      targets.push(win);
    }
  }
  for (const win of targets) {
    try {
      win.webContents.send(channel, payload);
    } catch (e) {
      logError('capture broadcast failed', e);
    }
  }
}

function shouldIgnoreUrl(url) {
  if (!url || typeof url !== 'string') return true;
  const u = url.toLowerCase();
  if (u.startsWith('devtools:')) return true;
  if (u.startsWith('chrome-extension:')) return true;
  if (u.startsWith('chrome:')) return true;
  if (u.startsWith('about:')) return true;
  if (u.startsWith('blob:')) return true;
  if (u.startsWith('data:')) return true;
  return false;
}

function shouldCaptureRequest(details) {
  if (shouldIgnoreUrl(details.url)) return false;
  if (details.resourceType === 'webSocket') return false;
  const u = (details.url || '').toLowerCase();
  if (!(u.startsWith('http://') || u.startsWith('https://'))) return false;
  return true;
}

function redactHeaders(headersObj) {
  if (!headersObj || typeof headersObj !== 'object') return [];
  const sensitive = new Set(['authorization', 'cookie', 'set-cookie']);
  return Object.entries(headersObj).map(([key, value]) => {
    const lower = key.toLowerCase();
    const raw = Array.isArray(value) ? value.join(', ') : String(value ?? '');
    if (sensitive.has(lower)) {
      return { key, value: '[redacted]' };
    }
    return { key, value: raw };
  });
}

/** @param {Record<string, string[] | string> | undefined} rh */
function headersRecordToPairs(rh) {
  if (!rh || typeof rh !== 'object') return [];
  const out = [];
  for (const [key, value] of Object.entries(rh)) {
    const raw = Array.isArray(value) ? value.join('\n') : String(value ?? '');
    out.push({ key, value: raw });
  }
  return out;
}

/**
 * @param {import('electron').UploadData[] | undefined} uploadData
 * @returns {{ text: string; truncated: boolean; isBinary: boolean }}
 */
function parseCaptureRequestBody(uploadData) {
  if (!uploadData || !Array.isArray(uploadData) || uploadData.length === 0) {
    return { text: '', truncated: false, isBinary: false };
  }
  const chunks = [];
  for (let i = 0; i < uploadData.length; i++) {
    const part = uploadData[i];
    if (part && part.file) {
      try {
        const name = path.basename(String(part.file));
        return { text: `[upload file: ${name}]`, truncated: false, isBinary: false };
      } catch {
        return { text: '[upload file]', truncated: false, isBinary: false };
      }
    }
    if (part && part.bytes != null) {
      const buf = Buffer.isBuffer(part.bytes) ? part.bytes : Buffer.from(part.bytes);
      chunks.push(buf);
    }
  }
  if (chunks.length === 0) {
    return { text: '', truncated: false, isBinary: false };
  }
  let combined = Buffer.concat(chunks);
  let truncated = false;
  if (combined.length > MAX_REQUEST_BODY) {
    combined = combined.subarray(0, MAX_REQUEST_BODY);
    truncated = true;
  }
  if (combined.length === 0) {
    return { text: '', truncated: false, isBinary: false };
  }
  if (combined.indexOf(0) !== -1) {
    return { text: combined.toString('base64'), truncated, isBinary: true };
  }
  return { text: combined.toString('utf8'), truncated, isBinary: false };
}

function pushEntry(entry) {
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(-MAX_ENTRIES);
  }
  broadcastToMain('capture:entry', entry);
}

/** @param {object} details onCompleted listener details */
function recordCompleted(details) {
  if (!shouldCaptureRequest(details)) {
    requestMetaById.delete(details.id);
    return;
  }
  const meta = requestMetaById.get(details.id);
  requestMetaById.delete(details.id);
  const startedAt = meta?.startedAt ?? Date.now();
  const requestHeaders = meta?.requestHeaders ?? [];
  const responseHeaders = headersRecordToPairs(details.responseHeaders);
  const statusCode = typeof details.statusCode === 'number' ? details.statusCode : null;
  let timeMs = Math.max(0, Date.now() - startedAt);
  if (details.fromCache === true) {
    timeMs = 0;
  }
  /** @type {CaptureEntry} */
  const entry = {
    id: randomUUID(),
    runId: activeRunId || '',
    method: details.method || meta?.method || 'GET',
    url: details.url || meta?.url || '',
    resourceType: details.resourceType || meta?.resourceType,
    requestHeaders,
    responseHeaders,
    statusCode,
    statusLine: details.statusLine,
    timeMs,
    body: '',
    bodyTruncated: false,
    bodyIsBinary: false,
    requestBody: meta?.requestBody ?? '',
    requestBodyTruncated: meta?.requestBodyTruncated ?? false,
    requestBodyIsBinary: meta?.requestBodyIsBinary ?? false,
    startedAt,
    completedAt: Date.now(),
  };
  pushEntry(entry);
}

/** @param {object} details onErrorOccurred listener details */
function recordError(details) {
  if (!shouldCaptureRequest(details)) {
    requestMetaById.delete(details.id);
    return;
  }
  const meta = requestMetaById.get(details.id);
  requestMetaById.delete(details.id);
  const startedAt = meta?.startedAt ?? Date.now();
  const errText = details.error ? String(details.error) : 'Request failed';
  /** @type {CaptureEntry} */
  const entry = {
    id: randomUUID(),
    runId: activeRunId || '',
    method: details.method || meta?.method || 'GET',
    url: details.url || meta?.url || '',
    resourceType: details.resourceType || meta?.resourceType,
    requestHeaders: meta?.requestHeaders ?? [],
    responseHeaders: [],
    statusCode: null,
    statusLine: undefined,
    timeMs: Math.max(0, Date.now() - startedAt),
    body: `[net error] ${errText}`,
    bodyTruncated: false,
    bodyIsBinary: false,
    requestBody: meta?.requestBody ?? '',
    requestBodyTruncated: meta?.requestBodyTruncated ?? false,
    requestBodyIsBinary: meta?.requestBodyIsBinary ?? false,
    startedAt,
    completedAt: Date.now(),
  };
  pushEntry(entry);
}

function detachListeners() {
  if (!captureSession) return;
  try {
    captureSession.webRequest.onBeforeSendHeaders(null);
    captureSession.webRequest.onCompleted(null);
    captureSession.webRequest.onErrorOccurred(null);
  } catch (e) {
    logError('capture detach listeners', e);
  }
}

function attachListeners(sess) {
  sess.webRequest.onBeforeSendHeaders(CAPTURE_FILTER, (details, callback) => {
    try {
      if (shouldCaptureRequest(details) && details.requestHeaders) {
        const prev = requestMetaById.get(details.id);
        const startedAt = prev?.startedAt ?? Date.now();
        const rb = parseCaptureRequestBody(details.uploadData);
        requestMetaById.set(details.id, {
          startedAt,
          requestHeaders: redactHeaders(details.requestHeaders),
          url: details.url,
          method: details.method || 'GET',
          resourceType: details.resourceType,
          requestBody: rb.text,
          requestBodyTruncated: rb.truncated,
          requestBodyIsBinary: rb.isBinary,
        });
      }
    } catch (err) {
      logError('capture onBeforeSendHeaders', err);
    }
    callback({ requestHeaders: details.requestHeaders });
  });

  sess.webRequest.onCompleted(CAPTURE_FILTER, (details) => {
    try {
      recordCompleted(details);
    } catch (err) {
      logError('capture onCompleted', err);
    }
  });

  sess.webRequest.onErrorOccurred(CAPTURE_FILTER, (details) => {
    try {
      recordError(details);
    } catch (err) {
      logError('capture onErrorOccurred', err);
    }
  });
}

function stopWindow() {
  if (!captureWindow || captureWindow.isDestroyed()) {
    captureWindow = null;
    captureSession = null;
    requestMetaById.clear();
    return;
  }
  detachListeners();
  requestMetaById.clear();
  try {
    captureWindow.close();
  } catch {
    /* ignore */
  }
}

/**
 * @param {{ initialUrl?: string }} opts
 */
async function start(opts) {
  if (captureWindow && !captureWindow.isDestroyed()) {
    return { ok: false, error: 'Capture already running', runId: activeRunId };
  }

  const runId = randomUUID();
  activeRunId = runId;
  const initialUrl = opts && typeof opts.initialUrl === 'string' && opts.initialUrl.trim()
    ? opts.initialUrl.trim()
    : 'about:blank';
  activeInitialUrl = initialUrl;

  entries = [];
  requestMetaById.clear();

  const partitionId = `persist:aw-capture-${runId}`;
  const capSession = session.fromPartition(partitionId);
  captureSession = capSession;
  attachListeners(capSession);

  captureWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    show: true,
    webPreferences: {
      session: capSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  captureWindow.on('closed', () => {
    detachListeners();
    const rid = activeRunId;
    activeRunId = null;
    activeInitialUrl = null;
    captureWindow = null;
    captureSession = null;
    requestMetaById.clear();
    broadcastToMain('capture:stopped', { runId: rid });
  });

  try {
    await captureWindow.loadURL(initialUrl);
  } catch (err) {
    logError('capture loadURL failed', err);
    stopWindow();
    return { ok: false, error: String((err && err.message) || err) };
  }

  logInfo('Capture window started', { runId, initialUrl, partitionId });
  return { ok: true, runId, initialUrl };
}

async function stop() {
  const rid = activeRunId;
  if (!captureWindow || captureWindow.isDestroyed()) {
    activeRunId = null;
    activeInitialUrl = null;
    requestMetaById.clear();
    return { ok: true, runId: rid };
  }
  stopWindow();
  return { ok: true, runId: rid };
}

function getStatus() {
  const active = !!(captureWindow && !captureWindow.isDestroyed());
  return {
    active,
    runId: activeRunId,
    initialUrl: activeInitialUrl,
    entryCount: entries.length,
  };
}

function listEntries() {
  return [...entries];
}

/** Drop all rows (in-memory log); does not stop the capture window. */
function clearEntries() {
  entries = [];
  requestMetaById.clear();
  return { ok: true };
}

module.exports = {
  start,
  stop,
  getStatus,
  listEntries,
  clearEntries,
};
