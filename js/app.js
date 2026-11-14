// Setlist app entry point: views, the library, and startup.

import { $, h, fmtTime, plural, toast } from "./ui.js";
import { openDb, getAllSongs, getPdfInfo, getMeta } from "./db.js";
import { initSongSheet, openSongSheet } from "./song-sheet.js";
import { openChartView, closeChartView, reloadChartView, currentChartSongId } from "./chart-view.js";
import { initSettings, openSettings } from "./settings.js";
import { backupReminder } from "./backup.js";

const APP_VERSION = "0.2.0";

const state = {
  view: "library",
  tab: "songs",       // Setlists arrive in Milestone 3
  songs: [],
  pdfInfo: new Map(), // pdfId -> { fileName, pageCount }
  meta: null,
  reminderSnoozed: false, // "Later" hides the backup reminder until the app is reopened
};

function isInstalled() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

// ---------- Views ----------

function show(view) {
  state.view = view;
  $("#library").hidden = view !== "library";
  $("#chartView").hidden = view !== "chartView";
  $("#settings").hidden = view !== "settings";
  document.documentElement.classList.toggle("stage", view === "chartView");
}

async function goToChart(id) {
  show("chartView");
  await openChartView(id);
}

function goToLibrary() {
  closeChartView();
  show("library");
  refreshLibrary();
}

function goToSettings() {
  show("settings");
  openSettings();
}

// ---------- Library ----------

const byTitle = (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });

async function refreshLibrary() {
  try {
    const [songs, pdfInfo, meta] = await Promise.all([getAllSongs(), getPdfInfo(), getMeta()]);
    state.songs = songs.sort(byTitle);
    state.pdfInfo = pdfInfo;
    state.meta = meta;
  } catch (err) {
    toast(err.message, { error: true });
  }
  renderLibrary();
}

function songRow(song) {
  const info = song.pdfId && state.pdfInfo.get(song.pdfId);
  const sub = info ? plural(info.pageCount, "page") : "No chart yet";
  return h("li", {},
    h("button", { className: "row", onclick: () => editSong(song) },
      h("div", { className: "row-main" },
        h("div", { className: "row-title" }, song.title),
        h("p", { className: "row-sub" }, sub)),
      h("div", { className: "row-meta" },
        h("span", {}, `${song.bpm} BPM`),
        h("span", {}, fmtTime(song.lengthSec)))));
}

function renderLibrary() {
  const songsTab = state.tab === "songs";
  $("#libTitle").textContent = songsTab ? "Songs" : "Setlists";
  $("#tabSongs").setAttribute("aria-selected", String(songsTab));
  $("#tabSets").setAttribute("aria-selected", String(!songsTab));
  $("#addSong").hidden = !songsTab;

  const reminder = state.meta && !state.reminderSnoozed ? backupReminder(state.meta, state.songs.length) : null;
  $("#reminder").hidden = !reminder;
  $("#reminderText").textContent = reminder || "";

  const list = $("#libList");
  const empty = $("#libEmpty");
  if (songsTab) {
    list.replaceChildren(...state.songs.map(songRow));
    empty.textContent = "No songs yet. Tap Add song to add your first chart.";
    empty.hidden = state.songs.length > 0;
  } else {
    list.replaceChildren();
    empty.textContent = "Setlists come in a later step. For now, add your songs.";
    empty.hidden = false;
  }
}

// ---------- Song sheet ----------

function sheetOptions(song) {
  const inChart = state.view === "chartView";
  return {
    pdfInfo: song && song.pdfId ? state.pdfInfo.get(song.pdfId) : null,
    onSaved: () => {
      refreshLibrary();
      if (inChart) reloadChartView();
    },
    onDeleted: () => {
      if (inChart) goToLibrary();
      else refreshLibrary();
    },
    // From the library you can jump to the chart; inside the chart you're already there.
    onViewChart: inChart ? null : goToChart,
  };
}

function editSong(song) {
  openSongSheet(song, sheetOptions(song));
}

// ---------- Startup ----------

function wire() {
  $("#tabSongs").addEventListener("click", () => { state.tab = "songs"; renderLibrary(); });
  $("#tabSets").addEventListener("click", () => { state.tab = "setlists"; renderLibrary(); });
  $("#addSong").addEventListener("click", () => openSongSheet(null, sheetOptions(null)));
  $("#cvBack").addEventListener("click", goToLibrary);
  $("#openSettings").addEventListener("click", goToSettings);
  $("#setBack").addEventListener("click", goToLibrary);
  $("#reminderGo").addEventListener("click", goToSettings);
  $("#reminderLater").addEventListener("click", () => { state.reminderSnoozed = true; renderLibrary(); });
  $("#cvEdit").addEventListener("click", async () => {
    const id = currentChartSongId();
    if (!id) return;
    // Fetch fresh so the sheet shows exactly what's stored.
    try {
      const [songs, pdfInfo] = await Promise.all([getAllSongs(), getPdfInfo()]);
      state.pdfInfo = pdfInfo;
      const song = songs.find((s) => s.id === id);
      if (song) openSongSheet(song, sheetOptions(song));
    } catch (err) {
      toast(err.message, { error: true });
    }
  });
  // Block the browser's own pinch-zoom of the whole page.
  document.addEventListener("gesturestart", (e) => e.preventDefault());
}

async function start() {
  initSongSheet();
  initSettings({
    version: APP_VERSION,
    versionText: `Version ${APP_VERSION}, running as ${isInstalled() ? "an installed app" : "a browser tab"}.`,
    onChanged: refreshLibrary,
  });
  wire();
  show("library");
  renderLibrary();
  try {
    await openDb();
  } catch (err) {
    const empty = $("#libEmpty");
    empty.textContent = err.message;
    empty.hidden = false;
    return;
  }
  refreshLibrary();
}

start();
