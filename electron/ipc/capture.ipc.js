const { ipcMain } = require('electron');
const capture = require('../services/capture.service');
const { logError } = require('../services/logger.service');

function registerCaptureIpcHandlers() {
  ipcMain.handle('capture:start', async (_event, payload) => {
    try {
      return await capture.start(payload && typeof payload === 'object' ? payload : {});
    } catch (err) {
      logError('capture:start failed', err);
      return { ok: false, error: String((err && err.message) || err) };
    }
  });

  ipcMain.handle('capture:stop', async () => {
    try {
      return await capture.stop();
    } catch (err) {
      logError('capture:stop failed', err);
      return { ok: false, error: String((err && err.message) || err) };
    }
  });

  ipcMain.handle('capture:status', async () => {
    try {
      return capture.getStatus();
    } catch (err) {
      logError('capture:status failed', err);
      return { active: false, runId: null, initialUrl: null, entryCount: 0 };
    }
  });

  ipcMain.handle('capture:list', async () => {
    try {
      return capture.listEntries();
    } catch (err) {
      logError('capture:list failed', err);
      return [];
    }
  });

  ipcMain.handle('capture:clear', async () => {
    try {
      return capture.clearEntries();
    } catch (err) {
      logError('capture:clear failed', err);
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
}

module.exports = { registerCaptureIpcHandlers };
