const fs = require('fs');
const path = require('path');
const { getAppConfigDir, ensureAppConfigDir } = require('./paths.service');
const { logError } = require('./logger.service');

const FILE = 'mock-server.json';

function filePath() {
  return path.join(getAppConfigDir(), FILE);
}

/**
 * @returns {import('../../src/shared/electron').MockServerOptions | null}
 */
function readMockServerOptions() {
  const p = filePath();
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return null;
    return o.options && typeof o.options === 'object' ? o.options : o;
  } catch (e) {
    logError('app-config: failed to read mock-server.json', e);
    return null;
  }
}

/**
 * @param {import('../../src/shared/electron').MockServerOptions} options
 */
function writeMockServerOptions(options) {
  try {
    ensureAppConfigDir();
    const p = filePath();
    const payload = {
      version: 1,
      options,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(p, JSON.stringify(payload, null, 2), 'utf8');
  } catch (e) {
    logError('app-config: failed to write mock-server.json', e);
  }
}

module.exports = {
  readMockServerOptions,
  writeMockServerOptions,
  mockServerFilePath: filePath,
};
