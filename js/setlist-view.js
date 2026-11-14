// One setlist: the numbered running order, and Edit mode for changing it.
// Every change saves straight away; Done just leaves Edit mode.

import { $, h, fmtTime, fmtTotal, plural, toast, confirmDialog } from "./ui.js";
import { getSetlist, getAllSongs, saveSetlist, deleteSetlist } from "./db.js";
import { enableReorder, moveItem } from "./reorder.js";
import { askName, pickSongs } from "./setlist-dialogs.js";

let cur = null;       // { list, songsById, editing }
let handlers = {};    // { onPlay(listId, index), onBack(), onDeleted(name) }

const byTitle = (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });

export function setTotalSeconds(list, songsById) {
  return list.songIds.reduce((t, id) => t + (songsById.get(id)?.lengthSec || 0), 0);
}

/** "6 songs, about 24 min" (used on the library list too). */
export function describeSetlist(list, songsById) {
  const n = list.songIds.length;
  if (!n) return "No songs yet";
  const min = Math.max(1, Math.round(setTotalSeconds(list, songsById) / 60));
  return `${plural(n, "song")}, about ${min} min`;
}

// ---------- Loading ----------

async function load(id) {
  const [list, songs] = await Promise.all([getSetlist(id), getAllSongs()]);
  if (!list) return null;
  const songsById = new Map(songs.map((s) => [s.id, s]));
  // Row positions must match songIds exactly, so drop any ID without a song.
  list.songIds = list.songIds.filter((id) => songsById.has(id));
  return { list, songsById };
}

/** Show a setlist. opts: { editing } */
export async function openSetlist(id, { editing = false } = {}) {
  cur = null;
  $("#slList").replaceChildren();
  try {
    const data = await load(id);
    if (!data) {
      toast("That setlist isn't there anymore.", { error: true });
      handlers.onBack();
      return;
    }
    cur = { ...data, editing };
    $("#slScroll").scrollTop = 0;
    render();
  } catch (err) {
    toast(err.message, { error: true });
    handlers.onBack();
  }
}

/** Re-read from storage (after a song was edited or deleted elsewhere). */
export async function refreshSetlist() {
  if (!cur) return;
  try {
    const data = await load(cur.list.id);
    if (!data) return handlers.onBack();
    cur = { ...data, editing: cur.editing };
    render();
  } catch (err) {
    toast(err.message, { error: true });
  }
}

export function currentSetlist() {
  return cur && cur.list;
}

// ---------- Rendering ----------

const handleIcon = () => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "26"); svg.setAttribute("height", "26"); svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.2"); svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = '<path d="M5 8h14M5 12h14M5 16h14"/>';
  return svg;
};

function viewRow(song, i) {
  return h("li", {},
    h("button", { className: "row", onclick: () => handlers.onPlay(cur.list.id, i) },
      h("span", { className: "num" }, String(i + 1)),
      h("div", { className: "row-main" },
        h("div", { className: "row-title" }, song.title),
        song.pdfId ? null : h("p", { className: "row-sub" }, "No chart yet")),
      h("div", { className: "row-meta" },
        h("span", {}, `${song.bpm} BPM`),
        h("span", {}, fmtTime(song.lengthSec)))));
}

function editRow(song, i) {
  return h("li", { className: "edit-row" },
    h("button", {
      className: "rm",
      "aria-label": `Remove ${song.title} from this set`,
      onclick: () => removeAt(i),
    }, "−"),
    h("span", { className: "num" }, String(i + 1)),
    h("div", { className: "row-main" }, h("div", { className: "row-title" }, song.title)),
    h("div", { className: "row-meta" }, h("span", {}, fmtTime(song.lengthSec))),
    h("span", { className: "handle", role: "img", "aria-label": `Drag to move ${song.title}` }, handleIcon()));
}

function render() {
  if (!cur) return;
  const { list, songsById, editing } = cur;
  const songs = list.songIds.map((id) => songsById.get(id));

  $("#slName").textContent = list.name;
  $("#slInfo").textContent = songs.length
    ? `${plural(songs.length, "song")}, ${fmtTotal(setTotalSeconds(list, songsById))} total`
    : "No songs yet";
  $("#slViewActions").hidden = editing;
  $("#slEditActions").hidden = !editing;
  $("#slEditExtra").hidden = !editing;
  $("#slStart").disabled = songs.length === 0;
  $("#slList").classList.toggle("editing", editing);
  $("#slList").replaceChildren(...songs.map(editing ? editRow : viewRow));

  const empty = $("#slEmpty");
  empty.hidden = songs.length > 0;
  empty.textContent = editing
    ? "No songs in this set yet. Tap Add songs."
    : "No songs in this set yet. Tap Edit, then Add songs.";
}

// ---------- Changes (each one saves right away) ----------

async function saveSongIds(songIds) {
  const prev = cur.list;
  cur.list = { ...cur.list, songIds };
  render();
  try {
    const saved = await saveSetlist({ id: prev.id, songIds });
    if (cur && cur.list.id === saved.id) cur.list = saved;
  } catch (err) {
    toast(err.message, { error: true });
    await refreshSetlist(); // show what's really stored
  }
}

function removeAt(i) {
  const ids = cur.list.songIds.slice();
  ids.splice(i, 1);
  saveSongIds(ids);
}

async function addSongs() {
  const songs = [...cur.songsById.values()].sort(byTitle);
  const picked = await pickSongs({ songs, inSet: new Set(cur.list.songIds) });
  if (picked && picked.length && cur) {
    await saveSongIds([...cur.list.songIds, ...picked]);
    const scroller = $("#slScroll");
    scroller.scrollTop = scroller.scrollHeight; // show where they landed
  }
}

async function rename() {
  const name = await askName({ title: "Rename setlist", confirmLabel: "Save", initial: cur.list.name });
  if (!name || !cur || name === cur.list.name) return;
  try {
    cur.list = await saveSetlist({ id: cur.list.id, name });
    render();
  } catch (err) {
    toast(err.message, { error: true });
  }
}

async function remove() {
  const { list } = cur;
  const yes = await confirmDialog({
    title: `Delete “${list.name}”?`,
    message: "The setlist goes away, but its songs and charts stay in your library. You can't undo this.",
    confirmLabel: "Delete setlist",
    danger: true,
  });
  if (!yes) return;
  try {
    await deleteSetlist(list.id);
    cur = null;
    handlers.onDeleted(list.name);
  } catch (err) {
    toast(err.message, { error: true });
  }
}

function setEditing(on) {
  if (!cur) return;
  cur.editing = on;
  render();
}

/** Open the picker straight away (used right after creating a setlist). */
export function startAddingSongs() {
  if (cur && cur.songsById.size) addSongs();
}

/** Wire up the screen. Call once at startup. */
export function initSetlistView(callbacks) {
  handlers = callbacks;
  $("#slBack").addEventListener("click", () => handlers.onBack());
  $("#slEdit").addEventListener("click", () => setEditing(true));
  $("#slDone").addEventListener("click", () => setEditing(false));
  $("#slStart").addEventListener("click", () => { if (cur && cur.list.songIds.length) handlers.onPlay(cur.list.id, 0); });
  $("#slAdd").addEventListener("click", () => { if (cur) addSongs(); });
  $("#slRename").addEventListener("click", () => { if (cur) rename(); });
  $("#slDelete").addEventListener("click", () => { if (cur) remove(); });
  enableReorder($("#slList"), $("#slScroll"), {
    handle: ".handle",
    onReorder: (from, to) => saveSongIds(moveItem(cur.list.songIds, from, to)),
  });
}
