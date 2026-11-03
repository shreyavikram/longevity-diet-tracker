// The tracker keeps its data in IndexedDB (2026-11-02): Safari limits localStorage to about 5 MB per site, and her
// log reached that limit, so every save failed with "Unable to save log". createStore stays synchronous: this keeps
// each key in memory and writes every change through to IndexedDB in the background, in the order it was made.
export const DEVICE_DB = Object.freeze({ name: 'diet-tracker', store: 'kv', version: 1 });

const requestDone = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const committed = transaction => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error);
  transaction.onabort = () => reject(transaction.error ?? new DOMException('The save was cancelled.', 'AbortError'));
});

function openDatabase(indexedDB) {
  const request = indexedDB.open(DEVICE_DB.name, DEVICE_DB.version);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(DEVICE_DB.store)) request.result.createObjectStore(DEVICE_DB.store, { keyPath: 'key' });
  };
  return requestDone(request);
}

// Returns a Web Storage compatible object, plus flush() for tests. Where IndexedDB cannot open, or her data cannot be
// copied into it, localStorage itself is returned and keeps working as before.
export async function openDeviceStorage({ indexedDB = globalThis.indexedDB, legacy = globalThis.localStorage, keys, onError = () => {} }) {
  if (!indexedDB) return legacy;
  let db;
  const values = new Map();
  try {
    db = await openDatabase(indexedDB);
    const records = await requestDone(db.transaction(DEVICE_DB.store, 'readonly').objectStore(DEVICE_DB.store).getAll());
    for (const record of records) values.set(record.key, record.value);
  } catch {
    return legacy;
  }
  // The first open after this change copies the tracker's keys across, and frees localStorage only once IndexedDB
  // holds them. Other keys there (the USDA search cache, the remembered day) stay where they are.
  const leftovers = keys.map(key => [key, legacy?.getItem(key) ?? null]).filter(([, value]) => value !== null);
  if (!values.size && leftovers.length) {
    try {
      const move = db.transaction(DEVICE_DB.store, 'readwrite');
      for (const [key, value] of leftovers) move.objectStore(DEVICE_DB.store).put({ key, value });
      await committed(move);
    } catch (error) {
      onError(error);
      return legacy;
    }
    for (const [key, value] of leftovers) values.set(key, value);
  }
  for (const [key] of leftovers) legacy.removeItem(key);

  // Readwrite transactions on one store finish in the order they were created, so the latest one settling means
  // every earlier write has too.
  let latest = Promise.resolve();
  function persist(write) {
    try {
      const transaction = db.transaction(DEVICE_DB.store, 'readwrite');
      write(transaction.objectStore(DEVICE_DB.store));
      latest = committed(transaction).catch(onError);
    } catch (error) {
      onError(error);
    }
  }

  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem(key, value) {
      const text = String(value);
      values.set(key, text);
      persist(store => store.put({ key, value: text }));
    },
    removeItem(key) {
      values.delete(key);
      persist(store => store.delete(key));
    },
    flush: () => latest
  };
}
