const { ipcMain } = require('electron');
const db = require('../db/database');
const { logError } = require('../services/logger.service');

function registerHistoryIpcHandlers() {
  ipcMain.handle('history:append', async (_event, entry) => {
    try {
      if (!entry || typeof entry !== 'object') return null;
      return db.appendResponseHistory(entry);
    } catch (err) {
      logError('history:append failed', err);
      return null;
    }
  });

  ipcMain.handle('history:list', async (_event, payload) => {
    try {
      const requestId = payload && payload.requestId;
      const limit = payload && payload.limit;
      return db.listResponseHistory(requestId, limit);
    } catch (err) {
      logError('history:list failed', err);
      return [];
    }
  });

  ipcMain.handle('history:get', async (_event, payload) => {
    try {
      const id = payload && payload.id;
      return db.getResponseHistoryEntry(id);
    } catch (err) {
      logError('history:get failed', err);
      return null;
    }
  });

  ipcMain.handle('history:clear', async (_event, payload) => {
    try {
      const requestId = payload && payload.requestId;
      db.deleteResponseHistory(requestId);
      return true;
    } catch (err) {
      logError('history:clear failed', err);
      return false;
    }
  });
}

module.exports = { registerHistoryIpcHandlers };
