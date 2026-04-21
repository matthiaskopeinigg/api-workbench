const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { logInfo, logError } = require('../services/logger.service');

let db = null;

function getDbPath() {
  const dir = app.getPath('userData');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, 'workbench.sqlite');
}

function openDatabase() {
  if (db) {
    return db;
  }
  const Database = require('better-sqlite3');
  const dbPath = getDbPath();
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  migrate(db);
  logInfo('SQLite opened', { dbPath });
  return db;
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_kv (
      key TEXT PRIMARY KEY,
      json TEXT NOT NULL
    );
  `);
  const row = database.prepare('SELECT value FROM app_meta WHERE key = ?').get('schema_version');
  const version = row ? parseInt(row.value, 10) : 0;
  if (version < 1) {
    database.prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)').run('schema_version', '1');
  }
  if (version < 2) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS response_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        status_code INTEGER,
        status_text TEXT,
        time_ms INTEGER,
        size INTEGER,
        http_version TEXT,
        content_type TEXT,
        headers_json TEXT,
        body TEXT,
        is_binary INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_response_history_request
        ON response_history(request_id, received_at DESC);
    `);
    database.prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)').run('schema_version', '2');
  }
}

function appendResponseHistory(entry) {
  const database = openDatabase();
  const stmt = database.prepare(`
    INSERT INTO response_history
      (request_id, received_at, status_code, status_text, time_ms, size, http_version, content_type, headers_json, body, is_binary)
    VALUES
      (@request_id, @received_at, @status_code, @status_text, @time_ms, @size, @http_version, @content_type, @headers_json, @body, @is_binary)
  `);
  const info = stmt.run({
    request_id: String(entry.requestId || ''),
    received_at: Number(entry.receivedAt) || Date.now(),
    status_code: entry.statusCode == null ? null : Number(entry.statusCode),
    status_text: entry.statusText == null ? null : String(entry.statusText),
    time_ms: entry.timeMs == null ? null : Number(entry.timeMs),
    size: entry.size == null ? null : Number(entry.size),
    http_version: entry.httpVersion == null ? null : String(entry.httpVersion),
    content_type: entry.contentType == null ? null : String(entry.contentType),
    headers_json: JSON.stringify(entry.headers || []),
    body: entry.body == null ? null : String(entry.body),
    is_binary: entry.isBinary ? 1 : 0,
  });
  database.prepare(`
    DELETE FROM response_history
    WHERE request_id = ?
      AND id NOT IN (
        SELECT id FROM response_history
        WHERE request_id = ?
        ORDER BY received_at DESC
        LIMIT 50
      )
  `).run(entry.requestId, entry.requestId);
  return info.lastInsertRowid;
}

function listResponseHistory(requestId, limit = 20) {
  const rows = openDatabase().prepare(`
    SELECT id, request_id, received_at, status_code, status_text, time_ms, size, http_version, content_type, is_binary
    FROM response_history
    WHERE request_id = ?
    ORDER BY received_at DESC
    LIMIT ?
  `).all(String(requestId || ''), Number(limit) || 20);
  return rows.map((r) => ({
    id: r.id,
    requestId: r.request_id,
    receivedAt: r.received_at,
    statusCode: r.status_code,
    statusText: r.status_text,
    timeMs: r.time_ms,
    size: r.size,
    httpVersion: r.http_version,
    contentType: r.content_type,
    isBinary: r.is_binary === 1,
  }));
}

function getResponseHistoryEntry(id) {
  const row = openDatabase().prepare(`
    SELECT id, request_id, received_at, status_code, status_text, time_ms, size, http_version, content_type, headers_json, body, is_binary
    FROM response_history WHERE id = ?
  `).get(Number(id));
  if (!row) return null;
  let headers = [];
  try { headers = JSON.parse(row.headers_json || '[]'); } catch { headers = []; }
  return {
    id: row.id,
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
  };
}

function deleteResponseHistory(requestId) {
  openDatabase().prepare('DELETE FROM response_history WHERE request_id = ?').run(String(requestId || ''));
}

function getDocument(id) {
  const row = openDatabase().prepare('SELECT json FROM documents WHERE id = ?').get(id);
  return row ? row.json : null;
}

function setDocument(id, jsonString) {
  openDatabase().prepare('INSERT OR REPLACE INTO documents (id, json) VALUES (?, ?)').run(id, jsonString);
}

function getSessionKey(key) {
  const row = openDatabase().prepare('SELECT json FROM session_kv WHERE key = ?').get(key);
  if (!row) {
    return undefined;
  }
  try {
    return JSON.parse(row.json);
  } catch {
    return undefined;
  }
}

function setSessionKey(key, value) {
  const json = JSON.stringify(value ?? null);
  openDatabase().prepare('INSERT OR REPLACE INTO session_kv (key, json) VALUES (?, ?)').run(key, json);
}

function closeDatabase() {
  if (db) {
    try {
      db.close();
    } catch (e) {
      logError('SQLite close failed', e);
    }
    db = null;
  }
}

module.exports = {
  openDatabase,
  getDbPath,
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
