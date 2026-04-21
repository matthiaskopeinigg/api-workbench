const { URL } = require('url');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const http2 = require('http2');
const tls = require('tls');
const zlib = require('zlib');
const fsp = require('fs').promises;
const net = require('net');
const { app } = require('electron');
const { logInfo, logError } = require('./logger.service');
const storeService = require('./store.service');
const { CookieJar, Cookie } = require('tough-cookie');

let SocksProxyAgent;
try {
    ({ SocksProxyAgent } = require('socks-proxy-agent'));
} catch (err) {
    SocksProxyAgent = null;
}

const TEXT_CONTENT_TYPE_REGEX = /(text\/|application\/(?:json|xml|xhtml\+xml|javascript|ecmascript|graphql|ld\+json|x-www-form-urlencoded|problem\+json|problem\+xml)|\+json|\+xml)/i;

/**
 * Pipe a Node IncomingMessage through the matching decompressor based on the
 * `Content-Encoding` header. Returns the stream to read bytes from. Unknown
 * encodings fall back to the raw response.
 */
function decodeResponseStream(res) {
    const encoding = (res.headers['content-encoding'] || '').toLowerCase();
    if (!encoding || encoding === 'identity') return res;
    try {
        if (encoding === 'gzip' || encoding === 'x-gzip') {
            return res.pipe(zlib.createGunzip({ flush: zlib.constants.Z_SYNC_FLUSH }));
        }
        if (encoding === 'deflate') {
            return res.pipe(zlib.createInflate({ flush: zlib.constants.Z_SYNC_FLUSH }));
        }
        if (encoding === 'br') {
            return res.pipe(zlib.createBrotliDecompress());
        }
    } catch (err) {
        logError(`Failed to initialise decompressor for ${encoding}`, err);
    }
    return res;
}

function isTextContentType(contentType) {
    if (!contentType) {
        return true;
    }
    return TEXT_CONTENT_TYPE_REGEX.test(contentType);
}

/**
 * Pick a sensible content-type for a file upload when the user didn't specify one.
 * A very small lookup keeps this dependency-free; unknown extensions fall back
 * to application/octet-stream.
 */
function guessContentTypeFromPath(filePath) {
    const ext = (path.extname(filePath) || '').toLowerCase();
    switch (ext) {
        case '.json': return 'application/json';
        case '.xml': return 'application/xml';
        case '.html':
        case '.htm': return 'text/html';
        case '.txt': return 'text/plain';
        case '.csv': return 'text/csv';
        case '.pdf': return 'application/pdf';
        case '.png': return 'image/png';
        case '.jpg':
        case '.jpeg': return 'image/jpeg';
        case '.gif': return 'image/gif';
        case '.webp': return 'image/webp';
        case '.svg': return 'image/svg+xml';
        case '.zip': return 'application/zip';
        default: return 'application/octet-stream';
    }
}

/**
 * Build the HTTP body payload from a structured envelope. Returns `{ data, contentType }`
 * where `data` is a Buffer and `contentType` (optional) is the header value the
 * caller should set when the user didn't override Content-Type. Supports
 * form-data (multipart), urlencoded and binary modes.
 */
async function buildStructuredBody(body) {
    if (!body || typeof body !== 'object' || !body.mode) {
        return null;
    }
    if (body.mode === 'urlencoded') {
        const params = new URLSearchParams();
        for (const f of body.urlencoded || []) {
            if (!f || f.enabled === false) continue;
            const key = (f.key || '').trim();
            if (!key) continue;
            params.append(key, f.value ?? '');
        }
        return {
            data: Buffer.from(params.toString(), 'utf8'),
            contentType: 'application/x-www-form-urlencoded'
        };
    }
    if (body.mode === 'binary') {
        const filePath = body.binary && body.binary.filePath;
        if (!filePath) return { data: Buffer.alloc(0) };
        const data = await fsp.readFile(filePath);
        return {
            data,
            contentType: body.binary.contentType || guessContentTypeFromPath(filePath)
        };
    }
    if (body.mode === 'form-data') {
        const boundary = '----AWFormBoundary' + Math.random().toString(16).slice(2) + Date.now().toString(16);
        const chunks = [];
        for (const f of body.form || []) {
            if (!f || f.enabled === false) continue;
            const key = (f.key || '').trim();
            if (!key) continue;
            if (f.type === 'file' && f.filePath) {
                const fileData = await fsp.readFile(f.filePath);
                const fileName = path.basename(f.filePath);
                const fileCt = f.contentType || guessContentTypeFromPath(f.filePath);
                chunks.push(Buffer.from(
                    `--${boundary}\r\n` +
                    `Content-Disposition: form-data; name="${key}"; filename="${fileName}"\r\n` +
                    `Content-Type: ${fileCt}\r\n\r\n`,
                    'utf8'
                ));
                chunks.push(fileData);
                chunks.push(Buffer.from('\r\n', 'utf8'));
            } else {
                chunks.push(Buffer.from(
                    `--${boundary}\r\n` +
                    `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
                    (f.value ?? '') + '\r\n',
                    'utf8'
                ));
            }
        }
        chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
        return {
            data: Buffer.concat(chunks),
            contentType: `multipart/form-data; boundary=${boundary}`
        };
    }
    return null;
}
let cookieJar;

function tryMigrateLegacyElectronStoreCookieJar() {
    const legacyPath = path.join(app.getPath('userData'), 'config.json');
    if (!fs.existsSync(legacyPath)) {
        return;
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
        if (parsed && parsed.cookieJar) {
            storeService.setCookieJarJson(JSON.stringify(parsed.cookieJar));
            const archived = `${legacyPath}.migrated.${Date.now()}.bak`;
            fs.renameSync(legacyPath, archived);
            logInfo('Migrated cookie jar from legacy electron-store config.json', { archived });
        }
    } catch (e) {
        logError('Legacy cookie jar migration failed', e);
    }
}

async function init() {
    let cookieJarStore = null;
    const fromDb = storeService.getCookieJarJson();
    if (fromDb) {
        try {
            cookieJarStore = JSON.parse(fromDb);
        } catch (e) {
            logError('Failed to parse cookie jar from SQLite', e);
        }
    }
    if (!cookieJarStore) {
        tryMigrateLegacyElectronStoreCookieJar();
        const again = storeService.getCookieJarJson();
        if (again) {
            try {
                cookieJarStore = JSON.parse(again);
            } catch (e) {
                logError('Failed to parse cookie jar after migration', e);
            }
        }
    }
    if (cookieJarStore) {
        try {
            cookieJar = CookieJar.fromJSON(JSON.stringify(cookieJarStore));
        } catch (e) {
            logError('Failed to load cookie jar', e);
            cookieJar = new CookieJar();
        }
    } else {
        cookieJar = new CookieJar();
    }
}

function saveCookieJar() {
    if (cookieJar) {
        storeService.setCookieJarJson(JSON.stringify(cookieJar.toJSON()));
    }
}

async function getCookies(url) {
    return new Promise((resolve, reject) => {
        cookieJar.getCookieString(url, (err, cookies) => {
            if (err) return reject(err);
            resolve(cookies);
        });
    });
}

async function saveCookies(url, setCookieHeaders) {
    if (!setCookieHeaders) return;
    const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];

    for (const header of headers) {
        await new Promise((resolve, reject) => {
            cookieJar.setCookie(header, url, (err) => {
                if (err) return reject(err);
                resolve();
            });
        });
    }
    saveCookieJar();
}

async function getAllCookies() {
    return new Promise((resolve, reject) => {
        cookieJar.store.getAllCookies((err, cookies) => {
            if (err) return reject(err);
            resolve(cookies.map(c => c.toJSON()));
        });
    });
}

async function deleteCookie(domain, path, name) {
    return new Promise((resolve, reject) => {
        cookieJar.store.removeCookie(domain, path, name, (err) => {
            if (err) return reject(err);
            saveCookieJar();
            resolve();
        });
    });
}

async function clearAllCookies() {
    return new Promise((resolve, reject) => {
        cookieJar.store.removeAllCookies((err) => {
            if (err) return reject(err);
            saveCookieJar();
            resolve();
        });
    });
}

/**
 * Builds the TLS `ca` list. If `customCaPaths` is set, those PEM files are used;
 * when `useSystemCaStore` is not false (default), they are merged with Node's
 * bundled root store. Passing only custom PEMs without merging replaces the
 * default store and breaks public HTTPS with UNABLE_TO_GET_ISSUER_CERT_LOCALLY.
 */
async function resolveCaForRequest(request) {
    if (!request.customCaPaths || request.customCaPaths.length === 0) {
        return undefined;
    }
    const files = await Promise.all(request.customCaPaths.map((p) => fsp.readFile(p)));
    const useSystem = request.useSystemCaStore !== false;
    if (useSystem && tls.rootCertificates && tls.rootCertificates.length) {
        return [...tls.rootCertificates, ...files];
    }
    return files;
}

/**
 * Main entry point for HTTP requests from the renderer process.
 * Always utilizes the Node.js HTTP/HTTPS stack.
 */
async function handleHttpRequest(request) {
    const retryConfig = request.retries || {};
    const maxRetries = retryConfig.retryOnFailure ? (retryConfig.retryCount || 0) : 0;
    const baseDelay = retryConfig.retryDelayMs || 300;
    const exponential = retryConfig.exponentialBackoff || false;

    let useHttp2 = false;
    if (request.allowHttp2) {
        try {
            const probeUrl = new URL(request.url);
            if (probeUrl.protocol === 'https:') {
                const port = Number(probeUrl.port) || 443;
                const alpnAgentOptions = { rejectUnauthorized: !request.ignoreInvalidSsl };
                try {
                    const ca = await resolveCaForRequest(request);
                    if (ca) alpnAgentOptions.ca = ca;
                } catch (err) {
                    logError('ALPN probe: failed to load CA bundle', err);
                }
                const alpn = await probeAlpn(probeUrl.hostname, port, alpnAgentOptions);
                if (alpn === 'h2') useHttp2 = true;
            }
        } catch (err) {
            logError('HTTP/2 ALPN probe failed; falling back to HTTP/1.1', err);
        }
    }

    let attempt = 0;

    while (true) {
        attempt++;
        try {
            const result = useHttp2
                ? await executeHttp2Request(request)
                : await executeNodeRequest(request);
            if (result && !result.httpVersion) result.httpVersion = 'HTTP/1.1';

            if (result.status > 0 || attempt > maxRetries) {
                return result;
            }

            throw new Error(result.body?.message || 'Network Error');

        } catch (err) {
            if (attempt > maxRetries) {
                logError('HTTP request failed after maximum retries', err);
                return {
                    status: 0,
                    body: { error: true, message: err.message || 'Request failed' },
                    headers: {},
                    timeMs: 0
                };
            }

            const delay = exponential ? baseDelay * Math.pow(2, attempt - 1) : baseDelay;
            logInfo(`Request attempt ${attempt} failed: ${err.message}. Retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

async function resolveWithCustomDns(hostname, dnsServer) {
    const dns = require('dns');
    const resolver = new dns.Resolver();
    resolver.setServers([dnsServer]);

    const resolveFamily = (fn) =>
        new Promise((resolve, reject) => {
            fn.call(resolver, hostname, (err, addresses) => {
                if (err) return reject(err);
                if (!addresses?.length) return reject(new Error('No addresses'));
                resolve(addresses[0]);
            });
        });

    try {
        return await resolveFamily(resolver.resolve4);
    } catch {
        return await resolveFamily(resolver.resolve6);
    }
}

async function prepareRequestUrl(request) {
    const urlObj = new URL(request.url);
    const originalHostname = urlObj.hostname;

    if (request.params) {
        for (const [key, value] of Object.entries(request.params)) {
            urlObj.searchParams.set(key, value);
        }
    }

    if (request.dns && request.dns.customDnsServer) {
        try {
            const ip = await resolveWithCustomDns(originalHostname, request.dns.customDnsServer);
            if (ip) {
                urlObj.hostname = ip;
                logInfo(`Custom DNS: ${originalHostname} resolved to ${ip}`);
            }
        } catch (dnsErr) {
            logError(`DNS Resolution failed for ${originalHostname}, falling back to system DNS.`, dnsErr);
        }
    }

    return { urlObj, originalHostname };
}

/**
 * Creates a CONNECT tunnel through a proxy.
 */
async function createConnectTunnel(proxy, options) {
    return new Promise((resolve, reject) => {
        const tunnelOptions = {
            port: proxy.port,
            host: proxy.host,
            servername: proxy.host 
        };

        const req = http.request({
            port: proxy.port,
            host: proxy.host,
            method: 'CONNECT',
            path: `${options.hostname}:${options.port}`,
            headers: {
                'Host': `${options.hostname}:${options.port}`,
                ...(proxy.user && proxy.password ? {
                    'Proxy-Authorization': `Basic ${Buffer.from(`${proxy.user}:${proxy.password}`).toString('base64')}`
                } : {})
            }
        });

        req.on('connect', (res, socket) => {
            if (res.statusCode === 200) {
                resolve(socket);
            } else {
                reject(new Error(`Proxy CONNECT failed: ${res.statusCode}`));
            }
        });

        req.on('error', reject);
        req.end();
    });
}

/**
 * Executes a request using Node.js native http/https modules.
 */
async function executeNodeRequest(request) {
    const startTime = Date.now();
    const { urlObj, originalHostname } = await prepareRequestUrl(request);

    const isHttps = urlObj.protocol === 'https:';
    const agentOptions = {
        keepAlive: false
    };

    if (isHttps) {
        if (request.ignoreInvalidSsl) {
            agentOptions.rejectUnauthorized = false;
        }

        if (request.certificate) {
            const cert = request.certificate;
            try {
                if (cert.pfxFilePath) {
                    agentOptions.pfx = await fsp.readFile(cert.pfxFilePath);
                    if (cert.passphrase) agentOptions.passphrase = cert.passphrase;
                } else {
                    if (cert.crtFilePath) agentOptions.cert = await fsp.readFile(cert.crtFilePath);
                    if (cert.keyFilePath) agentOptions.key = await fsp.readFile(cert.keyFilePath);
                    if (cert.passphrase) agentOptions.passphrase = cert.passphrase;
                }
            } catch (err) {
                logError('Failed to read client certificate files', err);
                throw new Error(`Certificate error: ${err.message}`);
            }
        }

        try {
            const ca = await resolveCaForRequest(request);
            if (ca) agentOptions.ca = ca;
        } catch (err) {
            logError('Failed to read CA bundle files', err);
            throw new Error(`CA bundle error: ${err.message}`);
        }
    }

    const headers = { ...request.headers };

    if (request.useCookies !== false) {
        const jarCookies = await getCookies(request.url);
        if (jarCookies) {
            headers['Cookie'] = headers['Cookie'] ? `${headers['Cookie']}; ${jarCookies}` : jarCookies;
        }
    }

    const options = {
        method: request.method || 'GET',
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        headers: headers,
    };

    if (isHttps) {
        options.servername = originalHostname;

        if (request.verifyHostname === false) {
            agentOptions.checkServerIdentity = () => undefined;
        }
    }

    if (urlObj.hostname !== originalHostname) {
        options.headers['Host'] = originalHostname;
    }

    let socket;
    let socksAgent = null;
    const proxyConfig = request.proxy && request.proxy.useSystem === false ? request.proxy : null;
    const isSocksProxy = !!proxyConfig && (
        proxyConfig.type === 'socks' ||
        proxyConfig.type === 'socks4' ||
        proxyConfig.type === 'socks5' ||
        proxyConfig.type === 'socks5h'
    );
    const useHttpProxy = !!proxyConfig && !isSocksProxy;

    if (useHttpProxy) {
        if (isHttps) {
            socket = await createConnectTunnel(proxyConfig, options);
            options.createConnection = () => socket;
        } else {
            options.hostname = proxyConfig.host;
            options.port = proxyConfig.port;
            options.path = urlObj.toString();
            if (proxyConfig.user && proxyConfig.password) {
                options.headers['Proxy-Authorization'] = `Basic ${Buffer.from(`${proxyConfig.user}:${proxyConfig.password}`).toString('base64')}`;
            }
        }
    } else if (isSocksProxy) {
        if (!SocksProxyAgent) {
            throw new Error('SOCKS proxy is configured but the socks-proxy-agent module is not available.');
        }
        const typeMap = { socks: '5', socks4: '4', socks5: '5', socks5h: '5h' };
        const scheme = `socks${typeMap[proxyConfig.type] || '5'}`;
        const auth = proxyConfig.user
            ? `${encodeURIComponent(proxyConfig.user)}:${encodeURIComponent(proxyConfig.password || '')}@`
            : '';
        const socksUrl = `${scheme}://${auth}${proxyConfig.host}:${proxyConfig.port}`;
        socksAgent = new SocksProxyAgent(socksUrl, { ...agentOptions });
    }

    const protocol = isHttps ? https : http;

    let agent;
    if (socksAgent) {
        agent = socksAgent;
    } else {
        agent = new protocol.Agent({ ...agentOptions });
    }
    options.agent = agent;

    let bodyData;
    if (!['GET', 'HEAD'].includes(options.method.toUpperCase()) && request.body) {
        const structured = (request.body && typeof request.body === 'object' && request.body.mode)
            ? await buildStructuredBody(request.body)
            : null;
        if (structured) {
            bodyData = structured.data;
            if (structured.contentType) {
                const hasCt = Object.keys(options.headers).some(k => k.toLowerCase() === 'content-type');
                if (!hasCt) options.headers['Content-Type'] = structured.contentType;
            }
        } else {
            bodyData = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
        }
        options.headers['Content-Length'] = Buffer.byteLength(bodyData);
    }

    return new Promise((resolve) => {
        const req = protocol.request(options, (res) => {
            if (request.useCookies !== false) {
                saveCookies(request.url, res.headers['set-cookie']).catch(err => {
                    logError('Failed to save cookies', err);
                });
            }

            const followRedirects = request.followRedirects !== false;
            const maxRedirects = typeof request.maxRedirects === 'number' ? request.maxRedirects : 5;
            const statusCode = res.statusCode;
            const locationHeader = res.headers.location;
            if (followRedirects && statusCode >= 300 && statusCode < 400 && locationHeader) {
                const currentDepth = request.__redirectDepth || 0;
                if (currentDepth < maxRedirects) {
                    res.resume();
                    const nextUrl = new URL(locationHeader, urlObj).toString();
                    const nextRequest = {
                        ...request,
                        url: nextUrl,
                        __redirectDepth: currentDepth + 1,
                        ...(statusCode !== 307 && statusCode !== 308 && options.method !== 'GET' && options.method !== 'HEAD'
                            ? { method: 'GET', body: undefined }
                            : {})
                    };
                    executeNodeRequest(nextRequest).then(resolve).catch(err => resolve({
                        status: 0,
                        body: { error: true, message: err.message },
                        headers: {},
                        timeMs: Date.now() - startTime
                    }));
                    return;
                }
            }

            const decoded = decodeResponseStream(res);
            const data = [];
            decoded.on('data', chunk => data.push(chunk));
            decoded.on('error', err => {
                logError('Response decoding error', err);
                resolve({
                    status: res.statusCode,
                    statusText: res.statusMessage,
                    headers: res.headers,
                    body: { error: true, message: err.message },
                    timeMs: Date.now() - startTime
                });
            });
            decoded.on('end', () => {
                const buffer = Buffer.concat(data);
                const timeMs = Date.now() - startTime;

                const cleanHeaders = { ...res.headers };
                if (cleanHeaders['content-encoding']) {
                    delete cleanHeaders['content-encoding'];
                }
                cleanHeaders['content-length'] = String(buffer.length);

                const contentType = (res.headers['content-type'] || '').toLowerCase();
                const treatAsText = isTextContentType(contentType);

                let body;
                let isBinary = false;
                let binaryBase64;
                if (treatAsText) {
                    const bodyStr = buffer.toString('utf8');
                    try {
                        body = JSON.parse(bodyStr);
                    } catch {
                        body = bodyStr;
                    }
                } else {
                    isBinary = true;
                    binaryBase64 = buffer.toString('base64');
                    body = `[Binary ${contentType || 'application/octet-stream'} response, ${buffer.length} bytes]`;
                }

                const responseCookies = (res.headers['set-cookie'] || []).map(header => {
                    const parts = header.split(';').map(p => p.trim());
                    const [nameValue, ...attrs] = parts;
                    const [key, value] = nameValue.split('=');
                    const cookie = { key, value };
                    attrs.forEach(attr => {
                        const [k, v] = attr.split('=');
                        const lowK = k.toLowerCase();
                        if (lowK === 'expires') cookie.expires = v;
                        else if (lowK === 'max-age') cookie.maxAge = parseInt(v);
                        else if (lowK === 'domain') cookie.domain = v;
                        else if (lowK === 'path') cookie.path = v;
                        else if (lowK === 'secure') cookie.secure = true;
                        else if (lowK === 'httponly') cookie.httpOnly = true;
                        else if (lowK === 'samesite') cookie.sameSite = v;
                    });
                    return cookie;
                });

                resolve({
                    status: res.statusCode,
                    statusText: res.statusMessage,
                    headers: cleanHeaders,
                    body,
                    timeMs,
                    size: buffer.length,
                    cookies: responseCookies,
                    isBinary,
                    binaryBase64,
                    contentType
                });
            });
        });

        req.on('error', (err) => {
            logError('Node.js Request Error', err);
            resolve({
                status: 0,
                body: { error: true, message: err.message },
                headers: {},
                timeMs: Date.now() - startTime
            });
        });

        if (request.timeoutMs) {
            req.setTimeout(request.timeoutMs, () => {
                req.destroy();
                resolve({
                    status: 0,
                    body: { error: true, message: `Request timeout after ${request.timeoutMs}ms` },
                    headers: {},
                    timeMs: Date.now() - startTime
                });
            });
        }

        if (bodyData) {
            req.write(bodyData);
        }

        req.end();
    });
}

/**
 * ALPN-probe helper. Opens a TLS socket to `host:port` with ALPN protocols set
 * to `['h2', 'http/1.1']` and resolves with the negotiated protocol (or the
 * empty string if ALPN failed). We throw the socket away — its only purpose
 * is to tell us whether the server speaks HTTP/2, so we know whether to dial
 * via `http2.connect` or fall back to the HTTP/1.1 executor.
 *
 * Called opportunistically from `handleHttpRequest` when `allowHttp2` is set.
 */
function probeAlpn(host, port, agentOptions) {
    return new Promise((resolve) => {
        let settled = false;
        const done = (value) => {
            if (settled) return;
            settled = true;
            try { sock.destroy(); } catch { /* ignore */ }
            resolve(value);
        };
        const sock = tls.connect({
            host,
            port,
            servername: host,
            ALPNProtocols: ['h2', 'http/1.1'],
            rejectUnauthorized: agentOptions.rejectUnauthorized !== false,
            ca: agentOptions.ca,
            cert: agentOptions.cert,
            key: agentOptions.key,
            pfx: agentOptions.pfx,
            passphrase: agentOptions.passphrase,
        }, () => {
            done(sock.alpnProtocol || '');
        });
        sock.on('error', () => done(''));
        setTimeout(() => done(''), 4000);
    });
}

/**
 * HTTP/2 client path. Uses Node's `http2` module directly so ALPN negotiation
 * happens through the standard TLS stack. Cookies, redirects, and body
 * shaping reuse the same helpers as the HTTP/1.1 executor.
 */
async function executeHttp2Request(request) {
    const startTime = Date.now();
    const { urlObj, originalHostname } = await prepareRequestUrl(request);
    const isHttps = urlObj.protocol === 'https:';
    if (!isHttps) {
        return executeNodeRequest(request);
    }

    const port = urlObj.port || 443;
    const connectOptions = {
        servername: originalHostname,
        ALPNProtocols: ['h2'],
    };
    if (request.ignoreInvalidSsl) connectOptions.rejectUnauthorized = false;
    if (request.verifyHostname === false) connectOptions.checkServerIdentity = () => undefined;

    if (request.certificate) {
        const cert = request.certificate;
        try {
            if (cert.pfxFilePath) {
                connectOptions.pfx = await fsp.readFile(cert.pfxFilePath);
                if (cert.passphrase) connectOptions.passphrase = cert.passphrase;
            } else {
                if (cert.crtFilePath) connectOptions.cert = await fsp.readFile(cert.crtFilePath);
                if (cert.keyFilePath) connectOptions.key = await fsp.readFile(cert.keyFilePath);
                if (cert.passphrase) connectOptions.passphrase = cert.passphrase;
            }
        } catch (err) {
            logError('Failed to read client certificate files', err);
            throw new Error(`Certificate error: ${err.message}`);
        }
    }

    try {
        const ca = await resolveCaForRequest(request);
        if (ca) connectOptions.ca = ca;
    } catch (err) {
        logError('Failed to read CA bundle files', err);
        throw new Error(`CA bundle error: ${err.message}`);
    }

    const headers = { ...request.headers };
    if (request.useCookies !== false) {
        const jarCookies = await getCookies(request.url);
        if (jarCookies) {
            headers['Cookie'] = headers['Cookie'] ? `${headers['Cookie']}; ${jarCookies}` : jarCookies;
        }
    }

    let bodyData;
    const method = (request.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD'].includes(method) && request.body) {
        const structured = (request.body && typeof request.body === 'object' && request.body.mode)
            ? await buildStructuredBody(request.body)
            : null;
        if (structured) {
            bodyData = structured.data;
            if (structured.contentType) {
                const hasCt = Object.keys(headers).some(k => k.toLowerCase() === 'content-type');
                if (!hasCt) headers['Content-Type'] = structured.contentType;
            }
        } else {
            bodyData = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
        }
        headers['Content-Length'] = Buffer.byteLength(bodyData);
    }

    for (const key of Object.keys(headers)) {
        const lower = key.toLowerCase();
        if (lower === 'host' || lower === 'connection' || lower === 'keep-alive' ||
            lower === 'proxy-connection' || lower === 'transfer-encoding' || lower === 'upgrade') {
            delete headers[key];
        }
    }

    const authority = `https://${originalHostname}${urlObj.port ? `:${urlObj.port}` : ''}`;

    return new Promise((resolve) => {
        let client;
        let settled = false;
        const bail = (err) => {
            if (settled) return;
            settled = true;
            logError('HTTP/2 client error', err);
            resolve({
                status: 0,
                body: { error: true, message: err.message || 'HTTP/2 error' },
                headers: {},
                timeMs: Date.now() - startTime,
            });
            try { client && client.close(); } catch {  }
        };

        try {
            client = http2.connect(authority, connectOptions);
        } catch (err) {
            bail(err);
            return;
        }

        client.on('error', bail);

        const requestHeaders = {
            ':method': method,
            ':path': urlObj.pathname + urlObj.search,
            ':scheme': 'https',
            ':authority': originalHostname + (urlObj.port ? `:${urlObj.port}` : ''),
            ...headers,
        };

        const req = client.request(requestHeaders, { endStream: !bodyData });

        let responseHeaders = {};
        req.on('response', (hdrs) => {
            responseHeaders = hdrs;
        });

        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            if (settled) return;
            settled = true;
            const status = responseHeaders[':status'] || 0;
            const status_text = ''; 
            const cleanHeaders = { ...responseHeaders };
            delete cleanHeaders[':status'];

            let buffer = Buffer.concat(chunks);
            const encoding = (cleanHeaders['content-encoding'] || '').toLowerCase();
            try {
                if (encoding === 'gzip' || encoding === 'x-gzip') buffer = zlib.gunzipSync(buffer);
                else if (encoding === 'deflate') buffer = zlib.inflateSync(buffer);
                else if (encoding === 'br') buffer = zlib.brotliDecompressSync(buffer);
                if (encoding) delete cleanHeaders['content-encoding'];
            } catch (err) {
                logError(`HTTP/2 decompress (${encoding}) failed`, err);
            }
            cleanHeaders['content-length'] = String(buffer.length);

            const contentType = String(cleanHeaders['content-type'] || '').toLowerCase();
            const treatAsText = isTextContentType(contentType);

            let body;
            let isBinary = false;
            let binaryBase64;
            if (treatAsText) {
                const bodyStr = buffer.toString('utf8');
                try { body = JSON.parse(bodyStr); } catch { body = bodyStr; }
            } else {
                isBinary = true;
                binaryBase64 = buffer.toString('base64');
                body = `[Binary ${contentType || 'application/octet-stream'} response, ${buffer.length} bytes]`;
            }

            if (request.useCookies !== false && cleanHeaders['set-cookie']) {
                saveCookies(request.url, cleanHeaders['set-cookie']).catch(err => {
                    logError('Failed to save cookies', err);
                });
            }

            resolve({
                status,
                statusText: status_text,
                headers: cleanHeaders,
                body,
                timeMs: Date.now() - startTime,
                size: buffer.length,
                cookies: [],
                isBinary,
                binaryBase64,
                contentType,
                httpVersion: 'HTTP/2',
            });

            try { client.close(); } catch { /* ignore */ }
        });

        req.on('error', bail);

        if (request.timeoutMs) {
            req.setTimeout(request.timeoutMs, () => {
                try { req.close(http2.constants.NGHTTP2_CANCEL); } catch { /* ignore */ }
                bail(new Error(`Request timeout after ${request.timeoutMs}ms`));
            });
        }

        if (bodyData) {
            req.end(bodyData);
        }
    });
}

module.exports = {
    init,
    handleHttpRequest,
    executeHttp2Request,
    probeAlpn,
    getAllCookies,
    deleteCookie,
    clearAllCookies
};
