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
    handleOpenFilePathDialog,
    handleSaveFileDialog,
    handleSaveResponseBody,
};

