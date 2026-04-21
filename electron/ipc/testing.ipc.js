const { ipcMain } = require('electron');
const store = require('../services/store.service');
const { logError } = require('../services/logger.service');

/**
 * IPC bridge for the four test-tab artifact kinds. Each kind maps to a
 * single SQLite document under a stable key — see `store.service.ARTIFACT_KEYS`.
 *
 * The renderer always reads/writes the full list (atomic), keeping wire
 * shapes simple at the cost of some bandwidth on large workspaces. If
 * artifact counts ever explode we can swap to a per-id index layer
 * without changing the public IPC.
 */
function registerTestingIpcHandlers() {
  for (const [kind, docKey] of Object.entries(store.ARTIFACT_KEYS)) {
    ipcMain.handle(`testing:${kind}:list`, async () => {
      try { return store.getArtifacts(docKey); }
      catch (err) { logError(`testing:${kind}:list failed`, err); return []; }
    });

    ipcMain.handle(`testing:${kind}:save`, async (_event, items) => {
      try { store.setArtifacts(docKey, items); return { ok: true }; }
      catch (err) {
        logError(`testing:${kind}:save failed`, err);
        return { ok: false, error: String(err && err.message || err) };
      }
    });
  }
}

module.exports = { registerTestingIpcHandlers };
