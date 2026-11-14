// The song settings sheet: add a song, edit one, replace its PDF, delete it.

import { $, plural, confirmDialog } from "./ui.js";
import { saveSong, deleteSong } from "./db.js";
import { inspectPdf } from "./charts.js";

const BPM_MIN = 30;
const BPM_MAX = 300;
const DEFAULT_BPM = 120;

let cur = null; // the sheet's state while it's open
let pickToken = 0;

const dlg = () => $("#songSheet");

function clampBpm(v, fallback) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(BPM_MAX, Math.max(BPM_MIN, n));
}

function formValues() {
  return [$("#fTitle").value, $("#fBpm").value, $("#fMin").value, $("#fSec").value].join("\u0000");
}

function isDirty() {
  return cur && (cur.pendingPdf || formValues() !== cur.snapshot);
}

function setError(msg) {
  const el = $("#formError");
  el.textContent = msg || "";
  el.hidden = !msg;
}

function setBusy(busy, label) {
  cur.busy = busy;
  for (const id of ["#sSave", "#sDelete", "#sCancel", "#viewChart", "#fPdf"]) $(id).disabled = busy;
  $("#sSave").textContent = label || "Save";
}

function showPdfStatus() {
  const st = $("#pdfStatus");
  st.classList.remove("bad");
  if (cur.pendingPdf) {
    const p = cur.pendingPdf;
    st.textContent = `New chart: ${p.fileName}, ${plural(p.pageCount, "page")}. Save to keep it.`;
  } else if (cur.pdfInfo) {
    st.textContent = `${cur.pdfInfo.fileName}, ${plural(cur.pdfInfo.pageCount, "page")}`;
  } else {
    st.textContent = "No chart yet.";
  }
  const hasChart = cur.pendingPdf || cur.pdfInfo;
  $("#pdfPick").textContent = hasChart ? "Replace PDF" : "Choose PDF";
  $("#viewChart").hidden = !(cur.song && cur.song.pdfId && cur.onViewChart);
}

/**
 * Open the sheet. `song` is null to add a new one.
 * opts: { pdfInfo, onSaved(song), onDeleted(id), onViewChart(id) }
 */
export function openSongSheet(song, opts = {}) {
  cur = { song, pdfInfo: opts.pdfInfo || null, pendingPdf: null, busy: false, ...opts };
  pickToken++;

  $("#sheetTitle").textContent = song ? "Song settings" : "Add song";
  $("#fTitle").value = song ? song.title : "";
  $("#fBpm").value = song ? song.bpm : DEFAULT_BPM;
  $("#fMin").value = song ? Math.floor(song.lengthSec / 60) : "";
  $("#fSec").value = song ? String(song.lengthSec % 60).padStart(2, "0") : "";
  $("#fPdf").value = "";
  $("#sDelete").hidden = !song;
  setError(null);
  setBusy(false);
  showPdfStatus();
  cur.snapshot = formValues();

  dlg().showModal();
  // New song: go straight to the title. Editing: don't pop the keyboard.
  if (song) $("#sheetTitle").focus();
  else $("#fTitle").focus();
}

function close() {
  pickToken++;
  if (dlg().open) dlg().close();
  cur = null;
}

async function onPickPdf(e) {
  const input = e.target;
  const file = input.files && input.files[0];
  input.value = ""; // so picking the same file again still counts as a change
  if (!file || !cur) return;
  const st = $("#pdfStatus");
  setError(null);

  if (file.type && file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
    st.textContent = `${file.name} isn't a PDF. Pick a PDF file.`;
    st.classList.add("bad");
    return;
  }

  const my = ++pickToken;
  st.classList.remove("bad");
  st.textContent = `Opening ${file.name}…`;
  setBusy(true, "Save");
  try {
    const pdf = await inspectPdf(file);
    if (my !== pickToken) return;
    cur.pendingPdf = pdf;
    showPdfStatus();
  } catch (err) {
    if (my !== pickToken) return;
    cur.pendingPdf = null;
    showPdfStatus();
    st.textContent = `${file.name}: ${err.message}`;
    st.classList.add("bad");
  } finally {
    if (my === pickToken) setBusy(false);
  }
}

function readForm() {
  const title = $("#fTitle").value.trim();
  if (!title) return { error: "Give the song a title.", focus: "#fTitle" };

  const bpm = parseInt($("#fBpm").value, 10);
  if (Number.isNaN(bpm) || bpm < BPM_MIN || bpm > BPM_MAX) {
    return { error: `Tempo should be between ${BPM_MIN} and ${BPM_MAX} BPM.`, focus: "#fBpm" };
  }

  const minRaw = $("#fMin").value.trim();
  const secRaw = $("#fSec").value.trim();
  if (!minRaw && !secRaw) return { error: "Enter the song length, like 3:45.", focus: "#fMin" };
  const min = minRaw ? parseInt(minRaw, 10) : 0;
  const sec = secRaw ? parseInt(secRaw, 10) : 0;
  if (Number.isNaN(min) || min < 0 || min > 99) return { error: "Minutes should be between 0 and 99.", focus: "#fMin" };
  if (Number.isNaN(sec) || sec < 0 || sec > 59) return { error: "Seconds should be between 0 and 59.", focus: "#fSec" };
  const lengthSec = min * 60 + sec;
  if (lengthSec < 1) return { error: "The song needs a length longer than 0:00.", focus: "#fMin" };

  return { fields: { title, bpm, lengthSec } };
}

async function onSave(e) {
  e.preventDefault();
  if (!cur || cur.busy) return;
  const { error, focus, fields } = readForm();
  if (error) {
    setError(error);
    $(focus).focus();
    return;
  }
  setError(null);
  setBusy(true, "Saving…");
  try {
    const song = await saveSong({ ...(cur.song ? { id: cur.song.id } : {}), ...fields }, cur.pendingPdf);
    const { onSaved } = cur;
    close();
    if (onSaved) onSaved(song);
  } catch (err) {
    setBusy(false);
    setError(err.message);
  }
}

async function onDelete() {
  if (!cur || cur.busy || !cur.song) return;
  const { song } = cur;
  const yes = await confirmDialog({
    title: `Delete “${song.title}”?`,
    message: "This removes the song and its chart from your library and from every setlist. You can't undo this.",
    confirmLabel: "Delete song",
    danger: true,
  });
  if (!yes || !cur) return;
  setBusy(true);
  try {
    await deleteSong(song.id);
    const { onDeleted } = cur;
    close();
    if (onDeleted) onDeleted(song.id);
  } catch (err) {
    setBusy(false);
    setError(err.message);
  }
}

async function onViewChart() {
  if (!cur || cur.busy || !cur.song) return;
  if (isDirty()) {
    const yes = await confirmDialog({
      title: "Discard changes?",
      message: "You have changes that aren't saved yet.",
      confirmLabel: "Discard",
      danger: true,
    });
    if (!yes || !cur) return;
  }
  const { song, onViewChart: go } = cur;
  close();
  go(song.id);
}

function stepBpm(delta) {
  const v = clampBpm($("#fBpm").value, DEFAULT_BPM);
  $("#fBpm").value = Math.min(BPM_MAX, Math.max(BPM_MIN, v + delta));
}

/** Wire up the sheet's controls. Call once at startup. */
export function initSongSheet() {
  $("#sheetTitle").tabIndex = -1;
  $("#songForm").addEventListener("submit", onSave);
  $("#fPdf").addEventListener("change", onPickPdf);
  $("#sDelete").addEventListener("click", onDelete);
  $("#viewChart").addEventListener("click", onViewChart);
  $("#sCancel").addEventListener("click", () => { if (cur && !cur.busy) close(); });
  $("#bpmDown").addEventListener("click", () => stepBpm(-1));
  $("#bpmUp").addEventListener("click", () => stepBpm(1));
  // Escape key: same as Cancel, but never mid-save.
  dlg().addEventListener("cancel", (e) => {
    e.preventDefault();
    if (cur && !cur.busy) close();
  });
}
