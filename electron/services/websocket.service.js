const { logInfo, logError } = require('./logger.service');

let WebSocket;
try {
    WebSocket = require('ws');
} catch (err) {
    WebSocket = null;
}

/**
 * Per-connection state: the underlying `ws` client plus a ref to the renderer
 * WebContents that owns it (so we know where to forward frames). Keyed by a
 * caller-supplied `connectionId`.
 */
const connections = new Map();

function assertWsAvailable() {
    if (!WebSocket) {
        throw new Error('WebSocket support is unavailable: the `ws` module is not installed.');
    }
}

/**
 * Forward a lifecycle/frame event to the renderer that owns the connection.
 * If the sender is gone (window closed) we silently drop the event.
 */
function emit(connectionId, eventName, payload) {
    const entry = connections.get(connectionId);
    if (!entry || !entry.webContents || entry.webContents.isDestroyed()) return;
    try {
        entry.webContents.send(`ws:event:${connectionId}`, { type: eventName, ...payload });
    } catch (err) {
        logError('WebSocket event emit failed', err);
    }
}

/**
 * SSE connection — implemented on top of plain HTTP via `global.fetch` (Node
 * 18+) with a ReadableStream parser so we can share the same `ws:*` IPC shape
 * for frame delivery. We don't try to be a full EventSource implementation,
 * just enough to surface `data` / `event` lines to the renderer.
 */
async function openSse(connectionId, url, headers = {}, webContents) {
    let controller;
    try {
        controller = new AbortController();
        const resp = await fetch(url, {
            method: 'GET',
            headers: { Accept: 'text/event-stream', ...headers },
            signal: controller.signal,
        });
        if (!resp.ok) {
            emit(connectionId, 'error', { message: `SSE handshake failed: ${resp.status} ${resp.statusText}` });
            emit(connectionId, 'close', { code: resp.status, reason: resp.statusText });
            connections.delete(connectionId);
            return;
        }
        emit(connectionId, 'open', { protocol: 'sse' });
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const entry = connections.get(connectionId);
        if (entry) entry.abort = () => controller.abort();

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buffer.indexOf('\n\n')) >= 0) {
                const raw = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 2);
                const parsed = parseSseBlock(raw);
                emit(connectionId, 'message', {
                    direction: 'in',
                    data: parsed.data,
                    event: parsed.event,
                    id: parsed.id,
                    at: Date.now(),
                });
            }
        }
        emit(connectionId, 'close', { code: 1000, reason: 'Stream ended' });
    } catch (err) {
        if (err && err.name === 'AbortError') {
            emit(connectionId, 'close', { code: 1000, reason: 'Aborted' });
        } else {
            emit(connectionId, 'error', { message: err && err.message ? err.message : String(err) });
            emit(connectionId, 'close', { code: 1006, reason: 'SSE stream error' });
        }
    } finally {
        connections.delete(connectionId);
    }
}

function parseSseBlock(block) {
    const out = { data: '', event: 'message', id: undefined };
    const lines = block.split(/\r?\n/);
    const dataLines = [];
    for (const line of lines) {
        if (!line || line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'data') dataLines.push(value);
        else if (field === 'event') out.event = value;
        else if (field === 'id') out.id = value;
    }
    out.data = dataLines.join('\n');
    return out;
}

async function connect(event, payload) {
    const {
        connectionId,
        url,
        protocols,
        headers,
        mode, // 'ws' | 'sse'
    } = payload || {};
    if (!connectionId || !url) throw new Error('connectionId and url are required');

    if (connections.has(connectionId)) {
        throw new Error(`Connection ${connectionId} already exists`);
    }

    const webContents = event.sender;
    const entry = { webContents, url, mode: mode || 'ws' };
    connections.set(connectionId, entry);

    if ((mode || 'ws') === 'sse') {
        openSse(connectionId, url, headers || {}, webContents).catch(err => {
            logError('SSE connect failed', err);
        });
        return { connectionId };
    }

    assertWsAvailable();
    let ws;
    try {
        ws = new WebSocket(url, protocols && protocols.length ? protocols : undefined, {
            headers: headers || {},
        });
    } catch (err) {
        connections.delete(connectionId);
        throw err;
    }

    entry.ws = ws;
    ws.on('open', () => emit(connectionId, 'open', { protocol: ws.protocol || '' }));
    ws.on('message', (data, isBinary) => {
        let text;
        let binaryBase64;
        if (isBinary) {
            const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
            binaryBase64 = buf.toString('base64');
        } else {
            text = data.toString('utf8');
        }
        emit(connectionId, 'message', {
            direction: 'in',
            data: text,
            binaryBase64,
            isBinary: !!isBinary,
            at: Date.now(),
        });
    });
    ws.on('ping', () => emit(connectionId, 'control', { kind: 'ping', at: Date.now() }));
    ws.on('pong', () => emit(connectionId, 'control', { kind: 'pong', at: Date.now() }));
    ws.on('error', (err) => {
        emit(connectionId, 'error', { message: err && err.message ? err.message : String(err) });
    });
    ws.on('close', (code, reason) => {
        emit(connectionId, 'close', {
            code: code || 1005,
            reason: reason ? reason.toString('utf8') : '',
            at: Date.now(),
        });
        connections.delete(connectionId);
    });

    logInfo('WebSocket connect', { connectionId, url });
    return { connectionId };
}

async function send(_event, payload) {
    const { connectionId, data, isBinary } = payload || {};
    const entry = connections.get(connectionId);
    if (!entry || !entry.ws) throw new Error(`Connection ${connectionId} not open`);
    const frame = isBinary ? Buffer.from(data, 'base64') : data;
    await new Promise((resolve, reject) => {
        entry.ws.send(frame, { binary: !!isBinary }, (err) => (err ? reject(err) : resolve()));
    });
    emit(connectionId, 'message', {
        direction: 'out',
        data: isBinary ? undefined : data,
        binaryBase64: isBinary ? data : undefined,
        isBinary: !!isBinary,
        at: Date.now(),
    });
    return { ok: true };
}

async function close(_event, payload) {
    const { connectionId, code, reason } = payload || {};
    const entry = connections.get(connectionId);
    if (!entry) return { ok: true };
    try {
        if (entry.ws) {
            entry.ws.close(code || 1000, reason || '');
        } else if (entry.abort) {
            entry.abort();
        }
    } catch (err) {
        logError('WebSocket close failed', err);
    }
    return { ok: true };
}

function closeAllForWebContents(webContents) {
    for (const [id, entry] of connections) {
        if (entry.webContents === webContents) {
            try {
                if (entry.ws) entry.ws.close(1001, 'Renderer gone');
                else if (entry.abort) entry.abort();
            } catch (err) {
                logError('WebSocket cleanup failed', err);
            }
            connections.delete(id);
        }
    }
}

module.exports = {
    connect,
    send,
    close,
    closeAllForWebContents,
};
