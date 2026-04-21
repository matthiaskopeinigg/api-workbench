const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { logInfo, logError } = require('./logger.service');
const db = require('../db/database');

function getLegacyConfigDir() {
  if (app.isPackaged) {
    return path.join(path.dirname(app.getPath('exe')), 'configs');
  }
  return path.join(app.getAppPath(), 'configs');
}

function readLegacyStoreJson(fileBaseName) {
  const dir = getLegacyConfigDir();
  const filePath = path.join(dir, `${fileBaseName}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    logError(`Failed to read legacy store ${fileBaseName}`, e);
    return null;
  }
}

function archiveLegacyFile(fileBaseName) {
  const dir = getLegacyConfigDir();
  const filePath = path.join(dir, `${fileBaseName}.json`);
  if (!fs.existsSync(filePath)) {
    return;
  }
  const archived = `${filePath}.migrated.${Date.now()}.bak`;
  try {
    fs.renameSync(filePath, archived);
    logInfo('Archived legacy electron-store file', { from: filePath, to: archived });
  } catch (e) {
    logError('Failed to archive legacy store file', e);
  }
}

function importLegacyIfEmpty() {
  const hasAny = db.getDocument('settings') || db.getDocument('collections');
  if (hasAny) {
    return;
  }

  const settingsBlob = readLegacyStoreJson('settings');
  if (settingsBlob && settingsBlob.settings !== undefined) {
    db.setDocument('settings', JSON.stringify(settingsBlob));
    archiveLegacyFile('settings');
  }

  const collectionsBlob = readLegacyStoreJson('collections');
  if (collectionsBlob && collectionsBlob.collections !== undefined) {
    db.setDocument('collections', JSON.stringify(collectionsBlob));
    archiveLegacyFile('collections');
  }

  const environmentsBlob = readLegacyStoreJson('environments');
  if (environmentsBlob && environmentsBlob.environments !== undefined) {
    db.setDocument('environments', JSON.stringify(environmentsBlob));
    archiveLegacyFile('environments');
  }

  const sessionBlob = readLegacyStoreJson('session');
  if (sessionBlob && typeof sessionBlob === 'object') {
    for (const [key, value] of Object.entries(sessionBlob)) {
      if (key === 'version' || key === 'size') {
        continue;
      }
      db.setSessionKey(key, value);
    }
    archiveLegacyFile('session');
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
