import { CONFIG } from '../config.js';

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

const wrap = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

/** Runs op(store) in IndexedDB; falls back to a session-only Map when IndexedDB is unavailable (private mode). */
async function run(mode, op, fallback) {
  try {
    const db = await open();
    return await wrap(op(db.transaction(STORE, mode).objectStore(STORE)));
  } catch {
    return fallback();
  }
}

/** Persistent mod records: { id, manifest, enabled, installedAt, zip: Blob }. */
export const ModStore = {
  all: () => run('readonly', s => s.getAll(), () => [...memory.values()]),
  put: rec => run('readwrite', s => s.put(rec), () => { memory.set(rec.id, rec); }),
  delete: id => run('readwrite', s => s.delete(id), () => { memory.delete(id); }),
};
