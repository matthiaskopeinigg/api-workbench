const { ipcMain } = require('electron');
const wsService = require('../services/websocket.service');
const { logError } = require('../services/logger.service');

function registerWebSocketIpcHandlers() {
    ipcMain.handle('ws:connect', async (event, payload) => {
        try {
            return await wsService.connect(event, payload);
        } catch (err) {
            logError('ws:connect failed', err);
            throw err;
        }
    });

    ipcMain.handle('ws:send', async (event, payload) => {
        try {
            return await wsService.send(event, payload);
        } catch (err) {
            logError('ws:send failed', err);
            throw err;
        }
    });

    ipcMain.handle('ws:close', async (event, payload) => {
        try {
            return await wsService.close(event, payload);
        } catch (err) {
            logError('ws:close failed', err);
            throw err;
        }
    });
}

module.exports = { registerWebSocketIpcHandlers };
