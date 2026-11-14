// IndexedDB storage. Everything the app keeps lives here.
//
// Stores:
//   songs    { id, title, bpm, lengthSec, zoom, pdfId, createdAt, updatedAt }
//   pdfs     { id, data, fileName, pageCount }
//   setlists { id, name, songIds, createdAt, updatedAt }
//   meta     one record under the key "meta":
//            { schemaVersion, lastBackupAt, lastChangeAt }
//            (lastChangeAt is stamped on every save/delete, for the backup reminder)
//
// PDFs are stored as ArrayBuffers rather than Blobs. iPad Safari has a
// long-standing bug where Blobs read back from IndexedDB can become
// unreadable after a restart; plain bytes don't have that problem.

const DB_NAME = "setlist";
const DB_VERSION = 1;
export const SCHEMA_VERSION = 1;

/** An error with a message that's safe to show as-is. */
export class StorageError extends Error {}

function friendly(err, doing) {
  if (err instanceof StorageError) return err;
  const name = err && err.name;
  if (name === "QuotaExceededError") {
    return new StorageError(
      `The iPad is out of storage space, so ${doing} didn't work. Free up some space and try again.`
    );
  }
  const detail = err && err.message ? ` (${err.message})` : "";
  return new StorageError(`Something went wrong and ${doing} didn't work${detail}.`);
}

/** A random ID. Works over plain http too, where crypto.randomUUID isn't available. */
export function newId() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new StorageError("This browser can't store data, so the app can't run here."));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("songs")) db.createObjectStore("songs", { keyPath: "id" });
      if (!db.objectStoreNames.contains("pdfs")) {
        // The index lets the song list read file names and page counts
        // without loading any PDF bytes.
        db.createObjectStore("pdfs", { keyPath: "id" }).createIndex("info", ["fileName", "pageCount"]);
      }
      if (!db.objectStoreNames.contains("setlists")) db.createObjectStore("setlists", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta").put(
          { schemaVersion: SCHEMA_VERSION, lastBackupAt: null, lastChangeAt: null }, "meta");
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // If a newer version of the app opens the database in another tab,
      // step aside instead of blocking it.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(friendly(req.error, "opening your library"));
    req.onblocked = () =>
      reject(new StorageError("The app is open somewhere else. Close other copies and try again."));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Run `fn(stores)` inside one transaction. Resolves with fn's result only
 * after the transaction has fully committed, so "saved" really means saved.
 */
async function run(storeNames, mode, doing, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    let result;
    let tx;
    try {
      tx = db.transaction(storeNames, mode);
    } catch (err) {
      reject(friendly(err, doing));
      return;
    }
    const stores = {};
    for (const n of storeNames) stores[n] = tx.objectStore(n);
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(friendly(tx.error, doing));
    tx.onerror = (e) => e.preventDefault(); // let onabort report it once
    Promise.resolve()
      .then(() => fn(stores, tx))
      .then((r) => { result = r; })
      .catch((err) => {
        try { tx.abort(); } catch { /* already finished */ }
        reject(friendly(err, doing));
      });
  });
}

// ---------- Songs ----------

export function getAllSongs() {
  return run(["songs"], "readonly", "loading your songs", (s) => promisify(s.songs.getAll()));
}

export function getSong(id) {
  return run(["songs"], "readonly", "loading the song", (s) => promisify(s.songs.get(id)));
}

export function getPdf(id) {
  return run(["pdfs"], "readonly", "loading the chart", (s) => promisify(s.pdfs.get(id)));
}

/**
 * Create or update a song. If `newPdf` ({ data, fileName, pageCount }) is
 * given, it's stored and replaces the song's old PDF, all in one transaction.
 */
export function saveSong(fields, newPdf = null) {
  const now = Date.now();
  return run(["songs", "pdfs", "meta"], "readwrite", "saving the song", async (s) => {
    const existing = fields.id ? await promisify(s.songs.get(fields.id)) : null;
    const song = {
      zoom: 1,
      pdfId: null,
      createdAt: now,
      ...existing,
      ...fields,
      id: (existing && existing.id) || newId(),
      updatedAt: now,
    };
    if (newPdf) {
      const pdfId = newId();
      s.pdfs.put({ id: pdfId, data: newPdf.data, fileName: newPdf.fileName, pageCount: newPdf.pageCount });
      if (existing && existing.pdfId) s.pdfs.delete(existing.pdfId);
      song.pdfId = pdfId;
    }
    s.songs.put(song);
    await noteChange(s, now);
    return song;
  });
}

/** Delete a song, its PDF, and remove it from every setlist. */
export function deleteSong(id) {
  const now = Date.now();
  return run(["songs", "pdfs", "setlists", "meta"], "readwrite", "deleting the song", async (s) => {
    const song = await promisify(s.songs.get(id));
    if (!song) return;
    if (song.pdfId) s.pdfs.delete(song.pdfId);
    s.songs.delete(id);
    const lists = await promisify(s.setlists.getAll());
    for (const list of lists) {
      if (list.songIds.includes(id)) {
        s.setlists.put({ ...list, songIds: list.songIds.filter((x) => x !== id), updatedAt: now });
      }
    }
    await noteChange(s, now);
  });
}

// ---------- Meta, backup and restore ----------

const DEFAULT_META = { schemaVersion: SCHEMA_VERSION, lastBackupAt: null, lastChangeAt: null };

/**
 * Stamp meta.lastChangeAt inside a write transaction, so the app knows
 * there are changes that aren't in a backup yet (including deletions).
 */
async function noteChange(s, now) {
  const meta = (await promisify(s.meta.get("meta"))) || DEFAULT_META;
  s.meta.put({ ...DEFAULT_META, ...meta, lastChangeAt: now }, "meta");
}

/** { schemaVersion, lastBackupAt, lastChangeAt } */
export function getMeta() {
  return run(["meta"], "readonly", "loading your settings", async (s) => ({
    ...DEFAULT_META,
    ...(await promisify(s.meta.get("meta"))),
  }));
}

export function markBackedUp(at) {
  return run(["meta"], "readwrite", "recording the backup", async (s) => {
    const meta = (await promisify(s.meta.get("meta"))) || DEFAULT_META;
    s.meta.put({ ...DEFAULT_META, ...meta, lastBackupAt: at }, "meta");
  });
}

/** Everything, PDF bytes included, read as one consistent snapshot. */
export function exportAll() {
  return run(["songs", "pdfs", "setlists", "meta"], "readonly", "reading your library", async (s) => {
    const [songs, pdfs, setlists, meta] = await Promise.all([
      promisify(s.songs.getAll()),
      promisify(s.pdfs.getAll()),
      promisify(s.setlists.getAll()),
      promisify(s.meta.get("meta")),
    ]);
    return { songs, pdfs, setlists, meta: { ...DEFAULT_META, ...meta } };
  });
}

/** Counts for the restore confirmation, without loading PDF bytes. */
export function getCounts() {
  return run(["songs", "setlists"], "readonly", "reading your library", async (s) => {
    const [songs, setlists] = await Promise.all([
      promisify(s.songs.count()),
      promisify(s.setlists.count()),
    ]);
    return { songs, setlists };
  });
}

/**
 * Restore: wipe everything and write the backup's records, in one
 * transaction. If anything fails (like a full disk), nothing changes.
 */
export function replaceAll({ songs, pdfs, setlists, meta }) {
  return run(["songs", "pdfs", "setlists", "meta"], "readwrite", "restoring the backup", (s) => {
    s.songs.clear();
    s.pdfs.clear();
    s.setlists.clear();
    for (const p of pdfs) s.pdfs.put(p);
    for (const song of songs) s.songs.put(song);
    for (const list of setlists) s.setlists.put(list);
    s.meta.put({ ...DEFAULT_META, ...meta }, "meta");
  });
}

/** Map of pdfId -> { fileName, pageCount }, read from the index so no PDF bytes are loaded. */
export function getPdfInfo() {
  return run(["pdfs"], "readonly", "loading your charts", (s) =>
    new Promise((resolve, reject) => {
      const info = new Map();
      const req = s.pdfs.index("info").openKeyCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve(info);
        info.set(c.primaryKey, { fileName: c.key[0], pageCount: c.key[1] });
        c.continue();
      };
      req.onerror = () => reject(req.error);
    })
  );
}
