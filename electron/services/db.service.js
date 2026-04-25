const Redis = require('ioredis');
const { logInfo, logError } = require('./logger.service');

/**
 * Manages database connection pools for the app (Redis, and potentially SQL later).
 * Connections are identified by a unique ID from the user settings.
 */
class DbService {
  /** @type {Map<string, Redis>} */
  #redisPool = new Map();

  /**
   * Execute a query against a specific database connection.
   * @param {import('../../src/shared/settings').DatabaseConnection} connection 
   * @param {string} query 
   * @returns {Promise<any>}
   */
  async query(connection, query) {
    if (connection.type === 'redis') {
      return this.#runRedis(connection, query);
    }
    throw new Error(`Unsupported database type: ${connection.type}`);
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
        db: config.database ? parseInt(config.database, 10) : 0,
        tls: config.tls ? {} : undefined,
        retryStrategy: (times) => Math.min(times * 50, 2000),
      });

      client.on('error', (err) => {
        logError(`Redis client error [${poolId}]:`, err);
      });

      this.#redisPool.set(poolId, client);
    }

    try {
      // Very basic command parsing: "GET key" -> client.get("key")
      const parts = query.trim().split(/\s+/);
      const command = parts[0].toLowerCase();
      const args = parts.slice(1);

      if (typeof client[command] !== 'function') {
        throw new Error(`Unsupported Redis command: ${command}`);
      }

      logInfo(`Executing Redis command: ${command} ${args.join(' ')}`);
      return await client[command](...args);
    } catch (err) {
      logError(`Redis query failed: ${err.message}`);
      throw err;
    }
  }

  /** Close all active connections (e.g. on app shutdown). */
  async closeAll() {
    logInfo('Closing all database connections');
    const promises = [];
    for (const client of this.#redisPool.values()) {
      promises.push(client.quit());
    }
    this.#redisPool.clear();
    await Promise.allSettled(promises);
  }
}

module.exports = new DbService();
