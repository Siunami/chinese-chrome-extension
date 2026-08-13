// Minimal IndexedDB promise wrapper. One store for card docs (live cards and
// tombstones alike, keyed by cardKey) and one key-value store for sync
// bookkeeping. The server is the source of truth — if the browser ever
// evicts this database, re-pairing restores everything.

import { cardKey } from './lib/merge.js';

const DB_NAME = 'zhongwen-flashcards';
const DB_VERSION = 1;

let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('cards');
        req.result.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// Every stored doc — live cards and tombstones mixed; callers filter on
// .deleted.
export async function allDocs() {
  const db = await open();
  const tx = db.transaction('cards');
  const req = tx.objectStore('cards').getAll();
  await done(tx);
  return req.result || [];
}

export async function putDocs(docs) {
  if (!docs.length) return;
  const db = await open();
  const tx = db.transaction('cards', 'readwrite');
  for (const doc of docs) tx.objectStore('cards').put(doc, cardKey(doc));
  await done(tx);
}

export async function getMeta(key, fallback = null) {
  const db = await open();
  const tx = db.transaction('meta');
  const req = tx.objectStore('meta').get(key);
  await done(tx);
  return req.result === undefined ? fallback : req.result;
}

export async function setMeta(values) {
  const db = await open();
  const tx = db.transaction('meta', 'readwrite');
  for (const [key, value] of Object.entries(values)) {
    tx.objectStore('meta').put(value, key);
  }
  await done(tx);
}

// Unpair: forget everything, including cards (they live on in the server and
// the extension).
export async function wipe() {
  const db = await open();
  const tx = db.transaction(['cards', 'meta'], 'readwrite');
  tx.objectStore('cards').clear();
  tx.objectStore('meta').clear();
  await done(tx);
}
