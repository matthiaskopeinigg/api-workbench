const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { logInfo, logError } = require('../services/logger.service');

/** @type {boolean} */
let workspaceReady = false;

/** Document id → file name under workspace/ */
const DOC_FILES = {
  settings: 'settings.json',
  collections: 'collections.json',
  environments: 'environments.json',
  cookieJar: 'cookie-jar.json',
  loadTests: 'load-tests.json',
  contractTests: 'contract-tests.json',
  flows: 'flows.json',
};

const SESSION_FILE = 'session.json';
const RESPONSE_HISTORY_FILE = 'response-history.json';

function getWorkspaceDir() {
  const root = app.getPath('userData');
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
  return path.join(root, 'workspace');
}

/** @deprecated name — returns workspace directory (JSON files), not SQLite. */
function getDbPath() {
  return getWorkspaceDir();
}

function docFileName(id) {
  if (DOC_FILES[id]) return DOC_FILES[id];
  const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${safe || 'doc'}.json`;
}

function atomicWrite(filePath, contents) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, contents, 'utf8');
  fs.renameSync(tmp, filePath);
}

function jsonWorkspaceHasAnyFile() {
  const dir = getWorkspaceDir();
  if (!fs.existsSync(dir)) return false;
  for (const f of Object.values(DOC_FILES)) {
    if (fs.existsSync(path.join(dir, f))) return true;
  }
  return (
    fs.existsSync(path.join(dir, SESSION_FILE)) ||
    fs.existsSync(path.join(dir, RESPONSE_HISTORY_FILE))
  );
}

/**
 * One-time export from legacy workbench.sqlite into workspace/*.json
 */
function migrateSqliteToJsonIfNeeded() {
  if (jsonWorkspaceHasAnyFile()) {
    return;
  }
  const sqlitePath = path.join(app.getPath('userData'), 'workbench.sqlite');
  if (!fs.existsSync(sqlitePath)) {
    return;
  }
  try {
    const Database = require('better-sqlite3');
    const sq = new Database(sqlitePath, { readonly: true });
    const dir = getWorkspaceDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let rows = [];
    try {
      rows = sq.prepare('SELECT id, json FROM documents').all();
    } catch {
      rows = [];
    }
    for (const r of rows) {
      if (!r || !r.id) continue;
      const fname = docFileName(r.id);
      atomicWrite(path.join(dir, fname), String(r.json ?? '{}'));
    }

    let sessions = [];
    try {
      sessions = sq.prepare('SELECT key, json FROM session_kv').all();
    } catch {
      sessions = [];
    }
    const sessObj = {};
    for (const s of sessions) {
      if (!s || !s.key) continue;
      try {
        sessObj[s.key] = JSON.parse(s.json);
      } catch {
        sessObj[s.key] = null;
      }
    }
    if (Object.keys(sessObj).length > 0) {
      atomicWrite(path.join(dir, SESSION_FILE), JSON.stringify(sessObj, null, 2));
    }

    let histRows = [];
    try {
      histRows = sq
        .prepare(
          `
      SELECT id, request_id, received_at, status_code, status_text, time_ms, size, http_version,
             content_type, headers_json, body, is_binary
      FROM response_history ORDER BY id ASC
    `,
        )
        .all();
    } catch {
      histRows = [];
    }
    const items = [];
    let nextId = 1;
    for (const row of histRows) {
      let headers = [];
      try {
        headers = JSON.parse(row.headers_json || '[]');
      } catch {
        headers = [];
      }
      const rid = Number(row.id);
      const id = Number.isFinite(rid) ? rid : nextId;
      if (!Number.isFinite(rid)) {
        nextId += 1;
      }
      nextId = Math.max(nextId, id + 1);
      items.push({
        id,
        requestId: row.request_id,
        receivedAt: row.received_at,
        statusCode: row.status_code,
        statusText: row.status_text,
        timeMs: row.time_ms,
        size: row.size,
        httpVersion: row.http_version,
        contentType: row.content_type,
        headers,
        body: row.body,
        isBinary: row.is_binary === 1,
      });
    }
    if (items.length > 0) {
      atomicWrite(path.join(dir, RESPONSE_HISTORY_FILE), JSON.stringify({ nextId, items }, null, 2));
    }

    sq.close();
    const bak = `${sqlitePath}.migrated.${Date.now()}.bak`;
    fs.renameSync(sqlitePath, bak);
    void logInfo('Migrated SQLite workbench to JSON workspace files', { workspace: dir, backup: bak });
  } catch (e) {
    logError('SQLite → JSON migration failed', e);
  }
}

function ensureWorkspace() {
  if (workspaceReady) {
    return;
  }
  const dir = getWorkspaceDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  migrateSqliteToJsonIfNeeded();
  workspaceReady = true;
  void logInfo('JSON workspace ready', { workspace: dir });
}

function openDatabase() {
  ensureWorkspace();
  return true;
}

function closeDatabase() {
  workspaceReady = false;
}

function getDocument(id) {
  ensureWorkspace();
  const file = path.join(getWorkspaceDir(), docFileName(id));
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    logError(`getDocument(${id}) read failed`, e);
    return null;
  }
}

function setDocument(id, jsonString) {
  ensureWorkspace();
  const file = path.join(getWorkspaceDir(), docFileName(id));
  atomicWrite(file, typeof jsonString === 'string' ? jsonString : JSON.stringify(jsonString ?? {}, null, 2));
}

function readSessionStore() {
  const p = path.join(getWorkspaceDir(), SESSION_FILE);
  if (!fs.existsSync(p)) {
    return {};
  }
  try {
    const o = JSON.parse(fs.readFileSync(p, 'utf8'));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

function writeSessionStore(obj) {
  atomicWrite(path.join(getWorkspaceDir(), SESSION_FILE), JSON.stringify(obj, null, 2));
}

function getSessionKey(key) {
  ensureWorkspace();
  return readSessionStore()[key];
}

function setSessionKey(key, value) {
  ensureWorkspace();
  const all = readSessionStore();
  all[key] = value;
  writeSessionStore(all);
}

function readHistoryStore() {
  const p = path.join(getWorkspaceDir(), RESPONSE_HISTORY_FILE);
  if (!fs.existsSync(p)) {
    return { nextId: 1, items: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const items = Array.isArray(raw.items) ? raw.items : [];
    let nextId = Number(raw.nextId) || 1;
    for (const it of items) {
      if (it && it.id != null) {
        nextId = Math.max(nextId, Number(it.id) + 1);
      }
    }
    return { nextId, items };
  } catch {
    return { nextId: 1, items: [] };
  }
}

function writeHistoryStore(data) {
  atomicWrite(path.join(getWorkspaceDir(), RESPONSE_HISTORY_FILE), JSON.stringify(data, null, 2));
}

function trimHistoryForRequest(items, requestId, keep = 50) {
  const same = items
    .filter((e) => e && e.requestId === requestId)
    .sort((a, b) => (Number(b.receivedAt) || 0) - (Number(a.receivedAt) || 0));
  if (same.length <= keep) {
    return items;
  }
  const drop = new Set(same.slice(keep).map((e) => e.id));
  return items.filter((e) => !drop.has(e.id));
}

function appendResponseHistory(entry) {
  ensureWorkspace();
  const data = readHistoryStore();
  const id = data.nextId++;
  const row = {
    id,
    requestId: String(entry.requestId || ''),
    receivedAt: Number(entry.receivedAt) || Date.now(),
    statusCode: entry.statusCode == null ? null : Number(entry.statusCode),
    statusText: entry.statusText == null ? null : String(entry.statusText),
    timeMs: entry.timeMs == null ? null : Number(entry.timeMs),
    size: entry.size == null ? null : Number(entry.size),
    httpVersion: entry.httpVersion == null ? null : String(entry.httpVersion),
    contentType: entry.contentType == null ? null : String(entry.contentType),
    headers: Array.isArray(entry.headers) ? entry.headers : [],
    body: entry.body == null ? null : String(entry.body),
    isBinary: !!entry.isBinary,
  };
  data.items.push(row);
  data.items = trimHistoryForRequest(data.items, row.requestId, 50);
  writeHistoryStore(data);
  return id;
}

function listResponseHistory(requestId, limit = 20) {
  ensureWorkspace();
  const data = readHistoryStore();
  const lim = Number(limit) || 20;
  return data.items
    .filter((r) => r && r.requestId === String(requestId || ''))
    .sort((a, b) => (Number(b.receivedAt) || 0) - (Number(a.receivedAt) || 0))
    .slice(0, lim)
    .map((r) => ({
      id: r.id,
      requestId: r.requestId,
      receivedAt: r.receivedAt,
      statusCode: r.statusCode,
      statusText: r.statusText,
      timeMs: r.timeMs,
      size: r.size,
      httpVersion: r.httpVersion,
      contentType: r.contentType,
      isBinary: !!r.isBinary,
    }));
}

function getResponseHistoryEntry(id) {
  ensureWorkspace();
  const data = readHistoryStore();
  const row = data.items.find((r) => r && Number(r.id) === Number(id));
  if (!row) return null;
  return {
    id: row.id,
    requestId: row.requestId,
    receivedAt: row.receivedAt,
    statusCode: row.statusCode,
    statusText: row.statusText,
    timeMs: row.timeMs,
    size: row.size,
    httpVersion: row.httpVersion,
    contentType: row.contentType,
    headers: Array.isArray(row.headers) ? row.headers : [],
    body: row.body,
    isBinary: !!row.isBinary,
  };
}

function deleteResponseHistory(requestId) {
  ensureWorkspace();
  const data = readHistoryStore();
  const rid = String(requestId || '');
  data.items = data.items.filter((r) => !r || r.requestId !== rid);
  writeHistoryStore(data);
}

module.exports = {
  openDatabase,
  getDbPath,
  getWorkspaceDir,
  getDocument,
  setDocument,
  getSessionKey,
  setSessionKey,
  closeDatabase,
  appendResponseHistory,
  listResponseHistory,
  getResponseHistoryEntry,
  deleteResponseHistory,
};
