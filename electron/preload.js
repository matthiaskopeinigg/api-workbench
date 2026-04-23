const { contextBridge, ipcRenderer, app } = require('electron');

const awElectron = {
  /** True when running from a built app (installer/portable), not `electron .` dev. */
  isPackaged: app.isPackaged,
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  getCollections: () => ipcRenderer.invoke('get-collections'),
  saveCollections: (collections) => ipcRenderer.invoke('save-collections', collections),

  getEnvironments: () => ipcRenderer.invoke('get-environments'),
  saveEnvironments: (environments) => ipcRenderer.invoke('save-environments', environments),

  getSession: (key) => ipcRenderer.invoke('get-session', key),
  saveSession: (key, value) => ipcRenderer.invoke('save-session', key, value),

  openFileDialog: (extensions = []) => ipcRenderer.invoke('open-file-dialog', extensions),
  openFilesDialog: (extensions = []) => ipcRenderer.invoke('open-files-dialog', extensions),
  readImportFolder: (options) => ipcRenderer.invoke('read-import-folder', options),
  openDirectoryDialog: () => ipcRenderer.invoke('open-directory-dialog'),
  writeFilesToDirectory: (options) => ipcRenderer.invoke('write-files-to-directory', options),
  saveFileDialog: (options) => ipcRenderer.invoke('save-file-dialog', options),
  pickFilePath: (options) => ipcRenderer.invoke('pick-file-path', options),
  saveResponseBody: (payload) => ipcRenderer.invoke('save-response-body', payload),

  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),

  httpRequest: (request) => ipcRenderer.invoke('http-request', request),
  getAllCookies: () => ipcRenderer.invoke('cookies:get-all'),
  deleteCookie: (domain, path, name) => ipcRenderer.invoke('cookies:delete', domain, path, name),
  clearAllCookies: () => ipcRenderer.invoke('cookies:clear-all'),
  runScript: (code, context) => ipcRenderer.invoke('scripts:run', { code, context }),
  appReady: () => ipcRenderer.send('app-ready'),

  getOAuth2Token: (config) => ipcRenderer.invoke('get-oauth2-token', config),
  exchangeOAuth2Code: (config) => ipcRenderer.invoke('exchange-oauth2-code', config),
  getOAuth2ClientCredentials: (config) => ipcRenderer.invoke('get-oauth2-client-credentials', config),

  getUpdaterStatus: () => ipcRenderer.invoke('updater:get-status'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.send('updater:install'),
  onUpdaterStatus: (listener) => {
    const wrapped = (_event, status) => listener(status);
    ipcRenderer.on('updater:status', wrapped);
    return () => ipcRenderer.removeListener('updater:status', wrapped);
  },

  mockStart: (port) => ipcRenderer.invoke('mock:start', { port }),
  mockStop: () => ipcRenderer.invoke('mock:stop'),
  mockRestart: () => ipcRenderer.invoke('mock:restart'),
  mockStatus: () => ipcRenderer.invoke('mock:status'),
  mockGetOptions: () => ipcRenderer.invoke('mock:options:get'),
  mockSetOptions: (partial) => ipcRenderer.invoke('mock:options:set', partial),
  mockRegister: (payload) => ipcRenderer.invoke('mock:register', payload),
  mockUnregister: (requestId) => ipcRenderer.invoke('mock:unregister', { requestId }),
  mockClear: () => ipcRenderer.invoke('mock:clear'),
  mockHitsList: () => ipcRenderer.invoke('mock:hits:list'),
  mockHitsClear: () => ipcRenderer.invoke('mock:hits:clear'),
  mockStandaloneRegister: (endpoint) => ipcRenderer.invoke('mock:standalone:register', endpoint),
  mockStandaloneUnregister: (id) => ipcRenderer.invoke('mock:standalone:unregister', { id }),
  mockStandaloneList: () => ipcRenderer.invoke('mock:standalone:list'),
  onMockHits: (listener) => {
    const wrapped = (_event, batch) => listener(batch);
    ipcRenderer.on('mock:hits', wrapped);
    return () => ipcRenderer.removeListener('mock:hits', wrapped);
  },

  historyAppend: (entry) => ipcRenderer.invoke('history:append', entry),
  historyList: (requestId, limit) => ipcRenderer.invoke('history:list', { requestId, limit }),
  historyGet: (id) => ipcRenderer.invoke('history:get', { id }),
  historyClear: (requestId) => ipcRenderer.invoke('history:clear', { requestId }),

  wsConnect: (payload) => ipcRenderer.invoke('ws:connect', payload),
  wsSend: (payload) => ipcRenderer.invoke('ws:send', payload),
  wsClose: (payload) => ipcRenderer.invoke('ws:close', payload),
  onWsEvent: (connectionId, listener) => {
    const channel = `ws:event:${connectionId}`;
    const wrapped = (_event, data) => listener(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },

  testingList: (kind) => ipcRenderer.invoke(`testing:${kind}:list`),
  testingSave: (kind, items) => ipcRenderer.invoke(`testing:${kind}:save`, items),

  loadStart: (config) => ipcRenderer.invoke('load:start', config),
  loadCancel: (runId) => ipcRenderer.invoke('load:cancel', { runId }),
  loadStatus: (runId) => ipcRenderer.invoke('load:status', { runId }),
  onLoadProgress: (runId, listener) => {
    const channel = `load:progress:${runId}`;
    const wrapped = (_event, data) => listener(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  onLoadDone: (runId, listener) => {
    const channel = `load:done:${runId}`;
    const wrapped = (_event, data) => listener(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },

  getStorageInfo: () => ipcRenderer.invoke('storage:get-info'),
  openUserDataDirectory: () => ipcRenderer.invoke('storage:open-user-data'),
  openConfigMarkerDirectory: () => ipcRenderer.invoke('storage:open-marker-dir'),
  chooseDataDirectory: () => ipcRenderer.invoke('storage:choose-data-directory'),
  resetDataDirectoryOverride: () => ipcRenderer.invoke('storage:reset-data-directory-override'),
};

contextBridge.exposeInMainWorld('awElectron', awElectron);
