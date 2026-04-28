const path = require('path');
const { logInfo, logError } = require('./logger.service');
const store = require('./store.service');

const Redis = require('ioredis');
const Database = require('better-sqlite3');
const { Pool: PgPool } = require('pg');
const mysql = require('mysql2/promise');
const sqlMssql = require('mssql');

class DbService {
  /** @type {Map<string, Redis>} */
  #redisPool = new Map();
  /** @type {Map<string, import('better-sqlite3').Database>} */
  #sqliteDbs = new Map();
  /** @type {Map<string, PgPool>} */
  #pgPools = new Map();
  /** @type {Map<string, any>} */
  #mysqlPools = new Map();
  /** @type {Map<string, sqlMssql.ConnectionPool>} */
  #mssqlPools = new Map();

  #connectTimeoutMs(conn) {
    const n = Number(conn?.connectTimeoutMs);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 600_000) : 10_000;
  }

  #commandTimeoutMs(conn) {
    const n = Number(conn?.commandTimeoutMs);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 3_600_000) : undefined;
  }

  #busyTimeoutMs(conn) {
    const n = Number(conn?.busyTimeoutMs);
    return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 300_000) : 5000;
  }

  /**
   * @template T
   * @param {Promise<T>} promise
   * @param {number | undefined} ms
   * @param {string} label
   * @returns {Promise<T>}
   */
  async #withOptionalTimeout(promise, ms, label) {
    if (ms == null || ms <= 0) return promise;
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timer);
    }
  }

  #resolveSqlitePath(conn) {
    const raw = conn.filePath || conn.database;
    if (!raw || typeof raw !== 'string') {
      throw new Error('SQLite connection needs filePath (or database as file path)');
    }
    return path.resolve(raw);
  }

  #getSqlite(conn) {
    const abs = this.#resolveSqlitePath(conn);
    const busy = this.#busyTimeoutMs(conn);
    if (!this.#sqliteDbs.has(abs)) {
      logInfo('Opening SQLite database', { path: abs });
      this.#sqliteDbs.set(abs, new Database(abs, { timeout: busy }));
    } else {
      try {
        this.#sqliteDbs.get(abs).pragma(`busy_timeout = ${busy}`);
      } catch {
        /* ignore */
      }
    }
    return this.#sqliteDbs.get(abs);
  }

  #pgConfig(conn) {
    return {
      host: conn.host || 'localhost',
      port: Number(conn.port) || 5432,
      user: conn.user,
      password: conn.password,
      database: conn.database || 'postgres',
      ssl: conn.tls ? { rejectUnauthorized: false } : false,
      max: 4,
      connectionTimeoutMillis: this.#connectTimeoutMs(conn),
    };
  }

  #getPgPool(conn) {
    const id = conn.id || `pg:${conn.host}:${conn.port}:${conn.database}`;
    if (!this.#pgPools.has(id)) {
      this.#pgPools.set(id, new PgPool(this.#pgConfig(conn)));
    }
    return this.#pgPools.get(id);
  }

  async #getMysqlPool(conn) {
    const id = conn.id || `my:${conn.host}:${conn.port}`;
    if (!this.#mysqlPools.has(id)) {
      const pool = mysql.createPool({
        host: conn.host || 'localhost',
        port: Number(conn.port) || 3306,
        user: conn.user || 'root',
        password: conn.password || '',
        database: conn.database || undefined,
        ssl: conn.tls ? {} : undefined,
        waitForConnections: true,
        connectionLimit: 4,
        connectTimeout: this.#connectTimeoutMs(conn),
      });
      this.#mysqlPools.set(id, pool);
    }
    return this.#mysqlPools.get(id);
  }

  async #getMssqlPool(conn) {
    const id = conn.id || `mssql:${conn.host}:${conn.port}`;
    if (!this.#mssqlPools.has(id)) {
      const config = {
        user: conn.user,
        password: conn.password,
        server: conn.host || 'localhost',
        port: Number(conn.port) || 1433,
        database: conn.database,
        options: {
          encrypt: !!conn.tls,
          trustServerCertificate: true,
        },
        pool: { max: 4 },
        connectionTimeout: this.#connectTimeoutMs(conn),
      };
      this.#mssqlPools.set(id, await new sqlMssql.ConnectionPool(config).connect());
    }
    return this.#mssqlPools.get(id);
  }

  /**
   * @param {import('../../src/shared/settings').DatabaseConnection} connection
   * @param {string} queryText
   * @returns {Promise<any>}
   */
  async query(connection, queryText) {
    if (!connection || !queryText) {
      throw new Error('Connection and query are required');
    }
    const t = String(connection.type || '').toLowerCase();
    if (t === 'redis') {
      return this.#runRedis(connection, queryText);
    }
    if (t === 'sqlite') {
      return this.#runSqlite(connection, queryText);
    }
    if (t === 'postgresql' || t === 'postgres') {
      return this.#runPostgres(connection, queryText);
    }
    if (t === 'mysql' || t === 'mariadb') {
      return this.#runMysql(connection, queryText);
    }
    if (t === 'mssql' || t === 'sqlserver') {
      return this.#runMssql(connection, queryText);
    }
    throw new Error(`Unsupported database type: ${connection.type}`);
  }

  /**
   * Light probe for the Settings "Test connection" button.
   * Uses short-lived clients so timeouts match the profile being tested.
   * @param {import('../../src/shared/settings').DatabaseConnection} connection
   */
  async testConnection(connection) {
    const t = String(connection.type || '').toLowerCase();
    const connectMs = this.#connectTimeoutMs(connection);
    const commandMs = this.#commandTimeoutMs(connection);

    if (t === 'redis') {
      const client = new Redis({
        host: connection.host || '127.0.0.1',
        port: Number(connection.port) || 6379,
        password: connection.password || undefined,
        db: connection.database ? parseInt(String(connection.database), 10) : 0,
        tls: connection.tls ? {} : undefined,
        connectTimeout: connectMs,
        commandTimeout: commandMs,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
        lazyConnect: false,
      });
      try {
        const ping = commandMs
          ? await this.#withOptionalTimeout(client.ping(), commandMs, 'PING')
          : await client.ping();
        return ping;
      } finally {
        try {
          await client.quit();
        } catch {
          try {
            client.disconnect();
          } catch {
            /* ignore */
          }
        }
      }
    }

    if (t === 'sqlite') {
      return this.query(connection, 'SELECT 1 AS ok');
    }

    if (t === 'postgresql' || t === 'postgres') {
      const { Client } = require('pg');
      const client = new Client({
        host: connection.host || 'localhost',
        port: Number(connection.port) || 5432,
        user: connection.user,
        password: connection.password,
        database: connection.database || 'postgres',
        ssl: connection.tls ? { rejectUnauthorized: false } : false,
        connectionTimeoutMillis: connectMs,
      });
      await client.connect();
      try {
        const q = client.query('SELECT 1');
        const res = await this.#withOptionalTimeout(q, commandMs, 'Query');
        return res.rows;
      } finally {
        await client.end().catch(() => {});
      }
    }

    if (t === 'mysql' || t === 'mariadb') {
      const conn = await mysql.createConnection({
        host: connection.host || 'localhost',
        port: Number(connection.port) || 3306,
        user: connection.user || 'root',
        password: connection.password || '',
        database: connection.database || undefined,
        ssl: connection.tls ? {} : undefined,
        connectTimeout: connectMs,
      });
      try {
        const p = conn.query('SELECT 1');
        const [rows] = await this.#withOptionalTimeout(p, commandMs, 'Query');
        return rows;
      } finally {
        await conn.end().catch(() => {});
      }
    }

    if (t === 'mssql' || t === 'sqlserver') {
      const cfg = {
        user: connection.user,
        password: connection.password,
        server: connection.host || 'localhost',
        port: Number(connection.port) || 1433,
        database: connection.database,
        options: {
          encrypt: !!connection.tls,
          trustServerCertificate: true,
        },
        pool: { max: 1 },
        connectionTimeout: connectMs,
      };
      const pool = new sqlMssql.ConnectionPool(cfg);
      await pool.connect();
      try {
        const req = pool.request();
        if (commandMs) req.timeout = commandMs;
        const res = await req.query('SELECT 1');
        return res.recordset;
      } finally {
        await pool.close().catch(() => {});
      }
    }

    throw new Error(`Unsupported database type: ${connection.type}`);
  }

  #runSqlite(config, queryText) {
    const db = this.#getSqlite(config);
    const q = String(queryText).trim();
    if (!q) {
      return [];
    }
    const lower = q.toLowerCase();
    if (lower.startsWith('select') || lower.startsWith('pragma')) {
      return db.prepare(q).all();
    }
    const info = db.prepare(q).run();
    return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
  }

  async #runPostgres(config, queryText) {
    const pool = this.#getPgPool(config);
    const cmdMs = this.#commandTimeoutMs(config);
    const res = await this.#withOptionalTimeout(pool.query(queryText), cmdMs, 'Query');
    return res.rows;
  }

  async #runMysql(config, queryText) {
    const pool = await this.#getMysqlPool(config);
    const cmdMs = this.#commandTimeoutMs(config);
    const [rows] = await this.#withOptionalTimeout(pool.query(queryText), cmdMs, 'Query');
    return rows;
  }

  async #runMssql(config, queryText) {
    const pool = await this.#getMssqlPool(config);
    const cmdMs = this.#commandTimeoutMs(config);
    const req = pool.request();
    if (cmdMs) req.timeout = cmdMs;
    const res = await req.query(queryText);
    return res.recordset;
  }

  async #runRedis(config, query) {
    const poolId = config.id || `${config.host}:${config.port}`;
    let client = this.#redisPool.get(poolId);
    if (!client) {
      logInfo(`Creating new Redis client for ${config.host}:${config.port}`);
      client = new Redis({
        host: config.host,
        port: config.port,
        password: config.password,
        db: config.database ? parseInt(String(config.database), 10) : 0,
        tls: config.tls ? {} : undefined,
        connectTimeout: this.#connectTimeoutMs(config),
        commandTimeout: this.#commandTimeoutMs(config),
        retryStrategy: (times) => Math.min(times * 50, 2000),
      });
      client.on('error', (err) => {
        logError(`Redis client error [${poolId}]:`, err);
      });
      this.#redisPool.set(poolId, client);
    }
    const parts = query.trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);
    if (typeof client[command] !== 'function') {
      throw new Error(`Unsupported Redis command: ${command}`);
    }
    const cmdMs = this.#commandTimeoutMs(config);
    const exec = client[command](...args);
    return await this.#withOptionalTimeout(Promise.resolve(exec), cmdMs, 'Redis command');
  }

  async closeAll() {
    const promises = [];
    for (const c of this.#redisPool.values()) {
      promises.push(c.quit().catch(() => {}));
    }
    this.#redisPool.clear();
    for (const d of this.#sqliteDbs.values()) {
      try { d.close(); } catch { /* */ }
    }
    this.#sqliteDbs.clear();
    for (const p of this.#pgPools.values()) {
      promises.push(p.end().catch(() => {}));
    }
    this.#pgPools.clear();
    for (const p of this.#mysqlPools.values()) {
      promises.push(p.end().catch(() => {}));
    }
    this.#mysqlPools.clear();
    for (const p of this.#mssqlPools.values()) {
      promises.push(p.close().catch(() => {}));
    }
    this.#mssqlPools.clear();
    await Promise.allSettled(promises);
  }
}

/**
 * Find a saved connection by id from settings store.
 * @param {string} id
 * @returns {import('../../src/shared/settings').DatabaseConnection | null}
 */
function getConnectionByIdFromSettings(id) {
  if (!id) return null;
  const s = store.getSettings();
  const list = (s && s.databases && s.databases.connections) || [];
  return list.find((c) => c && String(c.id) === String(id)) || null;
}

const dbService = new DbService();
dbService.getConnectionByIdFromSettings = getConnectionByIdFromSettings;
module.exports = dbService;
