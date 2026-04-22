const { ipcMain, app, dialog, shell, BrowserWindow } = require('electron');
const path = require('path');
const { logInfo, logError } = require('../services/logger.service');
const { getDbPath } = require('../db/database');
const {
  getMarkerFilePath,
  getMarkerDir,
  readOverrideTargetFromDisk,
  writeDataDirectoryOverride,
  clearDataDirectoryOverride,
} = require('../user-data-override');

function registerStorageIpcHandlers() {
  ipcMain.handle('storage:get-info', () => {
    const override = readOverrideTargetFromDisk();
    return {
      userData: app.getPath('userData'),
      databasePath: getDbPath(),
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
      title: 'Choose data directory',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths || !res.filePaths[0]) {
      return { ok: false, cancelled: true };
    }
    const chosen = res.filePaths[0];
    try {
      writeDataDirectoryOverride(chosen);
      void logInfo('Data directory override written', { path: chosen, marker: getMarkerFilePath() });
      return { ok: true, path: chosen, needsRestart: true };
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
      return { ok: true, needsRestart: true };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  });
}

module.exports = { registerStorageIpcHandlers };
