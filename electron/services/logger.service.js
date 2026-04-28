const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { getLogsDir, ensureLogsDir } = require('./paths.service');

let logFilePath = null;

/** @type {{ logToFile: boolean, maxBytes: number, resolvedLogFile: string | null }} */
let fileConfig = {
  logToFile: false,
  maxBytes: 1024 * 1024,
  resolvedLogFile: null,
};

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

const LEVEL_COLORS = {
  DEBUG: ANSI.gray,
  INFO: ANSI.cyan,
  WARN: ANSI.yellow,
  ERROR: ANSI.red,
};

const QUIET_INFO_CATEGORIES = ['save-collections', 'save-environments', 'save-settings', 'save-session'];

function getTimestamp() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function formatDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Resolve primary log file path from settings or default `logs/app.log`.
 * @param {import('../../src/shared/settings').LoggingSettings | undefined | null} logging
 */
function resolveLogFilePath(logging) {
  const custom = logging && typeof logging.logFilePath === 'string' ? logging.logFilePath.trim() : '';
  if (!custom) {
    return path.join(ensureLogsDir(), 'app.log');
  }
  if (path.isAbsolute(custom)) {
    const dir = path.dirname(custom);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return custom;
  }
  return path.join(ensureLogsDir(), custom.replace(/^[\\/]+/, ''));
}

function applyRotationIfNeeded() {
  const target = fileConfig.resolvedLogFile;
  if (!target || !fs.existsSync(target)) return;
  try {
    const stats = fs.statSync(target);
    if (stats.size <= fileConfig.maxBytes) return;
    const dir = path.dirname(target);
    const archiveName = `app-${formatDate()}-${Date.now()}.log`;
    fs.renameSync(target, path.join(dir, archiveName));
  } catch (err) {
    console.error('Log rotation failed', err);
  }
}

function ensureLogDir() {
  try {
    ensureLogsDir();
    const target = fileConfig.resolvedLogFile || path.join(getLogsDir(), 'app.log');
    fileConfig.resolvedLogFile = target;
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    applyRotationIfNeeded();
    logFilePath = target;
  } catch (err) {
    console.error('Failed to initialize log directory', err);
  }
}

/**
 * @param {import('../../src/shared/settings').LoggingSettings | undefined | null} logging
 */
function reconfigure(logging) {
  const logToFile = !!(logging && logging.logToFile);
  const maxKb = Math.max(64, Number(logging?.maxLogFileSizeKb) || 1024);
  fileConfig = {
    logToFile,
    maxBytes: maxKb * 1024,
    resolvedLogFile: resolveLogFilePath(logging || undefined),
  };
  logFilePath = null;
  if (logToFile) {
    ensureLogDir();
  }
}

function shouldWriteToFile() {
  if (!fileConfig.logToFile) return false;
  if (!app.isPackaged) return true;
  return true;
}

function writeToFile(line) {
  if (!shouldWriteToFile()) return;

  if (!logFilePath) ensureLogDir();

  if (logFilePath) {
    try {
      applyRotationIfNeeded();
      fs.appendFileSync(logFilePath, line + '\n');
    } catch (err) {
      console.error('Failed to write to log file', err);
    }
  }
}

/**
 * Render a data payload as a compact `key=value` list, with shallow
 * stringification for nested objects. Strings with whitespace get quoted.
 */
function formatData(data) {
  if (data === null || data === undefined) return '';
  if (typeof data !== 'object') return ` ${String(data)}`;
  const entries = Object.entries(data);
  if (entries.length === 0) return '';
  const parts = entries.map(([k, v]) => {
    let rendered;
    if (v === null || v === undefined) {
      rendered = String(v);
    } else if (typeof v === 'string') {
      rendered = /\s|"/.test(v) ? JSON.stringify(v) : v;
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      rendered = String(v);
    } else if (v instanceof Error) {
      rendered = JSON.stringify(v.message);
    } else {
      try {
        rendered = JSON.stringify(v);
        if (rendered && rendered.length > 200) {
          rendered = rendered.slice(0, 197) + '...';
        }
      } catch {
        rendered = '[unserializable]';
      }
    }
    return `${k}=${rendered}`;
  });
  return ` ${parts.join(' ')}`;
}

function shouldSuppress(level, message) {
  if (level !== 'INFO' && level !== 'DEBUG') return false;
  return QUIET_INFO_CATEGORIES.some(c => message.includes(c));
}

function formatMessage(level, message, data = null) {
  return `[${getTimestamp()}] [${level}] ${message}${formatData(data)}`;
}

function consoleWrite(level, line) {
  const color = LEVEL_COLORS[level] || '';
  const out = color ? `${color}${line}${ANSI.reset}` : line;
  if (level === 'ERROR') console.error(out);
  else if (level === 'WARN') console.warn(out);
  else if (level === 'DEBUG') console.debug(out);
  else console.log(out);
}

async function logInfo(message, data = null) {
  if (shouldSuppress('INFO', message)) return;
  const line = formatMessage('INFO', message, data);
  consoleWrite('INFO', line);
  writeToFile(line);
}

async function logError(message, error = null) {
  let line;
  if (error instanceof Error) {
    line = `[${getTimestamp()}] [ERROR] ${message} ${JSON.stringify(error.message)}`;
    if (error.stack) line += `\n${error.stack}`;
  } else if (error && typeof error === 'object') {
    line = formatMessage('ERROR', message, error);
  } else if (error !== null && error !== undefined) {
    line = `[${getTimestamp()}] [ERROR] ${message} ${String(error)}`;
  } else {
    line = formatMessage('ERROR', message);
  }
  consoleWrite('ERROR', line);
  writeToFile(line);
}

async function logWarn(message, data = null) {
  const line = formatMessage('WARN', message, data);
  consoleWrite('WARN', line);
  writeToFile(line);
}

async function logDebug(message, data = null) {
  if (app.isPackaged) return;
  if (shouldSuppress('DEBUG', message)) return;
  const line = formatMessage('DEBUG', message, data);
  consoleWrite('DEBUG', line);
  if (shouldWriteToFile()) {
    writeToFile(line);
  }
}

module.exports = {
  logInfo,
  logError,
  logWarn,
  logDebug,
  reconfigure,
  ensureLogDir,
};
