// Settings screen: backup and restore.

import { $, plural, toast, confirmDialog } from "./ui.js";
import { getMeta, getCounts } from "./db.js";
import {
  buildBackup, shareBackup, downloadBackup, canShareFile, readBackup, restoreBackup,
  describeLastBackup, hasUnbackedChanges, formatBytes, formatDate,
} from "./backup.js";
import { storageProtected, offlineReady } from "./offline.js";

let appVersion = "";
let installed = false;
let ready = null;   // a built backup waiting to be saved
let busy = false;
let onDataChanged = () => {};

function msg(el, text, bad = false) {
  el.textContent = text || "";
  el.classList.toggle("bad", !!bad);
}
const backupMsg = (t, bad) => msg($("#backupMsg"), t, bad);
const restoreMsg = (t, bad) => msg($("#restoreMsg"), t, bad);

function setBusy(b) {
  busy = b;
  for (const id of ["#backupBtn", "#backupShare", "#backupDownload", "#restoreFile", "#setBack"]) {
    $(id).disabled = b;
  }
}

async function refreshStatus() {
  try {
    const meta = await getMeta();
    let text = describeLastBackup(meta);
    if (meta.lastBackupAt && hasUnbackedChanges(meta)) text += " You've made changes since then.";
    $("#backupStatus").textContent = text;
  } catch (err) {
    $("#backupStatus").textContent = err.message;
  }
  await Promise.all([renderStorage(), renderOffline()]);
}

async function renderStorage() {
  const state = await storageProtected();
  const [status, help] =
    state === true ? ["Protected", "iPadOS won't clear your songs and charts to free up space."]
    : state === false ? ["Not protected", installed
        ? "If the iPad runs very low on space, iPadOS could clear the app's data. Keep regular backups."
        : "Add Setlist to the home screen and open it from there to protect your songs and charts. Until then, keep regular backups."]
    : ["Can't be protected", "This browser can't protect stored data. Keep regular backups."];
  $("#storageStatus").textContent = status;
  $("#storageHelp").textContent = help;
}

async function renderOffline() {
  $("#offlineStatus").textContent = (await offlineReady(appVersion))
    ? "Saved on this device: works with no connection."
    : "Not saved for offline use yet. Open the app once with a connection, then check again.";
}

function renderReady() {
  $("#backupReady").hidden = !ready;
  if (!ready) return;
  const { file, songCount, setlistCount, pdfCount } = ready;
  $("#backupReadyText").textContent =
    `Backup ready: ${plural(songCount, "song")}, ${plural(setlistCount, "setlist")} and ` +
    `${plural(pdfCount, "chart")} (${formatBytes(file.size)}). Now save it somewhere safe.`;
  $("#backupShare").hidden = !canShareFile(file);
}

async function onBackup() {
  if (busy) return;
  ready = null;
  renderReady();
  setBusy(true);
  backupMsg("Building backup…");
  try {
    ready = await buildBackup(appVersion, (pct) => backupMsg(`Building backup… ${Math.round(pct)}%`));
    backupMsg("");
    renderReady();
  } catch (err) {
    backupMsg(err.message, true);
  } finally {
    setBusy(false);
  }
}

async function afterSaved(text) {
  ready = null;
  renderReady();
  backupMsg(text);
  await refreshStatus();
  onDataChanged();
}

function onShare() {
  if (busy || !ready) return;
  // Call share straight away: iPad Safari only allows it right after a tap.
  const sharing = shareBackup(ready);
  setBusy(true);
  sharing
    .then((saved) => {
      if (saved) return afterSaved("Backup saved.");
      backupMsg("Not saved yet. Tap Save or share… when you're ready.");
    })
    .catch((err) => backupMsg(err.message, true))
    .finally(() => setBusy(false));
}

async function onDownload() {
  if (busy || !ready) return;
  setBusy(true);
  try {
    await downloadBackup(ready);
    await afterSaved("Backup downloaded. Check your Downloads folder.");
  } catch (err) {
    backupMsg(err.message, true);
  } finally {
    setBusy(false);
  }
}

async function onRestorePick(e) {
  const input = e.target;
  const file = input.files && input.files[0];
  input.value = ""; // picking the same file again should still work
  if (!file || busy) return;

  setBusy(true);
  restoreMsg("Checking backup…");
  try {
    const backup = await readBackup(file, (done, total) =>
      restoreMsg(`Checking charts: ${done} of ${total}…`)
    );
    const [counts, meta] = await Promise.all([getCounts(), getMeta()]);
    restoreMsg("");

    let message =
      `The backup from ${formatDate(backup.exportedAt)} has ${plural(backup.songs.length, "song")}, ` +
      `${plural(backup.setlists.length, "setlist")} and ${plural(backup.pdfs.length, "chart")} ` +
      `(${formatBytes(backup.totalBytes)}).`;
    if (counts.songs || counts.setlists) {
      message += ` It will replace the ${plural(counts.songs, "song")} and ` +
        `${plural(counts.setlists, "setlist")} in the app now.`;
      if (hasUnbackedChanges(meta)) message += " Some of your current changes aren't in any backup.";
    }
    message += " You can't undo this.";

    const yes = await confirmDialog({
      title: "Replace everything?",
      message,
      confirmLabel: "Replace everything",
      danger: true,
    });
    if (!yes) {
      restoreMsg("Restore cancelled. Nothing was changed.");
      return;
    }

    restoreMsg("Restoring…");
    await restoreBackup(backup);
    const done = `Restored ${plural(backup.songs.length, "song")} and ${plural(backup.setlists.length, "setlist")}.`;
    restoreMsg(done);
    toast(done);
    ready = null;
    renderReady();
    await refreshStatus();
    onDataChanged();
  } catch (err) {
    restoreMsg(err.message, true);
  } finally {
    setBusy(false);
  }
}

/** Wire up the screen. Call once at startup. */
export function initSettings({ version, versionText, isInstalled, onChanged }) {
  appVersion = version;
  installed = !!isInstalled;
  onDataChanged = onChanged || onDataChanged;
  $("#setVersion").textContent = versionText;
  $("#backupBtn").addEventListener("click", onBackup);
  $("#backupShare").addEventListener("click", onShare);
  $("#backupDownload").addEventListener("click", onDownload);
  $("#restoreFile").addEventListener("change", onRestorePick);
}

/** Call each time the screen is shown. */
export function openSettings() {
  if (!busy) {
    ready = null;
    renderReady();
    backupMsg("");
    restoreMsg("");
  }
  return refreshStatus();
}

export function isSettingsBusy() {
  return busy;
}
