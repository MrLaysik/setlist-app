// Backup and restore.
//
// A backup is one .zip:
//   data.json        { format, schemaVersion, appVersion, exportedAt, meta,
//                      songs, setlists, pdfs: [{ id, fileName, pageCount }] }
//   pdfs/<id>.pdf    one file per chart
//
// Restore checks the whole file before touching anything, then replaces
// everything in one transaction (see replaceAll in db.js).

import { exportAll, replaceAll, markBackedUp, SCHEMA_VERSION } from "./db.js";

const FORMAT = "setlist-backup";
const JSZIP_URL = new URL("../vendor/jszip/jszip.min.js", import.meta.url).href;
const DAY = 24 * 60 * 60 * 1000;
export const REMIND_AFTER_DAYS = 14;

/** An error whose message is written for people. */
export class BackupError extends Error {}

// ---------- JSZip (classic script, loaded on first use) ----------

let zipLib = null;
function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (!zipLib) {
    zipLib = new Promise((resolve, reject) => {
      const sc = document.createElement("script");
      sc.src = JSZIP_URL;
      sc.onload = () => (window.JSZip ? resolve(window.JSZip) : reject(new Error("no JSZip")));
      sc.onerror = () => reject(new Error("load failed"));
      document.head.append(sc);
    }).catch(() => {
      zipLib = null;
      throw new BackupError("The zip tool didn't load. Close and reopen the app, then try again.");
    });
  }
  return zipLib;
}

// ---------- Formatting ----------

export function formatBytes(n) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(ms) {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Whole calendar days between two times (today = 0, yesterday = 1). */
function daysBetween(then, now) {
  const a = new Date(then); a.setHours(0, 0, 0, 0);
  const b = new Date(now); b.setHours(0, 0, 0, 0);
  return Math.round((b - a) / DAY);
}

export function describeLastBackup(meta, now = Date.now()) {
  if (!meta.lastBackupAt) return "Never backed up.";
  const days = daysBetween(meta.lastBackupAt, now);
  if (days <= 0) {
    const t = new Date(meta.lastBackupAt).toLocaleTimeString(undefined, { timeStyle: "short" });
    return `Last backed up today at ${t}.`;
  }
  if (days === 1) return "Last backed up yesterday.";
  return `Last backed up ${days} days ago.`;
}

export function hasUnbackedChanges(meta) {
  return !!meta.lastChangeAt && (!meta.lastBackupAt || meta.lastChangeAt > meta.lastBackupAt);
}

/** The gentle reminder text, or null when no reminder is due. */
export function backupReminder(meta, songCount, now = Date.now()) {
  if (!songCount) return null;
  if (!meta.lastBackupAt) return "Your songs aren't backed up yet.";
  const days = daysBetween(meta.lastBackupAt, now);
  if (days >= REMIND_AFTER_DAYS) return `It's been ${days} days since your last backup.`;
  if (hasUnbackedChanges(meta)) return "You've made changes since your last backup.";
  return null;
}

// ---------- Backup ----------

function fileStamp(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * Build the backup zip. onProgress(percent) is called while zipping.
 * Returns { file, exportedAt, songCount, setlistCount, pdfCount }.
 */
export async function buildBackup(appVersion, onProgress) {
  const JSZip = await loadJSZip();
  const { songs, pdfs, setlists } = await exportAll();
  const exportedAt = Date.now();

  const data = {
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    appVersion,
    exportedAt,
    meta: { schemaVersion: SCHEMA_VERSION, lastBackupAt: exportedAt },
    songs,
    setlists,
    pdfs: pdfs.map(({ id, fileName, pageCount }) => ({ id, fileName, pageCount })),
  };

  const zip = new JSZip();
  zip.file("data.json", JSON.stringify(data, null, 2), { compression: "DEFLATE" });
  // PDFs are already compressed; storing them as-is is faster and just as small.
  for (const p of pdfs) zip.file(`pdfs/${p.id}.pdf`, p.data, { binary: true, compression: "STORE" });

  let blob;
  try {
    blob = await zip.generateAsync({ type: "blob", mimeType: "application/zip" }, (m) => {
      if (onProgress) onProgress(m.percent);
    });
  } catch (err) {
    console.error("Backup zip failed:", err);
    throw new BackupError("The backup file couldn't be built. The iPad may be low on memory or storage. Try again.");
  }

  const file = new File([blob], `setlist-backup-${fileStamp(new Date(exportedAt))}.zip`, {
    type: "application/zip",
  });
  return { file, exportedAt, songCount: songs.length, setlistCount: setlists.length, pdfCount: pdfs.length };
}

export function canShareFile(file) {
  try {
    return !!(navigator.canShare && navigator.canShare({ files: [file] }));
  } catch {
    return false;
  }
}

/**
 * Open the share sheet (Save to Files, iCloud Drive, AirDrop…). Must be
 * called straight from a tap. Resolves true if saved, false if cancelled.
 */
export async function shareBackup(backup) {
  try {
    // Files only: adding a title or text makes some iPad targets save an extra file.
    await navigator.share({ files: [backup.file] });
  } catch (err) {
    if (err && err.name === "AbortError") return false;
    console.error("Share failed:", err);
    throw new BackupError("The share sheet didn't work. Try Download instead.");
  }
  await markBackedUp(backup.exportedAt);
  return true;
}

/** Fallback: a normal browser download (handy on the Mac). */
export async function downloadBackup(backup) {
  const url = URL.createObjectURL(backup.file);
  const a = document.createElement("a");
  a.href = url;
  a.download = backup.file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  await markBackedUp(backup.exportedAt);
}

// ---------- Restore ----------

const damaged = (what) => new BackupError(`This backup is damaged: ${what}. Nothing was changed.`);

const isStr = (v) => typeof v === "string" && v.length > 0;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Open a backup zip and check all of it. Nothing is written.
 * onProgress(done, total) is called while charts are checked.
 */
export async function readBackup(file, onProgress) {
  const JSZip = await loadJSZip();

  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new BackupError("That file couldn't be opened as a .zip. Pick a backup made by this app.");
  }

  const dataEntry = zip.file("data.json");
  if (!dataEntry) throw new BackupError("That .zip isn't a Setlist backup (there's no data.json inside).");

  let data;
  try {
    data = JSON.parse(await dataEntry.async("string"));
  } catch {
    throw damaged("its data file can't be read");
  }
  if (!data || data.format !== FORMAT) throw new BackupError("That .zip isn't a Setlist backup.");
  if (!isNum(data.schemaVersion)) throw damaged("it has no version number");
  if (data.schemaVersion > SCHEMA_VERSION) {
    throw new BackupError(
      "This backup was made by a newer version of the app. Close and reopen the app to update it, then try again."
    );
  }
  if (!Array.isArray(data.songs) || !Array.isArray(data.setlists) || !Array.isArray(data.pdfs)) {
    throw damaged("its song, setlist or chart list is missing");
  }
  const exportedAt = isNum(data.exportedAt) ? data.exportedAt : Date.now();

  // Chart records
  const pdfMeta = new Map();
  for (const p of data.pdfs) {
    if (!p || !isStr(p.id) || pdfMeta.has(p.id)) throw damaged("a chart entry is invalid");
    pdfMeta.set(p.id, {
      id: p.id,
      fileName: isStr(p.fileName) ? p.fileName : "chart.pdf",
      pageCount: isNum(p.pageCount) && p.pageCount >= 1 ? Math.round(p.pageCount) : 1,
    });
  }

  // Songs
  const songIds = new Set();
  const titleForPdf = new Map();
  const songs = data.songs.map((s, i) => {
    if (!s || !isStr(s.id) || songIds.has(s.id)) throw damaged(`song ${i + 1} has a missing or repeated ID`);
    const name = isStr(s.title) ? s.title : `song ${i + 1}`;
    if (!isStr(s.title)) throw damaged(`${name} has no title`);
    if (!isNum(s.bpm) || s.bpm <= 0) throw damaged(`“${name}” has an invalid tempo`);
    if (!isNum(s.lengthSec) || s.lengthSec <= 0) throw damaged(`“${name}” has an invalid length`);
    const pdfId = s.pdfId == null ? null : s.pdfId;
    if (pdfId !== null && !pdfMeta.has(pdfId)) throw damaged(`the chart for “${name}” is missing`);
    songIds.add(s.id);
    if (pdfId) titleForPdf.set(pdfId, name);
    return {
      id: s.id,
      title: s.title,
      bpm: s.bpm,
      lengthSec: s.lengthSec,
      zoom: isNum(s.zoom) && s.zoom > 0 ? s.zoom : 1,
      pdfId,
      createdAt: isNum(s.createdAt) ? s.createdAt : exportedAt,
      updatedAt: isNum(s.updatedAt) ? s.updatedAt : exportedAt,
    };
  });

  // Setlists
  const listIds = new Set();
  const setlists = data.setlists.map((l, i) => {
    if (!l || !isStr(l.id) || listIds.has(l.id)) throw damaged(`setlist ${i + 1} has a missing or repeated ID`);
    if (!isStr(l.name)) throw damaged(`setlist ${i + 1} has no name`);
    if (!Array.isArray(l.songIds)) throw damaged(`“${l.name}” has no song list`);
    for (const id of l.songIds) {
      if (!songIds.has(id)) throw damaged(`“${l.name}” lists a song that isn't in the backup`);
    }
    listIds.add(l.id);
    return {
      id: l.id,
      name: l.name,
      songIds: [...l.songIds],
      createdAt: isNum(l.createdAt) ? l.createdAt : exportedAt,
      updatedAt: isNum(l.updatedAt) ? l.updatedAt : exportedAt,
    };
  });

  // Chart files: every one must be present and actually be a PDF.
  const pdfs = [];
  let totalBytes = 0;
  let done = 0;
  for (const meta of pdfMeta.values()) {
    const label = titleForPdf.has(meta.id) ? `the chart for “${titleForPdf.get(meta.id)}”` : `chart ${meta.fileName}`;
    const entry = zip.file(`pdfs/${meta.id}.pdf`);
    if (!entry) throw damaged(`${label} is missing`);
    let bytes;
    try {
      bytes = await entry.async("arraybuffer");
    } catch {
      throw damaged(`${label} can't be read`);
    }
    const head = new TextDecoder("latin1").decode(new Uint8Array(bytes, 0, Math.min(1024, bytes.byteLength)));
    if (!head.includes("%PDF-")) throw damaged(`${label} isn't a PDF`);
    pdfs.push({ ...meta, data: bytes });
    totalBytes += bytes.byteLength;
    done++;
    if (onProgress) onProgress(done, pdfMeta.size);
  }

  return { exportedAt, songs, setlists, pdfs, totalBytes };
}

/** Replace everything in the app with a backup returned by readBackup(). */
export function restoreBackup(backup) {
  return replaceAll({
    songs: backup.songs,
    setlists: backup.setlists,
    pdfs: backup.pdfs,
    // The app now matches that backup exactly, so it counts as backed up then.
    meta: { schemaVersion: SCHEMA_VERSION, lastBackupAt: backup.exportedAt, lastChangeAt: backup.exportedAt },
  });
}
