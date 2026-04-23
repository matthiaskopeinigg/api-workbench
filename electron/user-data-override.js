const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

function getMarkerDir() {
  return path.join(os.homedir(), '.api-workbench');
}

function getMarkerFilePath() {
  return path.join(getMarkerDir(), 'user-data-path.txt');
}

/**
 * Puts Chromium/Electron disk cache under our userData tree. On Windows this avoids
 * frequent "Unable to move the cache: Access is denied" noise when the default profile
 * cache is locked (AV, another instance, or permissions).
 */
function applyRendererCachePath() {
  try {
    const cacheRoot = path.join(app.getPath('userData'), 'renderer-cache');
    if (!fs.existsSync(cacheRoot)) {
      fs.mkdirSync(cacheRoot, { recursive: true });
    }
    app.setPath('cache', cacheRoot);
  } catch {
    /* non-fatal */
  }
}

/**
 * If present, the first line is an absolute (or home-relative) directory used as
 * app.getPath("userData") (database, config). Must run before app.ready / DB open.
 * Env API_WORKBENCH_USER_DATA wins over the marker file.
 */
function applyUserDataOverride() {
  if (process.env.API_WORKBENCH_USER_DATA) {
    try {
      const resolved = path.resolve(process.env.API_WORKBENCH_USER_DATA);
      if (resolved) {
        app.setPath('userData', resolved);
      }
    } catch (e) {
      /**/
    }
    return;
  }
  const marker = getMarkerFilePath();
  try {
    if (fs.existsSync(marker)) {
      const line = String(fs.readFileSync(marker, 'utf8') || '')
        .split(/\r?\n/)[0]
        .trim();
      if (line) {
        const target = path.isAbsolute(line) ? line : path.resolve(os.homedir(), line);
        if (target) {
          app.setPath('userData', target);
        }
      }
    }
  } catch (e) {
    /**/
  }
}

function readOverrideTargetFromDisk() {
  if (process.env.API_WORKBENCH_USER_DATA) {
    return { source: 'env', path: path.resolve(process.env.API_WORKBENCH_USER_DATA) };
  }
  const marker = getMarkerFilePath();
  if (!fs.existsSync(marker)) {
    return { source: null, path: null };
  }
  try {
    const line = String(fs.readFileSync(marker, 'utf8') || '')
      .split(/\r?\n/)[0]
      .trim();
    if (!line) {
      return { source: 'marker', path: null };
    }
    return {
      source: 'marker',
      path: path.isAbsolute(line) ? line : path.resolve(os.homedir(), line),
    };
  } catch (e) {
    return { source: 'marker', path: null };
  }
}

function writeDataDirectoryOverride(dirPath) {
  const target = path.resolve(dirPath);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
  const dir = getMarkerDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(getMarkerFilePath(), target + '\n', 'utf8');
}

function clearDataDirectoryOverride() {
  const marker = getMarkerFilePath();
  if (fs.existsSync(marker)) {
    fs.unlinkSync(marker);
  }
}

module.exports = {
  applyUserDataOverride,
  applyRendererCachePath,
  getMarkerFilePath,
  getMarkerDir,
  readOverrideTargetFromDisk,
  writeDataDirectoryOverride,
  clearDataDirectoryOverride,
};
