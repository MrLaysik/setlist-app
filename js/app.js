// Setlist app entry point: views, the library, and startup.

import { $, h, fmtTime, plural, toast } from "./ui.js";
import { openDb, getAllSongs, getPdfInfo, getMeta, getAllSetlists, saveSetlist } from "./db.js";
import { initSongSheet, openSongSheet } from "./song-sheet.js";
import {
  initPerform, openPerform, closePerform, reloadCurrentSong, songDeleted,
} from "./perform.js";
import { initSettings, openSettings } from "./settings.js";
import { backupReminder } from "./backup.js";
import {
  initSetlistView, openSetlist, refreshSetlist, startAddingSongs, describeSetlist, currentSetlist,
} from "./setlist-view.js";
import { askName } from "./setlist-dialogs.js";

const APP_VERSION = "0.6.0";
const TAB_KEY = "setlist.tab";

const state = {
  view: "library",
  tab: "setlists",
  songs: [],
  setlists: [],
  pdfInfo: new Map(),     // pdfId -> { fileName, pageCount }
  meta: null,
  reminderSnoozed: false, // "Later" hides the backup reminder until the app is reopened
  setlistId: null,        // the setlist being shown, if any
  performBack: "library", // where the performance view's back button goes
};

function isInstalled() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

// Remember the library tab between launches (a convenience; fine if storage is blocked).
function loadTab() {
  try {
    const t = localStorage.getItem(TAB_KEY);
    if (t === "songs" || t === "setlists") state.tab = t;
  } catch { /* ignore */ }
}
function setTab(t) {
  state.tab = t;
  try { localStorage.setItem(TAB_KEY, t); } catch { /* ignore */ }
  renderLibrary();
}

// ---------- Views ----------

const VIEWS = ["library", "setlistView", "settings", "perform"];

function show(view) {
  state.view = view;
  for (const v of VIEWS) $("#" + v).hidden = v !== view;
  document.documentElement.classList.toggle("stage", view === "perform");
}

/** Perform a setlist, starting at song `index`. */
async function playSetlist(list, index) {
  state.performBack = "setlist";
  $("#pBack").setAttribute("aria-label", "Back to setlist");
  show("perform");
  await openPerform({ listName: list.name, songIds: list.songIds, index });
}

/** Preview one song from the Songs tab (same screen, no previous/next). */
async function previewSong(id) {
  state.performBack = "library";
  $("#pBack").setAttribute("aria-label", "Back to songs");
  show("perform");
  await openPerform({ listName: null, songIds: [id], index: 0 });
}

function goToLibrary() {
  closePerform();
  state.setlistId = null;
  show("library");
  refreshLibrary();
}

async function goToSetlist(id, opts) {
  closePerform();
  state.setlistId = id;
  show("setlistView");
  await openSetlist(id, opts);
}

function leavePerform() {
  if (state.performBack === "setlist" && state.setlistId) {
    closePerform();
    show("setlistView");
    refreshSetlist();
  } else {
    goToLibrary();
  }
}

function goToSettings() {
  show("settings");
  openSettings();
}

// ---------- Library ----------

const byTitle = (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

async function refreshLibrary() {
  try {
    const [songs, setlists, pdfInfo, meta] = await Promise.all([
      getAllSongs(), getAllSetlists(), getPdfInfo(), getMeta(),
    ]);
    state.songs = songs.sort(byTitle);
    state.setlists = setlists.sort(byName);
    state.pdfInfo = pdfInfo;
    state.meta = meta;
  } catch (err) {
    toast(err.message, { error: true });
  }
  renderLibrary();
}

const chevron = () => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "chev");
  svg.setAttribute("width", "22"); svg.setAttribute("height", "22"); svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "2.2");
  svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = '<path d="M9 5l7 7-7 7"/>';
  return svg;
};

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

function setlistRow(list, songsById) {
  return h("li", {},
    h("button", { className: "row", onclick: () => goToSetlist(list.id) },
      h("div", { className: "row-main" },
        h("div", { className: "row-title" }, list.name),
        h("p", { className: "row-sub" }, describeSetlist(list, songsById))),
      chevron()));
}

function renderLibrary() {
  const songsTab = state.tab === "songs";
  $("#libTitle").textContent = songsTab ? "Songs" : "Setlists";
  $("#tabSongs").setAttribute("aria-selected", String(songsTab));
  $("#tabSets").setAttribute("aria-selected", String(!songsTab));
  $("#addSong").hidden = !songsTab;
  $("#newSetlist").hidden = songsTab;

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
    const songsById = new Map(state.songs.map((s) => [s.id, s]));
    list.replaceChildren(...state.setlists.map((l) => setlistRow(l, songsById)));
    empty.textContent = state.songs.length
      ? "No setlists yet. Tap New setlist to make one."
      : "No setlists yet. Add your songs in the Songs tab first, then make a setlist here.";
    empty.hidden = state.setlists.length > 0;
  }
}

async function newSetlist() {
  const name = await askName({ title: "New setlist", confirmLabel: "Create" });
  if (!name) return;
  try {
    const list = await saveSetlist({ name, songIds: [] });
    await goToSetlist(list.id, { editing: true });
    startAddingSongs();
  } catch (err) {
    toast(err.message, { error: true });
  }
}

// ---------- Song sheet ----------

function sheetOptions(song) {
  const inPerform = state.view === "perform";
  return {
    pdfInfo: song && song.pdfId ? state.pdfInfo.get(song.pdfId) : null,
    onSaved: () => {
      refreshLibrary();
      if (inPerform) reloadCurrentSong();
    },
    onDeleted: async (id) => {
      if (!inPerform) return refreshLibrary();
      // Stay in the set if there's anything left to play.
      if (!(await songDeleted(id))) leavePerform();
    },
    // From the library you can preview the chart; on stage you're already there.
    onViewChart: inPerform ? null : previewSong,
  };
}

function editSong(song) {
  openSongSheet(song, sheetOptions(song));
}

// ---------- Startup ----------

function wire() {
  $("#tabSongs").addEventListener("click", () => setTab("songs"));
  $("#tabSets").addEventListener("click", () => setTab("setlists"));
  $("#addSong").addEventListener("click", () => openSongSheet(null, sheetOptions(null)));
  $("#newSetlist").addEventListener("click", newSetlist);
  $("#openSettings").addEventListener("click", goToSettings);
  $("#setBack").addEventListener("click", goToLibrary);
  $("#reminderGo").addEventListener("click", goToSettings);
  $("#reminderLater").addEventListener("click", () => { state.reminderSnoozed = true; renderLibrary(); });
  // Block Safari's own pinch-zoom of the whole page, at every stage of the
  // gesture (CSS touch-action does most of the work; this is the backup).
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }
}

async function start() {
  loadTab();
  initSongSheet();
  initSettings({
    version: APP_VERSION,
    versionText: `Version ${APP_VERSION}, running as ${isInstalled() ? "an installed app" : "a browser tab"}.`,
    onChanged: refreshLibrary,
  });
  initSetlistView({
    // Milestone 4 turns this into the performance view; for now it opens the chart.
    onPlay: (listId, index) => {
      const list = currentSetlist();
      if (list && list.songIds.length) playSetlist(list, index);
    },
    onBack: goToLibrary,
    onDeleted: (name) => {
      toast(`Deleted “${name}”.`);
      goToLibrary();
    },
  });
  initPerform({
    onBack: leavePerform,
    onEditSong: async (song) => {
      // Fetch fresh so the sheet shows exactly what's stored.
      try {
        const [songs, pdfInfo] = await Promise.all([getAllSongs(), getPdfInfo()]);
        state.pdfInfo = pdfInfo;
        const fresh = songs.find((s) => s.id === song.id);
        if (fresh) openSongSheet(fresh, sheetOptions(fresh));
      } catch (err) {
        toast(err.message, { error: true });
      }
    },
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
