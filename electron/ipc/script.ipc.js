const { ipcMain } = require('electron');
const { executeScript } = require('../services/script.service');

function registerScriptIpcHandlers() {
    ipcMain.handle('scripts:run', async (event, { code, context }) => {
        try {
            return await executeScript(code, context);
        } catch (err) {
            return { error: true, message: err.message };
        }
    });
}

module.exports = { registerScriptIpcHandlers };
