const { BrowserWindow, app, screen } = require('electron');
const path = require('path');
const { logInfo, logError } = require('./logger.service');
const { getFirstPaintBackgroundColor } = require('./first-paint-theme');
const store = require('./store.service');

let mainWindow = null;
let splashWindow = null;
const isDev = !app.isPackaged;

const WINDOW_BOUNDS_KEY = 'windowBounds';
const DEFAULT_BOUNDS = { width: 1250, height: 870, maximized: false };

let saveWindowBoundsHandle = null;

function loadSavedBounds() {
    try {
        const saved = store.getSession(WINDOW_BOUNDS_KEY);
        if (!saved || typeof saved !== 'object') return null;
        const { x, y, width, height, maximized } = saved;
        if (typeof width !== 'number' || typeof height !== 'number') return null;
        return { x, y, width, height, maximized: !!maximized };
    } catch (err) {
        logError('Failed to load saved window bounds', err);
        return null;
    }
}

function clampBoundsToVisibleDisplay(bounds) {
    if (typeof bounds.x !== 'number' || typeof bounds.y !== 'number') return bounds;
    const displays = screen.getAllDisplays();
    const fits = displays.some((display) => {
        const { x, y, width, height } = display.workArea;
        return (
            bounds.x >= x &&
            bounds.y >= y &&
            bounds.x + bounds.width <= x + width &&
            bounds.y + bounds.height <= y + height
        );
    });
    if (fits) return bounds;
    const { x: _x, y: _y, ...rest } = bounds;
    return rest;
}

function persistBounds(window) {
    if (!window || window.isDestroyed()) return;
    const isMaximized = window.isMaximized();
    const bounds = isMaximized ? (window.getNormalBounds?.() ?? window.getBounds()) : window.getBounds();
    try {
        store.setSession(WINDOW_BOUNDS_KEY, { ...bounds, maximized: isMaximized });
    } catch (err) {
        logError('Failed to persist window bounds', err);
    }
}

function schedulePersistBounds(window) {
    if (saveWindowBoundsHandle) clearTimeout(saveWindowBoundsHandle);
    saveWindowBoundsHandle = setTimeout(() => {
        saveWindowBoundsHandle = null;
        persistBounds(window);
    }, 250);
}

function resolveAsset(relativePath) {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'app.asar', 'public', relativePath);
    }
    return path.join(app.getAppPath(), 'public', relativePath);
}

function resolveWindowIcon() {
    if (process.platform === 'win32') return resolveAsset('icon.ico');
    return resolveAsset('logo.png');
}

function createSplashWindow() {
    splashWindow = new BrowserWindow({
        width: 340,
        height: 340,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        icon: resolveWindowIcon(),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    const splashPath = path.join(__dirname, '..', 'splash.html');
    splashWindow.loadFile(splashPath);
    logInfo('Splash window created');
}

async function createWindow() {
    createSplashWindow();

    const saved = loadSavedBounds();
    const placement = clampBoundsToVisibleDisplay({
        width: saved?.width ?? DEFAULT_BOUNDS.width,
        height: saved?.height ?? DEFAULT_BOUNDS.height,
        ...(typeof saved?.x === 'number' && typeof saved?.y === 'number'
            ? { x: saved.x, y: saved.y }
            : {}),
    });

    mainWindow = new BrowserWindow({
        ...placement,
        minWidth: 1000,
        minHeight: 700,
        frame: false,
        titleBarStyle: "hidden",
        trafficLightPosition: { x: 12, y: 10 },
        icon: resolveWindowIcon(),
        show: false, 
        backgroundColor: getFirstPaintBackgroundColor(),
        webPreferences: {
            webSecurity: false,
            preload: path.join(__dirname, '..', 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    if (saved?.maximized) {
        mainWindow.maximize();
    }

    mainWindow.on('resize', () => schedulePersistBounds(mainWindow));
    mainWindow.on('move', () => schedulePersistBounds(mainWindow));
    mainWindow.on('maximize', () => persistBounds(mainWindow));
    mainWindow.on('unmaximize', () => persistBounds(mainWindow));
    mainWindow.on('close', () => persistBounds(mainWindow));

    mainWindow.once('ready-to-show', () => {

        if (isDev) mainWindow.webContents.openDevTools();
    });

    if (isDev) {
        const devUrl = 'http://127.0.0.1:4200/';
        const loadDevUrl = () => {
            mainWindow.loadURL(devUrl).catch((e) => {
                logInfo('Dev server not ready, retrying loadURL in 1s', e && e.message);
                setTimeout(loadDevUrl, 1000);
            });
        };
        loadDevUrl();
        // If renderer never calls appReady (stuck init / IPC), don't leave the user on the splash forever.
        setTimeout(() => {
            if (splashWindow) {
                logInfo('Dev: showing main window after wait for app-ready (15s safety)');
                showMainWindow();
            }
        }, 15000);
    } else {
        const indexPath = path.join(app.getAppPath(), "dist", "api-workbench", "browser", "index.html");
        mainWindow.loadFile(indexPath).catch(e => console.error('Failed to load file:', e));
    }

    mainWindow.setMenuBarVisibility(false);

    mainWindow.on("closed", () => {
        mainWindow = null;
    });

    logInfo('Main window created');
}

function showMainWindow() {
    if (splashWindow) {
        splashWindow.close();
        splashWindow = null;
    }
    if (mainWindow) {
        mainWindow.show();
    }
}

function getMainWindow() {
    return mainWindow;
}

module.exports = {
    createWindow,
    getMainWindow,
    showMainWindow
};

