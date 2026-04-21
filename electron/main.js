const { app, BrowserWindow, crashReporter } = require('electron');
const { registerIpcHandlers } = require('./ipc');
const { initStores, getSession, setSession } = require('./services/store.service');
const httpService = require('./services/http.service');
const scriptService = require('./services/script.service');
const mockService = require('./services/mock.service');
const { createWindow } = require('./services/window.service');
const updaterService = require('./services/updater.service');
const { logInfo, logError } = require('./services/logger.service');

const MOCK_OPTIONS_SESSION_KEY = 'mockServerOptions';
const MOCK_STANDALONE_SESSION_KEY = 'mockServerStandalone';

function rehydrateMockOptions() {
  try {
    const persisted = getSession(MOCK_OPTIONS_SESSION_KEY);
    if (persisted && typeof persisted === 'object') {
      mockService.setOptions(persisted);
    }
  } catch (err) {
    logError('Failed to rehydrate mock options', err);
  }
}

function persistMockOptionsOnChange() {
  const original = mockService.setOptions;
  mockService.setOptions = (partial) => {
    const next = original(partial);
    try { setSession(MOCK_OPTIONS_SESSION_KEY, next); } catch {  }
    return next;
  };
}

function rehydrateStandaloneMocks() {
  try {
    const persisted = getSession(MOCK_STANDALONE_SESSION_KEY);
    if (Array.isArray(persisted)) {
      for (const endpoint of persisted) {
        try { mockService.registerStandalone(endpoint); } catch {  }
      }
    }
  } catch (err) {
    logError('Failed to rehydrate standalone mocks', err);
  }
}

function persistStandaloneOnChange() {
  const snapshot = () => {
    try { setSession(MOCK_STANDALONE_SESSION_KEY, mockService.listStandalone()); }
    catch {  }
  };
  const originalReg = mockService.registerStandalone;
  mockService.registerStandalone = (endpoint) => {
    const result = originalReg(endpoint);
    snapshot();
    return result;
  };
  const originalUnreg = mockService.unregisterStandalone;
  mockService.unregisterStandalone = (id) => {
    const ok = originalUnreg(id);
    snapshot();
    return ok;
  };
  const originalClear = mockService.clearAll;
  mockService.clearAll = () => {
    originalClear();
    snapshot();
  };
}

if (typeof crashReporter?.setUploadToServer === 'function') {
  crashReporter.setUploadToServer(false);
}

app.whenReady().then(async () => {
  try {
    await initStores();
    await httpService.init();
    scriptService.init({ httpRequest: httpService.handleHttpRequest });
    rehydrateMockOptions();
    persistMockOptionsOnChange();
    persistStandaloneOnChange();
    rehydrateStandaloneMocks();
    registerIpcHandlers();
    await createWindow();
    updaterService.init();

    if (mockService.getOptions().autoStart) {
      mockService.start().catch((err) => logError('Mock server auto-start failed', err));
    }
    setTimeout(() => { void updaterService.checkForUpdates(); }, 5000);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });

    logInfo('Application started successfully');
  } catch (err) {
    logError('Failed to start application', err);
    app.quit();
  }
});

process.on('uncaughtException', (error) => {
  logError('Uncaught Exception', error);
});

process.on('unhandledRejection', (error) => {
  logError('Unhandled Rejection', error);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
