const { dialog } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const { logInfo, logError } = require('./logger.service');

async function handleOpenFileDialog(extensions) {
    const result = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters: [{ name: "Files", extensions: extensions }],
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    const filePath = result.filePaths[0];
    const fileData = await fs.readFile(filePath, 'utf-8');
    const ext = path.extname(filePath).toLowerCase();
    const out = { path: filePath, rawText: fileData };

    if (ext === '.json') {
        try {
            out.content = JSON.parse(fileData);
        } catch (err) {
            await logError(`Failed to parse JSON file: ${filePath}`, err);
        }
    }

    logInfo(`File opened successfully: ${filePath}`);
    return out;
}

const DEFAULT_IMPORT_IGNORE_DIR_NAMES = new Set(['node_modules', '.git', 'dist', 'build', '.next']);

/**
 * @param {string[]} extensions - e.g. ['json','yaml','yml'] (no leading dots)
 * @returns {Promise<{ files: Array<{ path: string, rawText: string, content?: unknown }> } | null>}
 */
async function handleOpenFilesDialog(extensions) {
    const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Files', extensions: extensions && extensions.length ? extensions : ['json', 'yaml', 'yml'] }],
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    const files = [];
    for (const filePath of result.filePaths) {
        const fileData = await fs.readFile(filePath, 'utf-8');
        const ext = path.extname(filePath).toLowerCase();
        const entry = { path: filePath, rawText: fileData };
        if (ext === '.json') {
            try {
                entry.content = JSON.parse(fileData);
            } catch (err) {
                await logError(`Failed to parse JSON file: ${filePath}`, err);
            }
        }
        files.push(entry);
    }
    logInfo(`Open files dialog: ${files.length} file(s)`);
    return { files };
}

/**
 * @param {object} [options]
 * @param {string} options.rootDir
 * @param {string[]} [options.extensions] - default ['json','yaml','yml']
 * @param {number} [options.maxFiles] - default 500
 * @param {boolean} [options.recursive] - default false
 * @param {number} [options.maxDepth] - default 2 when recursive; 0 = only root
 * @param {string[]} [options.ignoreDirNames]
 * @returns {Promise<{ files: Array<{ path: string, rawText: string, content?: unknown }> } | null>}
 */
async function handleReadImportFolder(options = {}) {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;

    const rootDir = result.filePaths[0];
    const exts = (options.extensions && options.extensions.length
        ? options.extensions
        : ['json', 'yaml', 'yml']).map((e) => e.toLowerCase().replace(/^\./, ''));
    const maxFiles = typeof options.maxFiles === 'number' && options.maxFiles > 0 ? options.maxFiles : 500;
    const recursive = Boolean(options.recursive);
    const maxDepth = typeof options.maxDepth === 'number' && options.maxDepth >= 0 ? options.maxDepth : 2;
    const ignore = new Set(
        Array.isArray(options.ignoreDirNames) && options.ignoreDirNames.length
            ? options.ignoreDirNames
            : [...DEFAULT_IMPORT_IGNORE_DIR_NAMES]
    );
    const awPath = path.join(rootDir, '.awignore');
    try {
        const aw = await fs.readFile(awPath, 'utf-8');
        for (const line of aw.split(/\r?\n/)) {
            const t = line.split('#')[0].trim();
            if (t) {
                ignore.add(t);
            }
        }
    } catch {
        /* no .awignore */
    }

    const matchesExt = (filePath) => {
        const e = path.extname(filePath).toLowerCase().replace(/^\./, '');
        return exts.includes(e);
    };

    /** @type {string[]} */
    const relPaths = [];

    /**
     * @param {string} dir
     * @param {number} currentDepth - 0 = user-selected folder
     */
    async function walk(dir, currentDepth) {
        if (relPaths.length >= maxFiles) return;
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const ent of entries) {
            if (relPaths.length >= maxFiles) return;
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                if (!recursive) continue;
                if (ignore.has(ent.name)) continue;
                if (currentDepth >= maxDepth) continue;
                await walk(full, currentDepth + 1);
            } else if (ent.isFile() && matchesExt(full)) {
                relPaths.push(full);
            }
        }
    }

    await walk(rootDir, 0);
    if (relPaths.length === 0) {
        logInfo(`Import folder: no matching files in ${rootDir}`);
        return { files: [] };
    }

    const files = [];
    for (const filePath of relPaths) {
        if (files.length >= maxFiles) break;
        const fileData = await fs.readFile(filePath, 'utf-8');
        const ext = path.extname(filePath).toLowerCase();
        const entry = { path: filePath, rawText: fileData };
        if (ext === '.json') {
            try {
                entry.content = JSON.parse(fileData);
            } catch (err) {
                await logError(`Failed to parse JSON file: ${filePath}`, err);
            }
        }
        files.push(entry);
    }
    logInfo(`Read import folder: ${files.length} file(s) from ${rootDir}`);
    return { files };
}

/**
 * @returns {Promise<string | null>} chosen directory path
 */
async function handleOpenDirectoryDialog() {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select folder',
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
}

/**
 * @param {object} options
 * @param {string} options.dir
 * @param {Array<{ name: string, data: string }>} options.files - name = relative or base filename
 * @returns {Promise<{ ok: boolean, written: number, error?: string }>}
 */
async function handleWriteFilesToDirectory(options) {
    const { dir, files: fileList } = options || {};
    if (!dir || !Array.isArray(fileList) || !fileList.length) {
        return { ok: false, written: 0, error: 'Invalid arguments' };
    }
    let written = 0;
    try {
        await fs.mkdir(dir, { recursive: true });
        for (const f of fileList) {
            if (!f || typeof f.name !== 'string' || f.data === undefined) continue;
            const safe = path.basename(f.name);
            if (!safe || safe === '.' || safe === '..') continue;
            const target = path.join(dir, safe);
            await fs.writeFile(target, f.data, 'utf-8');
            written += 1;
        }
    } catch (err) {
        await logError('writeFilesToDirectory', err);
        return { ok: false, written, error: err.message || 'Write failed' };
    }
    logInfo(`Wrote ${written} file(s) to ${dir}`);
    return { ok: true, written };
}

/**
 * Prompt for a file path without reading its contents. Used for attaching
 * files to request bodies (form-data, binary) where the renderer only needs
 * the path; main reads the bytes at send-time.
 */
async function handleOpenFilePathDialog(options = {}) {
    const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        ...(options || {})
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    try {
        const stat = await fs.stat(filePath);
        return { path: filePath, size: stat.size };
    } catch (err) {
        await logError(`Failed to stat file: ${filePath}`, err);
        return { path: filePath };
    }
}

async function handleSaveFileDialog(options) {
    const { defaultName = "data.json", content, title = "Export Data" } = options;

    const result = await dialog.showSaveDialog({
        title,
        defaultPath: defaultName,
        filters: [{ name: "JSON", extensions: ["json"] }],
    });

    if (result.canceled || !result.filePath) return null;

    try {
        await fs.writeFile(result.filePath, JSON.stringify(content, null, 2), "utf-8");
        logInfo(`File saved successfully: ${result.filePath}`);
        return result.filePath;
    } catch (err) {
        await logError(`Failed to save file: ${result.filePath}`, err);
        return null;
    }
}

/**
 * Write a response body to disk. Accepts either a plain-text body or a
 * base64-encoded binary body (matching the shape we return from
 * http.service.js). Prompts the user for the output location.
 */
async function handleSaveResponseBody(payload) {
    const { body, isBinary, binaryBase64, defaultName = 'response', contentType } = payload || {};
    const result = await dialog.showSaveDialog({
        title: 'Save response',
        defaultPath: defaultName
    });
    if (result.canceled || !result.filePath) return null;
    try {
        if (isBinary && binaryBase64) {
            await fs.writeFile(result.filePath, Buffer.from(binaryBase64, 'base64'));
        } else {
            const text = typeof body === 'string' ? body : JSON.stringify(body ?? '', null, 2);
            await fs.writeFile(result.filePath, text, 'utf-8');
        }
        logInfo(`Response saved: ${result.filePath}${contentType ? ' (' + contentType + ')' : ''}`);
        return result.filePath;
    } catch (err) {
        await logError(`Failed to save response body: ${result.filePath}`, err);
        return null;
    }
}

module.exports = {
    handleOpenFileDialog,
    handleOpenFilesDialog,
    handleReadImportFolder,
    handleOpenDirectoryDialog,
    handleWriteFilesToDirectory,
    handleOpenFilePathDialog,
    handleSaveFileDialog,
    handleSaveResponseBody,
};

