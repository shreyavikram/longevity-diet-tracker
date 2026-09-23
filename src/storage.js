import { DEFAULT_STATE, SCHEMA_VERSION, STORAGE_KEYS } from './constants.js';

const clone = value => structuredClone(value);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export class StorageValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StorageValidationError';
  }
}

export class StorageWriteError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'StorageWriteError';
  }
}

function assertRecord(value, path) {
  if (!isRecord(value)) throw new StorageValidationError(`${path} must be an object`);
}

function assertFiniteNumber(value, path, { min = -Infinity, max = Infinity } = {}) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new StorageValidationError(`${path} must be a finite number between ${min} and ${max}`);
  }
}

function validateProfile(value) {
  assertRecord(value, 'profile');
  if (!['female', 'male'].includes(value.sexForBmr)) {
    throw new StorageValidationError('profile.sexForBmr must be female or male');
  }
  assertFiniteNumber(value.age, 'profile.age', { min: 18, max: 120 });
  assertFiniteNumber(value.heightCm, 'profile.heightCm', { min: 100, max: 250 });
  assertFiniteNumber(value.weightKg, 'profile.weightKg', { min: 25, max: 400 });
  assertFiniteNumber(value.activityMultiplier, 'profile.activityMultiplier', { min: 1.1, max: 2.2 });
  assertFiniteNumber(value.liftDaysPerWeek, 'profile.liftDaysPerWeek', { min: 0, max: 6 });
  if (!['gentle', 'moderate', 'faster'].includes(value.pace)) {
    throw new StorageValidationError('profile.pace is invalid');
  }
}

function validateDateMap(value, path, validateValue = () => {}) {
  assertRecord(value, path);
  for (const [date, item] of Object.entries(value)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new StorageValidationError(`${path}.${date} is not a local YYYY-MM-DD date`);
    }
    validateValue(item, `${path}.${date}`);
  }
}

function validate(key, value) {
  if (key === 'profile') validateProfile(value);
  if (key === 'targets' || key === 'settings' || key === 'meta') assertRecord(value, key);
  if (key === 'library' || key === 'bodyMetrics' || key === 'recommendations') {
    if (!Array.isArray(value)) throw new StorageValidationError(`${key} must be an array`);
  }
  if (key === 'log') validateDateMap(value, key, (entries, path) => {
    if (!Array.isArray(entries)) throw new StorageValidationError(`${path} must be an array`);
  });
  if (key === 'water') validateDateMap(value, key, (amount, path) => {
    assertFiniteNumber(amount, path, { min: 0, max: 100000 });
  });
  if (key === 'dayState') validateDateMap(value, key, (day, path) => assertRecord(day, path));
  return value;
}

function mergeDefault(key, value) {
  const base = clone(DEFAULT_STATE[key]);
  return isRecord(base) && isRecord(value) ? { ...base, ...value } : clone(value);
}

function migrate(payload, now) {
  const sourceVersion = Number(payload.meta?.schemaVersion ?? 0);
  if (sourceVersion > SCHEMA_VERSION) {
    throw new StorageValidationError(`meta.schemaVersion ${sourceVersion} is newer than this app supports`);
  }
  const next = clone(payload);
  let currentVersion = sourceVersion;
  if (sourceVersion < 1) {
    next.meta = {
      ...clone(DEFAULT_STATE.meta),
      ...(isRecord(next.meta) ? next.meta : {}),
      schemaVersion: 1,
      migrations: [
        ...((Array.isArray(next.meta?.migrations) && next.meta.migrations) || []),
        { from: sourceVersion, to: 1, at: now().toISOString() }
      ]
    };
    currentVersion = 1;
  }
  if (currentVersion < 2) {
    next.meta = {
      ...clone(DEFAULT_STATE.meta),
      ...(isRecord(next.meta) ? next.meta : {}),
      schemaVersion: 2,
      migrations: [
        ...((Array.isArray(next.meta?.migrations) && next.meta.migrations) || []),
        { from: currentVersion, to: 2, at: now().toISOString() }
      ]
    };
  }
  return next;
}

export function createStore({ storage, now = () => new Date() }) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new TypeError('A Web Storage compatible object is required');
  }

  let migrationChecked = false;

  function readRaw(key) {
    const serialized = storage.getItem(key);
    if (serialized === null) return clone(DEFAULT_STATE[key]);
    try {
      const parsed = JSON.parse(serialized);
      return mergeDefault(key, validate(key, parsed));
    } catch (error) {
      if (error instanceof StorageValidationError) throw error;
      throw new StorageValidationError(`${key} contains invalid JSON`);
    }
  }

  function writeAtomically(prepared, message) {
    const snapshot = Object.fromEntries(STORAGE_KEYS.map(key => [key, storage.getItem(key)]));
    try {
      for (const key of STORAGE_KEYS) storage.setItem(key, JSON.stringify(prepared[key]));
    } catch (error) {
      for (const key of STORAGE_KEYS) {
        if (snapshot[key] === null) storage.removeItem(key);
        else storage.setItem(key, snapshot[key]);
      }
      throw new StorageWriteError(message, error);
    }
  }

  function ensureMigrated() {
    if (migrationChecked) return;
    if (storage.getItem('meta') === null) {
      migrationChecked = true;
      return;
    }
    const payload = Object.fromEntries(STORAGE_KEYS.map(key => [key, readRaw(key)]));
    const sourceVersion = Number(payload.meta?.schemaVersion ?? 0);
    if (sourceVersion === SCHEMA_VERSION) {
      migrationChecked = true;
      return;
    }
    const migrated = migrate(payload, now);
    const prepared = Object.fromEntries(STORAGE_KEYS.map(key => [
      key,
      mergeDefault(key, validate(key, key in migrated ? migrated[key] : DEFAULT_STATE[key]))
    ]));
    writeAtomically(prepared, 'Stored data could not be migrated. Existing data was restored.');
    migrationChecked = true;
  }

  function get(key) {
    if (!STORAGE_KEYS.includes(key)) throw new StorageValidationError(`Unknown storage key: ${key}`);
    ensureMigrated();
    return clone(readRaw(key));
  }

  function set(key, value) {
    if (!STORAGE_KEYS.includes(key)) throw new StorageValidationError(`Unknown storage key: ${key}`);
    const next = clone(validate(key, value));
    try {
      storage.setItem(key, JSON.stringify(next));
    } catch (error) {
      throw new StorageWriteError(`Unable to save ${key}. Export or clear older data and try again.`, error);
    }
    return clone(next);
  }

  function update(key, updater) {
    return set(key, updater(get(key)));
  }

  function loadAll() {
    return Object.fromEntries(STORAGE_KEYS.map(key => [key, get(key)]));
  }

  function exportData({ includeSecrets = false } = {}) {
    const payload = loadAll();
    if (!includeSecrets) {
      payload.settings.anthropicApiKey = '';
      payload.settings.geminiApiKey = '';
      payload.settings.foodDataCentralApiKey = '';
    }
    payload.exportedAt = now().toISOString();
    return JSON.stringify(payload, null, 2);
  }

  function importData(json, { includeSecrets = false } = {}) {
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new StorageValidationError('Import file is not valid JSON');
    }
    assertRecord(parsed, 'import');
    const migrated = migrate(parsed, now);
    const prepared = {};
    for (const key of STORAGE_KEYS) {
      const candidate = key in migrated ? migrated[key] : DEFAULT_STATE[key];
      prepared[key] = mergeDefault(key, validate(key, candidate));
    }
    if (!includeSecrets) {
      prepared.settings.anthropicApiKey = '';
      prepared.settings.geminiApiKey = '';
      prepared.settings.foodDataCentralApiKey = '';
    }
    writeAtomically(prepared, 'Import could not be saved. Existing data was restored.');
    migrationChecked = true;
    return loadAll();
  }

  function reset() {
    for (const key of STORAGE_KEYS) storage.removeItem(key);
    migrationChecked = false;
    return loadAll();
  }

  return { loadAll, get, set, update, exportData, importData, reset };
}
