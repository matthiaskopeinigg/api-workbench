const { ipcMain } = require('electron');
const updater = require('../services/updater.service');

function registerUpdaterIpcHandlers() {
    ipcMain.handle('updater:get-status', () => updater.getStatus());
    ipcMain.handle('updater:check', () => updater.checkForUpdates());
    ipcMain.handle('updater:download', () => updater.downloadUpdate());
    ipcMain.on('updater:install', () => updater.quitAndInstall());
}

module.exports = { registerUpdaterIpcHandlers };
