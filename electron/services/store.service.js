const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { logInfo, logError } = require('./logger.service');
const db = require('../db/database');

/**
 * Prefer repo-local `config/` (dev) over legacy `configs/`; packaged builds
 * also check beside the exe (configs) for backward compatibility.
 */
function getConfigDir() {
  if (app.isPackaged) {
    const nextToExe = path.join(path.dirname(app.getPath('exe')), 'configs');
    if (fs.existsSync(nextToExe)) {
      return nextToExe;
    }
    return path.join(path.dirname(app.getPath('exe')), 'config');
  }
  const appPath = app.getAppPath();
  const devConfig = path.join(appPath, 'config');
  if (fs.existsSync(devConfig)) {
    return devConfig;
  }
  return path.join(appPath, 'configs');
}

/** When true, successful imports rename JSON to *.bak. Skip for `config/` to ease local dev re-runs. */
function shouldArchiveAfterImport() {
  return path.basename(getConfigDir()) !== 'config';
}

function readConfigJsonFile(fileBaseName) {
  const dir = getConfigDir();
  const filePath = path.join(dir, `${fileBaseName}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    logError(`Failed to read config file ${fileBaseName}.json`, e);
    return null;
  }
}

function archiveConfigFile(fileBaseName) {
  if (!shouldArchiveAfterImport()) {
    return;
  }
  const dir = getConfigDir();
  const filePath = path.join(dir, `${fileBaseName}.json`);
  if (!fs.existsSync(filePath)) {
    return;
  }
  const archived = `${filePath}.migrated.${Date.now()}.bak`;
  try {
    fs.renameSync(filePath, archived);
    logInfo('Archived migrated config file', { from: filePath, to: archived });
  } catch (e) {
    logError('Failed to archive config file', e);
  }
}

function importLegacyIfEmpty() {
  const hasAny = db.getDocument('settings') || db.getDocument('collections');
  if (hasAny) {
    return;
  }

  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    return;
  }

  const settingsBlob = readConfigJsonFile('settings');
  if (settingsBlob && settingsBlob.settings !== undefined) {
    db.setDocument('settings', JSON.stringify(settingsBlob));
    archiveConfigFile('settings');
  }

  const collectionsBlob = readConfigJsonFile('collections');
  if (collectionsBlob && collectionsBlob.collections !== undefined) {
    db.setDocument('collections', JSON.stringify(collectionsBlob));
    archiveConfigFile('collections');
  }

  const environmentsBlob = readConfigJsonFile('environments');
  if (environmentsBlob && environmentsBlob.environments !== undefined) {
    db.setDocument('environments', JSON.stringify(environmentsBlob));
    archiveConfigFile('environments');
  }

  const sessionBlob = readConfigJsonFile('session');
  if (sessionBlob && typeof sessionBlob === 'object') {
    for (const [key, value] of Object.entries(sessionBlob)) {
      if (key === 'version' || key === 'size') {
        continue;
      }
      db.setSessionKey(key, value);
    }
    archiveConfigFile('session');
  }

  const hadArtifacts = importArtifactDocumentsFromConfig();

  const hadCore =
    (settingsBlob && settingsBlob.settings !== undefined) ||
    (collectionsBlob && collectionsBlob.collections !== undefined) ||
    (environmentsBlob && environmentsBlob.environments !== undefined) ||
    (sessionBlob && typeof sessionBlob === 'object');
  if (hadCore || hadArtifacts) {
    void logInfo('Imported workspace seed from config', { configDir, archive: shouldArchiveAfterImport() });
  }
}

async function initStores() {
  try {
    db.openDatabase();
    importLegacyIfEmpty();
    await logInfo('Stores initialized (SQLite)');
  } catch (err) {
    await logError('Failed to initialize stores', err);
    throw err;
  }
}

function getSettings() {
  const raw = db.getDocument('settings');
  if (!raw) {
    return undefined;
  }
  try {
    const doc = JSON.parse(raw);
    return doc.settings ?? doc;
  } catch {
    return undefined;
  }
}

function setSettings(settings) {
  db.setDocument('settings', JSON.stringify({ settings }));
}

function getCollections() {
  const raw = db.getDocument('collections');
  if (!raw) {
    return [];
  }
  try {
    const doc = JSON.parse(raw);
    return doc.collections ?? [];
  } catch {
    return [];
  }
}

function setCollections(collections) {
  db.setDocument('collections', JSON.stringify({ collections }));
}

function getEnvironments() {
  const raw = db.getDocument('environments');
  if (!raw) {
    return [];
  }
  try {
    const doc = JSON.parse(raw);
    return doc.environments ?? [];
  } catch {
    return [];
  }
}

function setEnvironments(environments) {
  db.setDocument('environments', JSON.stringify({ environments }));
}

function getSession(key) {
  return db.getSessionKey(key);
}

function setSession(key, value) {
  db.setSessionKey(key, value);
}

function getCookieJarJson() {
  return db.getDocument('cookieJar');
}

function setCookieJarJson(jsonString) {
  db.setDocument('cookieJar', jsonString);
}

/**
 * Test artifacts (load tests, suites, contract tests, flows) are stored
 * the same way collections are: a single SQLite "document" per artifact
 * type, holding `{ items: [...] }`. Keeping all artifacts of one kind
 * together keeps writes atomic and makes "list all" trivial.
 */
function getArtifacts(docKey) {
  const raw = db.getDocument(docKey);
  if (!raw) return [];
  try {
    const doc = JSON.parse(raw);
    return Array.isArray(doc.items) ? doc.items : [];
  } catch {
    return [];
  }
}

function setArtifacts(docKey, items) {
  db.setDocument(docKey, JSON.stringify({ items: Array.isArray(items) ? items : [] }));
}

const ARTIFACT_KEYS = {
  loadTests: 'loadTests',
  testSuites: 'testSuites',
  contractTests: 'contractTests',
  flows: 'flows',
  testSuiteSnapshots: 'testSuiteSnapshots',
};

/**
 * Import `{ "items": [...] }` JSON files for each test artifact kind (first DB init only).
 * @returns {boolean} true if at least one artifact document was written.
 */
function importArtifactDocumentsFromConfig() {
  let any = false;
  for (const key of Object.values(ARTIFACT_KEYS)) {
    const blob = readConfigJsonFile(key);
    if (blob && Array.isArray(blob.items)) {
      db.setDocument(key, JSON.stringify({ items: blob.items }));
      archiveConfigFile(key);
      any = true;
    }
  }
  return any;
}

module.exports = {
  initStores,
  getSettings,
  setSettings,
  getCollections,
  setCollections,
  getEnvironments,
  setEnvironments,
  getSession,
  setSession,
  getCookieJarJson,
  setCookieJarJson,
  getArtifacts,
  setArtifacts,
  ARTIFACT_KEYS,
};
