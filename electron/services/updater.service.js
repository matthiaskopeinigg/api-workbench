/**
 * Thin wrapper around `electron-updater` that:
 *  - Streams a single normalized `{ state, info }` status object to the renderer.
 *  - Is safe to require in dev mode (all operations become no-ops so launching `npm run dev` still works).
 *  - Exposes a tiny imperative surface (check / download / install) for the IPC layer.
 */

const { app } = require('electron');
const { logInfo, logError } = require('./logger.service');
const { getMainWindow } = require('./window.service');

let autoUpdater = null;
try {
    autoUpdater = require('electron-updater').autoUpdater;
} catch (err) {
    logError('electron-updater is not installed', err);
}

const STATE = Object.freeze({
    IDLE: 'idle',
    CHECKING: 'checking',
    AVAILABLE: 'available',
    NOT_AVAILABLE: 'not-available',
    DOWNLOADING: 'downloading',
    DOWNLOADED: 'downloaded',
    ERROR: 'error',
    DISABLED: 'disabled',
});

let lastStatus = { state: STATE.IDLE, info: null };

function getCurrentVersion() {
    return app.getVersion();
}

function isSupported() {
    return !!autoUpdater && app.isPackaged;
}

function getStatus() {
    return {
        ...lastStatus,
        currentVersion: getCurrentVersion(),
        supported: isSupported(),
    };
}

function pushStatus(state, info = null) {
    lastStatus = { state, info };
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
        win.webContents.send('updater:status', getStatus());
    }
}

function init() {
    if (!autoUpdater) {
        pushStatus(STATE.DISABLED, { reason: 'electron-updater not installed' });
        return;
    }
    if (!app.isPackaged) {
        pushStatus(STATE.DISABLED, { reason: 'Auto-update is only available in packaged builds.' });
        return;
    }

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => pushStatus(STATE.CHECKING));
    autoUpdater.on('update-available', (info) =>
        pushStatus(STATE.AVAILABLE, { version: info.version, releaseNotes: info.releaseNotes, releaseDate: info.releaseDate }),
    );
    autoUpdater.on('update-not-available', (info) =>
        pushStatus(STATE.NOT_AVAILABLE, { version: info?.version ?? null }),
    );
    autoUpdater.on('download-progress', (progress) =>
        pushStatus(STATE.DOWNLOADING, {
            percent: Math.round(progress.percent ?? 0),
            bytesPerSecond: progress.bytesPerSecond ?? 0,
            transferred: progress.transferred ?? 0,
            total: progress.total ?? 0,
        }),
    );
    autoUpdater.on('update-downloaded', (info) =>
        pushStatus(STATE.DOWNLOADED, { version: info.version, releaseNotes: info.releaseNotes }),
    );
    autoUpdater.on('error', (err) => {
        logError('Auto-updater error', err);
        pushStatus(STATE.ERROR, { message: err?.message || String(err) });
    });

    logInfo('Updater service initialized');
}

async function checkForUpdates() {
    if (!isSupported()) return getStatus();
    try {
        await autoUpdater.checkForUpdates();
    } catch (err) {
        logError('checkForUpdates failed', err);
        pushStatus(STATE.ERROR, { message: err?.message || String(err) });
    }
    return getStatus();
}

async function downloadUpdate() {
    if (!isSupported()) return getStatus();
    try {
        await autoUpdater.downloadUpdate();
    } catch (err) {
        logError('downloadUpdate failed', err);
        pushStatus(STATE.ERROR, { message: err?.message || String(err) });
    }
    return getStatus();
}

function quitAndInstall() {
    if (!isSupported()) return;
    try {
        // Windows NSIS: first arg = silent install (no setup wizard). Second = relaunch app when done.
        // macOS ignores the silent flag; DMG flow unchanged.
        setImmediate(() => autoUpdater.quitAndInstall(true, true));
    } catch (err) {
        logError('quitAndInstall failed', err);
        pushStatus(STATE.ERROR, { message: err?.message || String(err) });
    }
}

module.exports = {
    init,
    getStatus,
    checkForUpdates,
    downloadUpdate,
    quitAndInstall,
    STATE,
};
