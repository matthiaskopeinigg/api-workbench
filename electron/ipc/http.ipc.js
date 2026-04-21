const { ipcMain } = require('electron');
const httpService = require('../services/http.service');
const { logInfo, logError } = require('../services/logger.service');

module.exports = function () {
    ipcMain.handle('http-request', async (event, request) => {
        const startedAt = Date.now();
        const method = (request && request.method) || 'GET';
        const url = (request && request.url) || '';
        try {
            const response = await httpService.handleHttpRequest(request);
            const durationMs = Date.now() - startedAt;
            logInfo('HTTP', {
                method,
                url,
                status: response && response.status,
                ms: durationMs,
                size: response && response.size
            });
            return response;
        } catch (err) {
            const durationMs = Date.now() - startedAt;
            logError(`HTTP ${method} ${url} failed after ${durationMs}ms`, err);
            throw err;
        }
    });
};
