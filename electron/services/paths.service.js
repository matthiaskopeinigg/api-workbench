const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * Writable paths under Electron `userData` (honours `API_WORKBENCH_USER_DATA`, or
 * `~/.api-workbench/user-data-path.txt` from Settings → Change work directory).
 * Keeps workspace JSON, app-config, and logs under one root.
 */
function getWritableRoot() {
  return app.getPath('userData');
}

function getAppConfigDir() {
  return path.join(getWritableRoot(), 'app-config');
}

function getLogsDir() {
  return path.join(getWritableRoot(), 'logs');
}

function ensureAppConfigDir() {
  const dir = getAppConfigDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function ensureLogsDir() {
  const dir = getLogsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

module.exports = {
  getWritableRoot,
  getAppConfigDir,
  getLogsDir,
  ensureAppConfigDir,
  ensureLogsDir,
};
