const { ipcMain, app, dialog, shell, BrowserWindow } = require('electron');
const { logInfo, logError } = require('../services/logger.service');
const { getDbPath } = require('../db/database');
const {
  readOverrideTargetFromDisk,
  writeDataDirectoryOverride,
  clearDataDirectoryOverride,
  getMarkerFilePath,
  getMarkerDir,
} = require('../user-data-override');
const { getAppConfigDir, getLogsDir } = require('../services/paths.service');

/** `app.setPath('userData')` only applies at process start; relaunch applies marker/env changes. */
function scheduleRelaunchAfterUserDataOverrideChange() {
  setImmediate(() => {
    try {
      app.relaunch();
      app.exit(0);
    } catch (e) {
      logError('storage:relaunch-after-user-data-change', e);
      app.exit(1);
    }
  });
}

function registerStorageIpcHandlers() {
  ipcMain.handle('storage:get-info', () => {
    const override = readOverrideTargetFromDisk();
    return {
      userData: app.getPath('userData'),
      databasePath: getDbPath(),
      appConfigDir: getAppConfigDir(),
      logsDir: getLogsDir(),
      markerFile: getMarkerFilePath(),
      markerDir: getMarkerDir(),
      overrideSource: override.source,
      overrideTarget: override.path,
      env: process.env.API_WORKBENCH_USER_DATA || null,
    };
  });

  ipcMain.handle('storage:open-user-data', async () => {
    const p = app.getPath('userData');
    const err = await shell.openPath(p);
    if (err) {
      logError('storage:open-user-data', new Error(String(err)));
      return { ok: false, error: String(err) };
    }
    return { ok: true, path: p };
  });

  ipcMain.handle('storage:open-logs-dir', async () => {
    const p = getLogsDir();
    const err = await shell.openPath(p);
    if (err) {
      logError('storage:open-logs-dir', new Error(String(err)));
      return { ok: false, error: String(err) };
    }
    return { ok: true, path: p };
  });

  ipcMain.handle('storage:open-marker-dir', async () => {
    const p = getMarkerDir();
    const err = await shell.openPath(p);
    if (err) {
      return { ok: false, error: String(err) };
    }
    return { ok: true, path: p };
  });

  ipcMain.handle('storage:choose-data-directory', async () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
    const res = await dialog.showOpenDialog(win || undefined, {
      title: 'Choose work directory',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths || !res.filePaths[0]) {
      return { ok: false, cancelled: true };
    }
    const chosen = res.filePaths[0];
    try {
      writeDataDirectoryOverride(chosen);
      void logInfo('Data directory override written', { path: chosen, marker: getMarkerFilePath() });
      scheduleRelaunchAfterUserDataOverrideChange();
      return { ok: true, path: chosen, relaunching: true };
    } catch (e) {
      logError('storage:choose-data-directory', e);
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  });

  ipcMain.handle('storage:reset-data-directory-override', () => {
    try {
      if (process.env.API_WORKBENCH_USER_DATA) {
        return { ok: false, error: 'Clear API_WORKBENCH_USER_DATA in your environment and restart.' };
      }
      clearDataDirectoryOverride();
      scheduleRelaunchAfterUserDataOverrideChange();
      return { ok: true, relaunching: true };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  });
}

module.exports = { registerStorageIpcHandlers };
