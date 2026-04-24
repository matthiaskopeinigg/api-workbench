const { ipcMain, BrowserWindow } = require('electron');
const mock = require('../services/mock.service');
const { logError } = require('../services/logger.service');

/**
 * Bridges mock-server hit events to every renderer window. The mock service
 * coalesces hits in batches and hands them off here; we fan them out to all
 * BrowserWindows so any tab listening on `mock:hits` receives them.
 */
function broadcastHits(batch) {
  if (!Array.isArray(batch) || batch.length === 0) return;
  const wins = BrowserWindow.getAllWindows();
  for (const win of wins) {
    if (!win.isDestroyed()) {
      try { win.webContents.send('mock:hits', batch); } catch {  }
    }
  }
}

function registerMockIpcHandlers() {
  mock.setHitBroadcaster(broadcastHits);

  ipcMain.handle('mock:start', async (_event, payload) => {
    try {
      const port = payload && payload.port;
      return await mock.start(port);
    } catch (err) {
      logError('mock:start failed', err);
      return { ...mock.getStatus(), status: 'error', error: String(err && err.message || err) };
    }
  });

  ipcMain.handle('mock:stop', async () => {
    try {
      return await mock.stop();
    } catch (err) {
      logError('mock:stop failed', err);
      return mock.getStatus();
    }
  });

  ipcMain.handle('mock:restart', async () => {
    try {
      return await mock.restart();
    } catch (err) {
      logError('mock:restart failed', err);
      return mock.getStatus();
    }
  });

  ipcMain.handle('mock:status', async () => {
    return mock.getStatus();
  });

  ipcMain.handle('mock:options:get', async () => {
    return mock.getOptions();
  });

  ipcMain.handle('mock:options:set', async (_event, partial) => {
    try {
      const updated = mock.setOptions(partial || {});
      return { ok: true, options: updated };
    } catch (err) {
      logError('mock:options:set failed', err);
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  ipcMain.handle('mock:register', async (_event, payload) => {
    try {
      if (!payload || typeof payload !== 'object') return { ok: false };
      mock.registerVariants(
        payload.requestId,
        payload.variants || [],
        payload.activeVariantId,
        payload.activeVariantIds,
      );
      return { ok: true, status: mock.getStatus() };
    } catch (err) {
      logError('mock:register failed', err);
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  ipcMain.handle('mock:unregister', async (_event, payload) => {
    try {
      if (payload && payload.requestId) mock.unregister(payload.requestId);
      return { ok: true };
    } catch (err) {
      logError('mock:unregister failed', err);
      return { ok: false };
    }
  });

  ipcMain.handle('mock:clear', async () => {
    try {
      mock.clearAll();
      return { ok: true };
    } catch (err) {
      logError('mock:clear failed', err);
      return { ok: false };
    }
  });

  ipcMain.handle('mock:hits:list', async () => {
    try {
      return mock.listHits();
    } catch (err) {
      logError('mock:hits:list failed', err);
      return [];
    }
  });

  ipcMain.handle('mock:hits:clear', async () => {
    try {
      mock.clearHits();
      return { ok: true };
    } catch (err) {
      logError('mock:hits:clear failed', err);
      return { ok: false };
    }
  });

  ipcMain.handle('mock:standalone:register', async (_event, payload) => {
    try {
      const created = mock.registerStandalone(payload || {});
      return { ok: !!created, endpoint: created || null };
    } catch (err) {
      logError('mock:standalone:register failed', err);
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  ipcMain.handle('mock:standalone:unregister', async (_event, payload) => {
    try {
      const removed = payload && payload.id ? mock.unregisterStandalone(payload.id) : false;
      return { ok: !!removed };
    } catch (err) {
      logError('mock:standalone:unregister failed', err);
      return { ok: false };
    }
  });

  ipcMain.handle('mock:standalone:list', async () => {
    try {
      return mock.listStandalone();
    } catch (err) {
      logError('mock:standalone:list failed', err);
      return [];
    }
  });
}

module.exports = { registerMockIpcHandlers };
