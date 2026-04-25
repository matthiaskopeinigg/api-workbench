const { ipcMain } = require('electron');
const dbService = require('../services/db.service');
const { logError } = require('../services/logger.service');

function registerDbIpcHandlers() {
  /**
   * Execute a database query.
   * payload: { connection: DatabaseConnection, query: string }
   */
  ipcMain.handle('db:query', async (_event, { connection, query }) => {
    try {
      return await dbService.query(connection, query);
    } catch (err) {
      logError(`IPC db:query failed:`, err);
      throw err;
    }
  });

  // Close connections on app quit (handled in main.js usually, but we can hook here if needed)
}

module.exports = { registerDbIpcHandlers };
