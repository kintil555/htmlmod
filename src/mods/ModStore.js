import { CONFIG } from '../config.js';
import { ModError } from './Manifest.js';

const STORE = 'mods';
const memory = new Map();
let dbPromise = null;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return; }
    const r = indexedDB.open(CONFIG.mods.dbName, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbPromise;
}

/** Runs op(store) in IndexedDB and resolves once the transaction has committed (quota errors only show up there). Falls back to a session-only Map when IndexedDB is unavailable (private mode). */
async function run(mode, op, fallback) {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onabort = tx.onerror = () => reject(tx.error ?? req.error);
    });
  } catch (err) {
    if (err?.name === 'QuotaExceededError') throw new ModError('storageFull');
    return fallback();
  }
}

/** Persistent mod records: { id, manifest, enabled, installedAt, zip: Blob }. */
export const ModStore = {
  all: () => run('readonly', s => s.getAll(), () => [...memory.values()]),
  put: rec => run('readwrite', s => s.put(rec), () => { memory.set(rec.id, rec); }),
  delete: id => run('readwrite', s => s.delete(id), () => { memory.delete(id); }),
};
