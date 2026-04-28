const { BrowserWindow, ipcMain } = require('electron');

class E2eService {
  constructor() {
    this.window = null;
    this.intercepts = new Map();
    this.isDebugging = false;
    this.currentStep = '';
  }

  async execute(action, selector, value, timeout = 5000, show = true) {
    console.log(`[E2E] Executing ${action} (show: ${show})`);

    if (this.window && !this.window.isDestroyed() && this.window.isVisible() !== show) {
      console.log(`[E2E] Visibility mismatch, recreating window...`);
      this.window.close();
      this.window = null;
    }

    if (!this.window || this.window.isDestroyed()) {
      console.log(`[E2E] Creating new window (show: ${show})`);
      this.window = new BrowserWindow({
        show: show,
        width: 1280,
        height: 800,
        title: 'API Workbench - E2E Runner',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          offscreen: !show
        }
      });

      this.window.setMenuBarVisibility(false);
      this.window.setAutoHideMenuBar(true);

      if (show) {
        this.window.show();
        // Wait for page load to inject HUD
        this.window.webContents.on('did-finish-load', () => this.injectHUD());
      }
    }

    this.currentStep = action;
    if (show && action !== 'OPEN_PAGE') {
      await this.updateHUD('running', action, selector);
    }

    try {
      let result;
      switch (action) {
        case 'OPEN_PAGE':
          await this.window.loadURL(value);
          result = { success: true };
          break;

        case 'CLICK':
          await this.window.webContents.executeJavaScript(`
            (async function() {
              const findEl = () => document.querySelector(\`${selector}\`);
              let el = findEl();
              
              // Quick retry loop for dynamic content
              for (let i = 0; i < 5; i++) {
                if (el) break;
                await new Promise(r => setTimeout(r, 500));
                el = findEl();
              }

              if (el) {
                el.scrollIntoView({ behavior: 'auto', block: 'center' });
                el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                el.click();
                el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                return true;
              }
              throw new Error('Element not found: ${selector}');
            })()
          `);
          result = { success: true };
          break;

        case 'TYPE_TEXT':
          await this.window.webContents.executeJavaScript(`
            (async function() {
              const findEl = () => document.querySelector(\`${selector}\`);
              let el = findEl();
              
              for (let i = 0; i < 5; i++) {
                if (el) break;
                await new Promise(r => setTimeout(r, 500));
                el = findEl();
              }

              if (el) {
                el.focus();
                el.value = ${JSON.stringify(value)};
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
                el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
                el.blur();
                return true;
              }
              throw new Error('Element not found: ${selector}');
            })()
          `);
          result = { success: true };
          break;

        case 'WAIT':
          await new Promise(r => setTimeout(r, parseInt(value) || 1000));
          result = { success: true };
          break;

        case 'ASSERT_ELEMENT':
          const exists = await this.window.webContents.executeJavaScript(`
            !!document.querySelector(\`${selector}\`)
          `);
          if (!exists) throw new Error(`Assertion failed: Element ${selector} not found`);
          result = { success: true };
          break;

        case 'ASSERT_URL':
          const currentUrl = this.window.webContents.getURL();
          if (!currentUrl.includes(selector)) {
            throw new Error(`Assertion failed: URL "${currentUrl}" does not contain "${selector}"`);
          }
          result = { success: true };
          break;

        case 'WAIT_FOR_URL':
          const targetUrl = selector;
          const waitStart = Date.now();
          let match = false;
          while (Date.now() - waitStart < (timeout || 10000)) {
            if (this.window.webContents.getURL().includes(targetUrl)) {
              match = true;
              break;
            }
            await new Promise(r => setTimeout(r, 500));
          }
          if (!match) throw new Error(`Timeout waiting for URL to contain: ${targetUrl}`);
          result = { success: true };
          break;

        case 'START_INTERCEPT':
          await this.startIntercept(value);
          result = { success: true };
          break;

        case 'WAIT_FOR_INTERCEPT':
          const response = await this.waitForIntercept(value, timeout);
          result = { success: true, data: response };
          break;

        case 'CLOSE':
          if (this.window) {
            this.window.close();
            this.window = null;
          }
          result = { success: true };
          break;

        default:
          throw new Error(`Unknown E2E action: ${action}`);
      }

      if (show) await this.updateHUD('success', action, selector);
      return result;

    } catch (err) {
      if (show) await this.updateHUD('failed', action, selector);
      throw err;
    }
  }

  async injectHUD() {
    if (!this.window) return;
    const hudCss = `
      #aw-e2e-hud {
        position: fixed;
        top: 20px;
        right: 20px;
        width: 280px;
        background: rgba(15, 23, 42, 0.85);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        padding: 16px;
        color: white;
        font-family: 'Inter', system-ui, sans-serif;
        z-index: 2147483647;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);
        pointer-events: none;
        transition: all 0.3s ease;
        opacity: 0.9;
      }
      .hud-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
      .hud-dot { width: 8px; height: 8px; background: #3b82f6; border-radius: 50%; box-shadow: 0 0 10px #3b82f6; animation: hud-pulse 1.5s infinite; }
      .hud-title { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; color: #94a3b8; }
      .hud-step { font-size: 14px; font-weight: 600; color: #f1f5f9; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .hud-status { font-size: 11px; color: #3b82f6; font-weight: 500; }
      
      @keyframes hud-pulse { 0% { opacity: 0.4; } 50% { opacity: 1; } 100% { opacity: 0.4; } }
      
      .aw-highlight {
        outline: 3px solid #3b82f6 !important;
        outline-offset: 2px !important;
        box-shadow: 0 0 15px rgba(59, 130, 246, 0.5) !important;
        transition: outline 0.2s ease !important;
        position: relative !important;
      }
    `;

    await this.window.webContents.executeJavaScript(`
      (function() {
        if (document.getElementById('aw-e2e-hud')) return;
        const style = document.createElement('style');
        style.textContent = \`${hudCss}\`;
        document.head.appendChild(style);

        const hud = document.createElement('div');
        hud.id = 'aw-e2e-hud';
        hud.innerHTML = \`
          <div class="hud-header">
            <div class="hud-dot"></div>
            <div class="hud-title">API Workbench E2E</div>
          </div>
          <div class="hud-step" id="aw-hud-step">Waiting...</div>
          <div class="hud-status" id="aw-hud-status">Initializing Engine</div>
        \`;
        document.body.appendChild(hud);
      })()
    `);
  }

  async updateHUD(state, action, details = '') {
    if (!this.window) return;
    const statusText = state === 'running' ? 'Executing Operation...' : state === 'success' ? 'Step Completed' : 'Step Failed';
    const statusColor = state === 'running' ? '#3b82f6' : state === 'success' ? '#10b981' : '#ef4444';

    await this.window.webContents.executeJavaScript(`
      (function() {
        const stepEl = document.getElementById('aw-hud-step');
        const statusEl = document.getElementById('aw-hud-status');
        const dotEl = document.querySelector('.hud-dot');
        if (!stepEl) return;
        
        stepEl.textContent = \`${action}\`;
        statusEl.textContent = \`${statusText}\`;
        statusEl.style.color = \`${statusColor}\`;
        if (dotEl) dotEl.style.background = \`${statusColor}\`;
        
        // Remove old highlights
        document.querySelectorAll('.aw-highlight').forEach(el => el.classList.remove('aw-highlight'));
        
        if (\`${details}\` && \`${details}\`.startsWith('#') || \`${details}\`.startsWith('.')) {
          const target = document.querySelector(\`${details}\`);
          if (target) target.classList.add('aw-highlight');
        }
      })()
    `);
  }

  async startIntercept(pattern) {
    if (!this.window) return;

    if (!this.isDebugging) {
      try {
        this.window.webContents.debugger.attach('1.3');
        await this.window.webContents.debugger.sendCommand('Network.enable');
        this.isDebugging = true;
        
        console.log('[E2E] 🛡️ Network Debugger Attached');

        this.window.webContents.debugger.on('detach', () => {
          this.isDebugging = false;
          console.log('[E2E] 🧊 Debugger Detached');
        });

        const pendingRequests = new Map();

        this.window.webContents.debugger.on('message', async (event, method, params) => {
          if (method === 'Network.requestWillBeSent') {
            console.log(`[CDP] 🛫 ${params.request.method} ${params.request.url.substring(0, 100)}...`);
          }

          if (method === 'Network.responseReceived') {
            const { requestId, response } = params;
            const url = response.url;
            console.log(`[CDP] 🛬 [${response.status}] ${url.substring(0, 100)}...`);
            
            pendingRequests.set(requestId, { url, response });
            
            // Check for matches immediately (Status/Headers)
            for (const [pattern, existing] of this.intercepts.entries()) {
              const cleanPattern = pattern.toLowerCase().trim().replace(/^\/+/, '');
              if (url.toLowerCase().includes(cleanPattern)) {
                console.log(`[CDP] 🎯 MATCH! Capturing metadata for: ${pattern}`);
                // If it's a function (waiting), we'll resolve it once we have the body or a failure
              }
            }
          }

          if (method === 'Network.loadingFinished') {
            const { requestId } = params;
            const data = pendingRequests.get(requestId);
            if (!data) return;

            const { url, response } = data;
            pendingRequests.delete(requestId);

            for (const [pattern, existing] of this.intercepts.entries()) {
              const cleanPattern = pattern.toLowerCase().trim().replace(/^\/+/, '');
              if (url.toLowerCase().includes(cleanPattern)) {
                try {
                  const { body, base64Encoded } = await this.window.webContents.debugger.sendCommand('Network.getResponseBody', { requestId });
                  const finalBody = base64Encoded ? Buffer.from(body, 'base64').toString() : body;
                  
                  const result = {
                    status: response.status,
                    headers: response.headers,
                    body: finalBody
                  };

                  if (typeof existing === 'function') {
                    console.log(`[CDP] 🎁 Resolving waiter for: ${pattern}`);
                    existing(result);
                    this.intercepts.delete(pattern);
                  } else {
                    console.log(`[CDP] 📦 Storing result for: ${pattern}`);
                    this.intercepts.set(pattern, result);
                  }
                } catch (e) {
                  console.warn(`[CDP] ⚠️ Body capture failed, resolving with metadata only: ${url}`);
                  const fallback = {
                    status: response.status,
                    headers: response.headers,
                    body: 'Response body unavailable (navigation occurred)'
                  };

                  if (typeof existing === 'function') {
                    existing(fallback);
                    this.intercepts.delete(pattern);
                  } else {
                    this.intercepts.set(pattern, fallback);
                  }
                }
              }
            }
          }
        });
      } catch (err) {
        console.error('[E2E] ❌ Debugger Error:', err);
        this.isDebugging = false;
      }
    }

    // Reset any previous intercept for this pattern
    this.intercepts.set(pattern, null);
  }

  async captureBodyAndResolve(requestId, response, pattern) {
    try {
      const { body, base64Encoded } = await this.window.webContents.debugger.sendCommand('Network.getResponseBody', { requestId });
      const result = {
        url: response.url,
        status: response.status,
        headers: response.headers,
        body: base64Encoded ? Buffer.from(body, 'base64').toString() : body
      };
      const pending = this.intercepts.get(pattern);
      if (typeof pending === 'function') {
        pending(result);
        this.intercepts.delete(pattern);
      } else {
        this.intercepts.set(pattern, result);
      }
    } catch (err) {
      console.error('Error capturing body:', err);
    }
  }

  async waitForIntercept(pattern, timeout) {
    const existing = this.intercepts.get(pattern);
    if (existing && typeof existing !== 'function') {
      const res = existing;
      this.intercepts.delete(pattern);
      return res;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.intercepts.delete(pattern);
        reject(new Error(`Timeout waiting for request matching: ${pattern}`));
      }, timeout);

      this.intercepts.set(pattern, (res) => {
        clearTimeout(timer);
        resolve(res);
      });
    });
  }
}

const e2eService = new E2eService();

ipcMain.handle('e2e:execute', async (event, { action, selector, value, timeout, show }) => {
  try {
    return await e2eService.execute(action, selector, value, timeout, show);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

module.exports = e2eService;
