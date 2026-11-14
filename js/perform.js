// Performance view: one song's chart at a time, auto-scroll driven by the
// song's length, and moving between songs in a setlist.
//
// Auto-scroll is a position-in-song clock (`pos`, in seconds):
//   while running:  pos = posStart + (now - tStart)
//                   scrollTop = pos / lengthSec * maxScroll
// It's recomputed from performance.now() every frame, never accumulated, so
// it can't drift. When you drag the chart, the clock pauses for the touch and
// any momentum, then carries on from the new spot at the same pace. When it's
// stopped, scrolling by hand moves `pos`, so Start continues from there.

import { $, fmtTime } from "./ui.js";
import { getAllSongs, getPdf } from "./db.js";
import { showChart } from "./charts.js";

const SETTLE_MS = 180;      // quiet time after a touch/momentum before the clock resumes
const SWIPE_MIN_PX = 70;    // a swipe must travel at least this far sideways…
const SWIPE_MAX_MS = 700;   // …within this long…
const SWIPE_RATIO = 2;      // …and be at least twice as wide as it is tall
const HINT_MS = 3800;

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const P = {
  open: false,
  listName: null,       // setlist name, or null for a one-song preview
  songIds: [],
  songs: new Map(),     // id -> song
  idx: 0,
  song: null,
  ctrl: null,           // the drawn chart (from showChart)
  loadToken: 0,

  running: false,
  pos: 0,               // seconds into the song
  posStart: 0,
  tStart: 0,
  interacting: false,   // a touch, trackpad scroll or scrollbar drag is in progress
  touchEnded: false,    // the finger is up; waiting for momentum to settle
  settleTimer: 0,
  raf: 0,
  lastSec: -1,

  touch: null,          // swipe tracking for the current touch
  hinted: false,
  lastWidth: 0,
  resizeTimer: 0,
};

let handlers = {};      // { onBack(), onEditSong(song) }

const chart = () => $("#chart");
const maxScroll = () => Math.max(0, chart().scrollHeight - chart().clientHeight);
const lengthOf = () => (P.song && P.song.lengthSec > 0 ? P.song.lengthSec : 1);

// ---------- Display ----------

function message(text) {
  const el = $("#pMsg");
  el.textContent = text || "";
  el.hidden = !text;
}

function updateTime() {
  const len = lengthOf();
  $("#pBar").style.transform = `scaleX(${Math.min(1, P.pos / len).toFixed(4)})`;
  const sec = Math.floor(P.pos);
  if (sec !== P.lastSec) {
    P.lastSec = sec;
    $("#pTime").textContent = `${fmtTime(P.pos)} / ${fmtTime(P.song ? P.song.lengthSec : 0)}`;
  }
}

function updateLabels() {
  const n = P.songIds.length;
  const s = P.song;
  $("#pTitle").textContent = s ? s.title : "";
  $("#pPos").textContent = P.listName
    ? `Song ${P.idx + 1} of ${n}, ${P.listName}`
    : s ? `Song preview, ${s.bpm} BPM` : "";

  const prev = P.idx > 0 ? P.songs.get(P.songIds[P.idx - 1]) : null;
  const next = P.idx < n - 1 ? P.songs.get(P.songIds[P.idx + 1]) : null;
  const single = n <= 1;
  $("#pPrev").disabled = !prev;
  $("#pNext").disabled = !next;
  $("#pPrevT").textContent = prev ? prev.title : single ? "" : "Start of set";
  $("#pNextT").textContent = next ? next.title : single ? "" : "End of set";
  $("#pPrev").setAttribute("aria-label", prev ? `Previous song: ${prev.title}` : "No previous song");
  $("#pNext").setAttribute("aria-label", next ? `Next song: ${next.title}` : "No next song");
}

// ---------- Start / Stop ----------

function startRun() {
  if (!P.song) return;
  // Start from wherever the chart actually is right now. (Don't rely on a
  // scroll event having arrived; they can lag behind a quick flick.)
  syncFromScroll();
  if (P.pos >= lengthOf() - 0.05) {
    // Start from the end restarts from the top.
    P.pos = 0;
    chart().scrollTop = 0;
  }
  P.posStart = P.pos;
  P.tStart = performance.now();
  P.running = true;
  P.interacting = false;
  P.touchEnded = false;
  clearTimeout(P.settleTimer);
  const b = $("#pGo");
  b.textContent = "Stop";
  b.classList.add("stop");
}

function stopRun() {
  P.running = false;
  const b = $("#pGo");
  b.textContent = "Start";
  b.classList.remove("stop");
}

export function toggleRun() {
  if (P.running) stopRun();
  else startRun();
}

// ---------- The clock ----------

function loop(now) {
  if (!P.open) return;
  if (P.running && !P.interacting) {
    const len = lengthOf();
    P.pos = Math.min(len, P.posStart + (now - P.tStart) / 1000);
    const m = maxScroll();
    if (m > 0) chart().scrollTop = (P.pos / len) * m;
    updateTime();
    if (P.pos >= len) stopRun();
  }
  P.raf = requestAnimationFrame(loop);
}

/** Set pos from where the chart is scrolled to (manual scrolling). */
function syncFromScroll() {
  const m = maxScroll();
  if (m <= 0) return;
  P.pos = Math.min(lengthOf(), Math.max(0, (chart().scrollTop / m) * lengthOf()));
  updateTime();
}

/** Once scrolling has been quiet for a moment, resume the clock from here. */
function armSettle() {
  clearTimeout(P.settleTimer);
  P.settleTimer = setTimeout(() => {
    P.interacting = false;
    P.touchEnded = false;
    syncFromScroll(); // resume from exactly where the chart came to rest
    P.posStart = P.pos;
    P.tStart = performance.now();
  }, SETTLE_MS);
}

function beginInteraction() {
  if (!P.running) return;
  P.interacting = true;
  P.touchEnded = false;
  clearTimeout(P.settleTimer);
}

function endInteraction() {
  if (!P.interacting) return;
  P.touchEnded = true;
  armSettle();
}

// ---------- Songs ----------

function teardownChart() {
  if (P.ctrl) { P.ctrl.destroy(); P.ctrl = null; }
  $("#pages").replaceChildren();
}

function animateChange(dir) {
  if (!dir || reduceMotion()) return;
  chart().animate(
    [{ transform: `translateX(${dir * 48}px)`, opacity: 0 }, { transform: "none", opacity: 1 }],
    { duration: 240, easing: "cubic-bezier(.2,.7,.3,1)" }
  );
}

function bounce(dir) {
  if (reduceMotion()) return;
  chart().animate(
    [{ transform: "none" }, { transform: `translateX(${-dir * 18}px)` }, { transform: "none" }],
    { duration: 260, easing: "ease-out" }
  );
}

async function loadSong(idx, dir = 0) {
  const my = ++P.loadToken;
  stopRun();
  clearTimeout(P.settleTimer);
  P.interacting = false;
  P.touchEnded = false;
  teardownChart();
  P.idx = idx;
  P.song = P.songs.get(P.songIds[idx]) || null;
  P.pos = 0;
  P.lastSec = -1;
  const c = chart();
  c.scrollTop = 0;
  c.scrollLeft = 0;
  updateLabels();
  updateTime();
  animateChange(dir);

  const song = P.song;
  if (!song) {
    message("This song isn't in your library anymore.");
    return;
  }
  if (!song.pdfId) {
    message("No chart yet. Tap Song settings (top right) to add a PDF.");
    return;
  }
  message(null);
  try {
    const pdf = await getPdf(song.pdfId);
    if (my !== P.loadToken) return;
    if (!pdf) {
      message("This song's chart file is missing. Tap Song settings to add the PDF again.");
      return;
    }
    const ctrl = await showChart($("#pages"), pdf.data);
    if (my !== P.loadToken) { ctrl.destroy(); return; }
    P.ctrl = ctrl;
    P.lastWidth = $("#pages").clientWidth;
    ctrl.ready.catch((err) => { if (my === P.loadToken) message(err.message); });
  } catch (err) {
    if (my === P.loadToken) {
      teardownChart();
      message(err.message);
    }
  }
}

/** Move by one song. Past either end of the set, give a small bounce. */
export function go(dir) {
  if (!P.open) return;
  const t = P.idx + dir;
  if (t < 0 || t >= P.songIds.length) {
    bounce(dir);
    return;
  }
  loadSong(t, dir);
}

// ---------- Opening and closing ----------

function showHint() {
  if (P.hinted || P.songIds.length < 2) return;
  P.hinted = true;
  const el = $("#hint");
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), HINT_MS);
}

/**
 * Open the performance view. The view must already be visible.
 * opts: { listName (null for a preview), songIds, index }
 */
export async function openPerform({ listName = null, songIds, index = 0 }) {
  P.open = true;
  P.listName = listName;
  P.songs = new Map((await getAllSongs()).map((s) => [s.id, s]));
  P.songIds = songIds.filter((id) => P.songs.has(id));
  if (!P.songIds.length) {
    P.songIds = [];
    P.song = null;
    updateLabels();
    message("There are no songs to show.");
  } else {
    await loadSong(Math.min(Math.max(0, index), P.songIds.length - 1), 0);
  }
  cancelAnimationFrame(P.raf);
  P.raf = requestAnimationFrame(loop);
  showHint();
}

export function closePerform() {
  P.open = false;
  P.loadToken++;
  cancelAnimationFrame(P.raf);
  clearTimeout(P.settleTimer);
  stopRun();
  teardownChart();
  message(null);
  $("#hint").classList.remove("show");
}

export function isPerformOpen() {
  return P.open;
}

export function currentSong() {
  return P.song;
}

/** After the current song was edited: reload it from storage and redraw. */
export async function reloadCurrentSong() {
  if (!P.open) return;
  P.songs = new Map((await getAllSongs()).map((s) => [s.id, s]));
  await loadSong(P.idx, 0);
}

/**
 * After a song was deleted. Returns false if nothing is left to show
 * (the caller should leave the view).
 */
export async function songDeleted(id) {
  if (!P.open) return false;
  const i = P.songIds.indexOf(id);
  P.songs.delete(id);
  if (i < 0) return true;
  P.songIds.splice(i, 1);
  if (!P.songIds.length) return false;
  await loadSong(Math.min(P.idx, P.songIds.length - 1), 0);
  return true;
}

// ---------- Input ----------

function onTouchStart(e) {
  if (e.touches.length === 1) {
    const c = chart();
    const t = e.touches[0];
    const maxX = c.scrollWidth - c.clientWidth;
    P.touch = {
      x: t.clientX, y: t.clientY, t: performance.now(), multi: false,
      // When zoomed wider than the screen (Milestone 6), a swipe only changes
      // songs if the chart is already at that edge; otherwise it pans.
      edgeL: c.scrollLeft <= 1,
      edgeR: c.scrollLeft >= maxX - 1,
    };
  } else if (P.touch) {
    P.touch.multi = true;
  }
}

function onTouchMove() {
  // Only real movement pauses the clock; a plain tap doesn't.
  if (!P.interacting) beginInteraction();
}

function onTouchEnd(e) {
  if (e.touches.length > 0) return; // wait until every finger is up
  endInteraction();
  const s = P.touch;
  P.touch = null;
  if (!s || s.multi || e.type === "touchcancel") return;
  const t = e.changedTouches[0];
  const dx = t.clientX - s.x;
  const dy = t.clientY - s.y;
  const dt = performance.now() - s.t;
  if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) >= SWIPE_RATIO * Math.abs(dy) && dt <= SWIPE_MAX_MS) {
    if (dx < 0 && s.edgeR) go(1);
    else if (dx > 0 && s.edgeL) go(-1);
  }
}

function onScroll() {
  if (P.interacting && P.touchEnded) armSettle(); // momentum still going
  if (!P.running || P.interacting) syncFromScroll();
}

function onWheel() {
  // Mac trackpad or mouse wheel: treat like a touch that has already ended.
  if (!P.running) return;
  beginInteraction();
  endInteraction();
}

function onKey(e) {
  if (!P.open || document.querySelector("dialog[open]")) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
  else if (e.key === " " && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); toggleRun(); }
}

function onResize() {
  clearTimeout(P.resizeTimer);
  P.resizeTimer = setTimeout(() => {
    if (!P.open) return;
    // Keep your place: put the chart back at the same point in the song.
    if (!P.running) {
      const m = maxScroll();
      if (m > 0) chart().scrollTop = (P.pos / lengthOf()) * m;
    }
    const w = $("#pages").clientWidth;
    if (P.ctrl && w && w !== P.lastWidth) {
      P.lastWidth = w;
      P.ctrl.redraw().catch((err) => message(err.message));
    }
  }, 150);
}

/** Wire up the view. Call once at startup. callbacks: { onBack(), onEditSong(song) } */
export function initPerform(callbacks) {
  handlers = callbacks;
  const c = chart();
  c.addEventListener("touchstart", onTouchStart, { passive: true });
  c.addEventListener("touchmove", onTouchMove, { passive: true });
  c.addEventListener("touchend", onTouchEnd, { passive: true });
  c.addEventListener("touchcancel", onTouchEnd, { passive: true });
  c.addEventListener("scroll", onScroll, { passive: true });
  c.addEventListener("wheel", onWheel, { passive: true });
  // Mac: dragging the scrollbar with the mouse.
  c.addEventListener("pointerdown", (e) => { if (e.pointerType === "mouse") beginInteraction(); });
  window.addEventListener("pointerup", (e) => { if (e.pointerType === "mouse") endInteraction(); });
  window.addEventListener("resize", onResize);
  document.addEventListener("keydown", onKey);

  $("#pGo").addEventListener("click", toggleRun);
  $("#pPrev").addEventListener("click", () => go(-1));
  $("#pNext").addEventListener("click", () => go(1));
  $("#pBack").addEventListener("click", () => handlers.onBack());
  $("#pEdit").addEventListener("click", () => { if (P.song) handlers.onEditSong(P.song); });
}

