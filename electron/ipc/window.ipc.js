const { ipcMain, shell, app } = require('electron');
const { getMainWindow, showMainWindow } = require('../services/window.service');

function isSafeHttpUrl(url) {
    if (typeof url !== 'string' || url.length > 8_000) return false;
    try {
        const u = new URL(url);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

module.exports = function () {
    /** Synchronous read for preload `isPackaged` (see preload.js). */
    ipcMain.on('app:is-packaged', (event) => {
        event.returnValue = app.isPackaged;
    });

    ipcMain.on('app:get-version', (event) => {
        event.returnValue = app.getVersion();
    });

    /** Open a link in the OS default browser (not an in-app BrowserWindow). */
    ipcMain.handle('open-external-url', async (_event, url) => {
        if (!isSafeHttpUrl(url)) {
            return { ok: false, error: 'Invalid URL' };
        }
        try {
            await shell.openExternal(url);
            return { ok: true };
        } catch (e) {
            return { ok: false, error: e && e.message ? String(e.message) : 'open failed' };
        }
    });

    ipcMain.on("window-minimize", () => {
        const win = getMainWindow();
        if (win) win.minimize();
    });

    ipcMain.on("window-maximize", () => {
        const win = getMainWindow();
        if (win) {
            win.isMaximized() ? win.unmaximize() : win.maximize();
        }
    });

    ipcMain.on("window-close", () => {
        const win = getMainWindow();
        if (win) win.close();
    });

    ipcMain.on("app-ready", () => {
        showMainWindow();
    });
};


