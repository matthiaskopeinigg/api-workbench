const { ipcMain, BrowserWindow } = require('electron');
const { logInfo, logError } = require('../services/logger.service');

function registerOAuthHandlers() {
    ipcMain.handle('get-oauth2-token', async (event, config) => {
        const { authUrl, clientId, redirectUri, scope } = config;

        if (!authUrl) {
            return Promise.reject(new Error('Auth URL is required'));
        }

        return new Promise((resolve, reject) => {
            const authWindow = new BrowserWindow({
                width: 800,
                height: 600,
                show: true,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true
                }
            });

            const url = new URL(authUrl);
            url.searchParams.set('client_id', clientId);
            url.searchParams.set('redirect_uri', redirectUri);
            url.searchParams.set('response_type', 'code');
            if (scope) url.searchParams.set('scope', scope);

            authWindow.loadURL(url.toString());

            const handleRedirect = (redirectUrl) => {
                if (redirectUrl.startsWith(redirectUri)) {
                    const urlObj = new URL(redirectUrl);
                    const code = urlObj.searchParams.get('code');
                    const error = urlObj.searchParams.get('error');

                    if (code) {
                        resolve({ code });
                        authWindow.close();
                    } else if (error) {
                        reject(new Error(error));
                        authWindow.close();
                    }
                }
            };

            authWindow.webContents.on('will-navigate', (e, url) => handleRedirect(url));
            authWindow.webContents.on('will-redirect', (e, url) => handleRedirect(url));

            authWindow.on('closed', () => {
                resolve(null);
            });
        });
    });

    ipcMain.handle('exchange-oauth2-code', async (event, config) => {
        const { tokenUrl, code, clientId, clientSecret, redirectUri } = config;

        try {
            const body = new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri
            });

            const res = await fetch(tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                },
                body: body.toString()
            });

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`Token exchange failed: ${res.status} ${errorText}`);
            }

            return await res.json();
        } catch (err) {
            logError('OAuth Token Exchange Error', err);
            throw err;
        }
    });

    ipcMain.handle('get-oauth2-client-credentials', async (event, config) => {
        const { tokenUrl, clientId, clientSecret, scope } = config;

        try {
            const body = new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: clientId,
                client_secret: clientSecret
            });
            if (scope) body.append('scope', scope);

            const res = await fetch(tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                },
                body: body.toString()
            });

            return await res.json();
        } catch (err) {
            logError('OAuth Client Credentials Error', err);
            throw err;
        }
    });
}

module.exports = { registerOAuthHandlers };
