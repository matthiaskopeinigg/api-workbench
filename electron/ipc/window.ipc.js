const { ipcMain } = require('electron');
const { getMainWindow, showMainWindow } = require('../services/window.service');

module.exports = function () {
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


