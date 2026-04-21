const { ipcMain } = require('electron');
const { getAllCookies, deleteCookie, clearAllCookies } = require('../services/http.service');

function registerCookieIpcHandlers() {
    ipcMain.handle('cookies:get-all', async () => {
        return await getAllCookies();
    });

    ipcMain.handle('cookies:delete', async (event, domain, path, name) => {
        return await deleteCookie(domain, path, name);
    });

    ipcMain.handle('cookies:clear-all', async () => {
        return await clearAllCookies();
    });
}

module.exports = { registerCookieIpcHandlers };
