const { ipcMain } = require('electron');
const storeService = require('../services/store.service');
const { logError } = require('../services/logger.service');

module.exports = function () {

    ipcMain.handle("get-settings", async () => {
        try {
            return await storeService.getSettings();
        } catch (err) {
            logError('IPC get-settings failed', err);
            throw err;
        }
    });

    ipcMain.handle("save-settings", async (_e, settings) => {
        try {
            storeService.setSettings(settings);
        } catch (err) {
            logError('IPC save-settings failed', err);
            throw err;
        }
    });

    ipcMain.handle("get-collections", async () => {
        try {
            return await storeService.getCollections();
        } catch (err) {
            logError('IPC get-collections failed', err);
            throw err;
        }
    });

    ipcMain.handle("save-collections", async (_e, collections) => {
        try {
            return await storeService.setCollections(collections);
        } catch (err) {
            logError('IPC save-collections failed', err);
            throw err;
        }
    });

    ipcMain.handle("get-environments", async () => {
        try {
            return await storeService.getEnvironments();
        } catch (err) {
            logError('IPC get-environments failed', err);
            throw err;
        }
    });

    ipcMain.handle("save-environments", async (_e, environments) => {
        try {
            return await storeService.setEnvironments(environments);
        } catch (err) {
            logError('IPC save-environments failed', err);
            throw err;
        }
    });

    ipcMain.handle("get-session", (_e, key) => {
        try {
            return storeService.getSession(key);
        } catch (err) {
            logError('IPC get-session failed', { key, message: err && err.message });
            throw err;
        }
    });

    ipcMain.handle("save-session", (_e, key, value) => {
        try {
            return storeService.setSession(key, value);
        } catch (err) {
            logError('IPC save-session failed', { key, message: err && err.message });
            throw err;
        }
    });

};
