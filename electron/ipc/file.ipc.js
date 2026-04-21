const { ipcMain } = require('electron');
const fileService = require('../services/file.service');

module.exports = function () {
    ipcMain.handle("open-file-dialog", async (_event, extensions) => {
        return await fileService.handleOpenFileDialog(extensions);
    });

    ipcMain.handle("save-file-dialog", async (_event, options) => {
        return await fileService.handleSaveFileDialog(options);
    });

    ipcMain.handle("pick-file-path", async (_event, options) => {
        return await fileService.handleOpenFilePathDialog(options);
    });

    ipcMain.handle("save-response-body", async (_event, payload) => {
        return await fileService.handleSaveResponseBody(payload);
    });
};


