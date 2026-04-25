const registerStoreHandlers = require('./store.ipc');
const registerFileHandlers = require('./file.ipc');
const registerHttpHandlers = require('./http.ipc');
const registerWindowHandlers = require('./window.ipc');
const { registerCookieIpcHandlers } = require('./cookie.ipc');
const { registerScriptIpcHandlers } = require('./script.ipc');
const { registerOAuthHandlers } = require('./oauth.ipc');
const { registerUpdaterIpcHandlers } = require('./updater.ipc');
const { registerWebSocketIpcHandlers } = require('./websocket.ipc');
const { registerHistoryIpcHandlers } = require('./history.ipc');
const { registerMockIpcHandlers } = require('./mock.ipc');
const { registerTestingIpcHandlers } = require('./testing.ipc');
const { registerLoadIpcHandlers } = require('./load.ipc');
const { registerStorageIpcHandlers } = require('./storage.ipc');
const { logInfo } = require('../services/logger.service');

function registerIpcHandlers() {
    registerStoreHandlers();
    registerFileHandlers();
    registerHttpHandlers();
    registerWindowHandlers();
    registerCookieIpcHandlers();
    registerScriptIpcHandlers();
    registerOAuthHandlers();
    registerUpdaterIpcHandlers();
    registerWebSocketIpcHandlers();
    registerHistoryIpcHandlers();
    registerMockIpcHandlers();
    registerTestingIpcHandlers();
    registerLoadIpcHandlers();
    registerStorageIpcHandlers();
    const { registerDbIpcHandlers } = require('./db.ipc');
    registerDbIpcHandlers();

    logInfo('IPC handlers registered');
}

module.exports = {
    registerIpcHandlers
};


