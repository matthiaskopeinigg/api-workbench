const { ipcMain, BrowserWindow } = require('electron');
const load = require('../services/load.service');
const { logError } = require('../services/logger.service');

/**
 * IPC bridge for the Load Test engine. Each run gets two unique broadcast
 * channels — `load:progress:<runId>` (fired ~4 times/s while running) and
 * `load:done:<runId>` (one terminal payload). Renderers subscribe via the
 * preload helpers; we fan out to every BrowserWindow so multiple tabs of
 * the same workspace can observe a run started elsewhere.
 */
function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try { win.webContents.send(channel, payload); } catch {  }
  }
}

function registerLoadIpcHandlers() {
  ipcMain.handle('load:start', async (_event, config) => {
    try {
      const runId = load.start(config || {}, {
        onProgress: (event) => broadcast(`load:progress:${runId}`, event),
        onDone: (result) => broadcast(`load:done:${runId}`, result),
      });
      return { ok: true, runId };
    } catch (err) {
      logError('load:start failed', err);
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  ipcMain.handle('load:cancel', async (_event, payload) => {
    try {
      const runId = payload && payload.runId;
      const ok = load.cancel(runId);
      return { ok };
    } catch (err) {
      logError('load:cancel failed', err);
      return { ok: false };
    }
  });

  ipcMain.handle('load:status', async (_event, payload) => {
    try {
      const runId = payload && payload.runId;
      return load.status(runId);
    } catch (err) {
      logError('load:status failed', err);
      return null;
    }
  });
}

module.exports = { registerLoadIpcHandlers };
