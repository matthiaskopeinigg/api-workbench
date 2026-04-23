/**
 * Thin wrapper around `electron-updater` that:
 *  - Streams a single normalized `{ state, info }` status object to the renderer.
 *  - In dev (unpackaged), checks GitHub releases against app.getVersion(); install/download stay disabled.
 *  - Exposes a tiny imperative surface (check / download / install) for the IPC layer.
 */

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
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

/**
 * Tag-only or incomplete GitHub releases: no latest.yml / beta.yml in artifacts.
 * Treat as "no update to apply" so the UI does not show a global error banner.
 */
function isMissingUpdateChannelFileError(err) {
    const raw = err && (err.message || err.stack) ? `${err.message || ''} ${err.stack || ''}` : String(err || '');
    const msg = raw.toLowerCase();
    return (
        /cannot find .*\.yml/i.test(raw) ||
        /channel_file_not_found/i.test(msg) ||
        (/latest\.yml|beta\.yml|alpha\.yml/.test(msg) && /404|not found/.test(msg))
    );
}

function pushMissingChannelAsNoUpdate() {
    pushStatus(STATE.NOT_AVAILABLE, { noReleaseChannel: true });
}

function getCurrentVersion() {
    return app.getVersion();
}

function isSupported() {
    return !!autoUpdater && app.isPackaged;
}

function readGithubRepoFromPackageJson() {
    try {
        const pkgPath = path.join(__dirname, '../../package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const pub = pkg.build?.publish;
        const entry = Array.isArray(pub) ? pub[0] : pub;
        if (entry?.provider === 'github' && entry.owner && entry.repo) {
            return { owner: entry.owner, repo: entry.repo };
        }
    } catch (_) {
        /* fall through */
    }
    return { owner: 'matthiaskopeinigg', repo: 'api-workbench' };
}

/** @returns {Promise<{ ok: boolean, statusCode: number, body: string }>} */
function httpsGet(url, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const req = https.get(
            url,
            {
                headers: {
                    Accept: 'application/vnd.github+json',
                    'User-Agent': 'API-Workbench-UpdateCheck',
                },
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode || 0, body: data });
                });
            },
        );
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            reject(new Error('Request timed out'));
        });
        req.on('error', reject);
    });
}

/**
 * Parse semver-ish tags (e.g. 1.0.0-beta.18). Returns null if unrecognized.
 * @param {string} raw
 */
function parseVersionTag(raw) {
    const s = String(raw).replace(/^v/i, '').trim();
    const m = s.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?$/);
    if (!m) return null;
    return {
        major: +m[1],
        minor: +m[2],
        patch: +m[3],
        prerelease: m[4] || null,
    };
}

/** @returns {number} positive if a > b */
function compareVersionTags(a, b) {
    const pa = parseVersionTag(a);
    const pb = parseVersionTag(b);
    if (!pa || !pb) return String(a).localeCompare(String(b));
    if (pa.major !== pb.major) return pa.major - pb.major;
    if (pa.minor !== pb.minor) return pa.minor - pb.minor;
    if (pa.patch !== pb.patch) return pa.patch - pb.patch;
    if (!pa.prerelease && !pb.prerelease) return 0;
    if (!pa.prerelease) return 1;
    if (!pb.prerelease) return -1;
    const betaA = /^beta\.(\d+)$/i.exec(pa.prerelease);
    const betaB = /^beta\.(\d+)$/i.exec(pb.prerelease);
    if (betaA && betaB) return parseInt(betaA[1], 10) - parseInt(betaB[1], 10);
    return pa.prerelease.localeCompare(pb.prerelease);
}

/**
 * Unpackaged builds: compare app version to published GitHub releases (no electron-updater feed).
 */
async function checkGitHubReleasesForDev() {
    const { owner, repo } = readGithubRepoFromPackageJson();
    const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=15`;
    const res = await httpsGet(url);
    if (!res.ok) {
        throw new Error(`GitHub releases request failed (${res.statusCode})`);
    }
    let arr;
    try {
        arr = JSON.parse(res.body);
    } catch {
        throw new Error('Invalid response from GitHub releases API');
    }
    if (!Array.isArray(arr) || arr.length === 0) {
        throw new Error('No releases returned from GitHub');
    }
    let bestTag = null;
    let bestRelease = null;
    for (const r of arr) {
        if (r.draft) continue;
        const tag = String(r.tag_name || '').replace(/^v/i, '').trim();
        if (!tag) continue;
        if (bestTag == null || compareVersionTags(tag, bestTag) > 0) {
            bestTag = tag;
            bestRelease = r;
        }
    }
    if (!bestTag) {
        throw new Error('No published release tags found');
    }
    const current = getCurrentVersion();
    const cmp = compareVersionTags(bestTag, current);
    return {
        remoteVersion: bestTag,
        current,
        newer: cmp > 0,
        releaseNotes: bestRelease?.body || null,
    };
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
    if (!app.isPackaged) {
        pushStatus(STATE.IDLE, { devReadOnly: true });
        logInfo('Updater: development build — GitHub version checks enabled; in-app install disabled');
        return;
    }
    if (!autoUpdater) {
        pushStatus(STATE.DISABLED, { reason: 'electron-updater not installed' });
        return;
    }

    // Download in the background as soon as an update is found (no manual “Download” step).
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    // Stable channel: only non–pre-release GitHub releases (future betas stay off the default feed).
    autoUpdater.allowPrerelease = false;

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
        if (isMissingUpdateChannelFileError(err)) {
            logInfo('Auto-updater: no channel file in release (treating as no update)', err?.message || '');
            pushMissingChannelAsNoUpdate();
            return;
        }
        logError('Auto-updater error', err);
        pushStatus(STATE.ERROR, { message: err?.message || String(err) });
    });

    logInfo('Updater service initialized');
}

async function checkForUpdates() {
    if (!app.isPackaged) {
        try {
            pushStatus(STATE.CHECKING);
            const result = await checkGitHubReleasesForDev();
            if (result.newer) {
                pushStatus(STATE.AVAILABLE, {
                    version: result.remoteVersion,
                    releaseNotes: result.releaseNotes,
                    devPreviewOnly: true,
                });
            } else {
                pushStatus(STATE.NOT_AVAILABLE, {
                    version: result.remoteVersion,
                    devReadOnly: true,
                });
            }
        } catch (err) {
            logError('Dev GitHub update check failed', err);
            pushStatus(STATE.ERROR, { message: err?.message || String(err) });
        }
        return getStatus();
    }

    if (!autoUpdater) return getStatus();

    try {
        await autoUpdater.checkForUpdates();
    } catch (err) {
        if (isMissingUpdateChannelFileError(err)) {
            logInfo('checkForUpdates: no channel file in release', err?.message || '');
            pushMissingChannelAsNoUpdate();
        } else {
            logError('checkForUpdates failed', err);
            pushStatus(STATE.ERROR, { message: err?.message || String(err) });
        }
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
