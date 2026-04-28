const { app, BrowserWindow, crashReporter } = require('electron');
// Reduces GPU disk cache creation failures on some Windows setups (logged as net\disk_cache errors).
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

const { applyUserDataOverride, applyRendererCachePath } = require('./user-data-override');
applyUserDataOverride();
applyRendererCachePath();

const { registerIpcHandlers } = require('./ipc');
const { initStores, getSettings, getSession, setSession } = require('./services/store.service');
const { readMockServerOptions, writeMockServerOptions } = require('./services/app-config-mock.service');
const { reconfigure: reconfigureLogger } = require('./services/logger.service');
const httpService = require('./services/http.service');
const scriptService = require('./services/script.service');
const mockService = require('./services/mock.service');
const { createWindow, getMainWindow } = require('./services/window.service');
const updaterService = require('./services/updater.service');
const { logInfo, logError } = require('./services/logger.service');
require('./services/e2e.service');

const MOCK_OPTIONS_SESSION_KEY = 'mockServerOptions';
const MOCK_STANDALONE_SESSION_KEY = 'mockServerStandalone';

function rehydrateMockOptions() {
  try {
    const fromFile = readMockServerOptions();
    if (fromFile && typeof fromFile === 'object') {
      mockService.setOptions(fromFile);
      return;
    }
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
    try { writeMockServerOptions(next); } catch {  }
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
    try {
      reconfigureLogger(getSettings()?.logging);
    } catch (e) {
      logError('Logger init from settings failed', e);
    }
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

    const mainWin = getMainWindow();
    if (mainWin) {
      mainWin.webContents.once('did-finish-load', () => {
        setTimeout(() => {
          void updaterService.checkForUpdates();
        }, 2500);
      });
    }

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
