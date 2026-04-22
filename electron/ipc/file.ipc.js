const { ipcMain } = require('electron');
const fileService = require('../services/file.service');

module.exports = function () {
    ipcMain.handle("open-file-dialog", async (_event, extensions) => {
        return await fileService.handleOpenFileDialog(extensions);
    });

    ipcMain.handle("open-files-dialog", async (_event, extensions) => {
        return await fileService.handleOpenFilesDialog(extensions);
    });

    ipcMain.handle("read-import-folder", async (_event, options) => {
        return await fileService.handleReadImportFolder(options || {});
    });

    ipcMain.handle("open-directory-dialog", async () => {
        return await fileService.handleOpenDirectoryDialog();
    });

    ipcMain.handle("write-files-to-directory", async (_event, options) => {
        return await fileService.handleWriteFilesToDirectory(options);
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


