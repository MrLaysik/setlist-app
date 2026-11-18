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

import { $, fmtTime, toast } from "./ui.js";
import { getAllSongs, getPdf, saveSongZoom } from "./db.js";
import { showChart } from "./charts.js";
import { createMetronome } from "./metronome.js";
import { createWakeLock } from "./wake.js";

const SETTLE_MS = 180;      // quiet time after a touch/momentum before the clock resumes
const SWIPE_MIN_PX = 70;    // a swipe must travel at least this far sideways…
const SWIPE_MAX_MS = 700;   // …within this long…
const SWIPE_RATIO = 2;      // …and be at least twice as wide as it is tall
const HINT_MS = 3800;

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_SNAP = 0.06;     // within 6% of 100% snaps to exactly 100%
const MAX_PAGE_WIDTH = 840; // page width at 100% on a big screen (as in the mockup)
const REDRAW_MS = 220;      // redraw sharp this long after zooming stops
const ZOOM_SAVE_MS = 600;   // save the song's zoom this long after zooming stops

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
  fingers: 0,           // fingers currently on the chart
  hinted: false,
  resizeTimer: 0,

  zoom: 1,
  pinch: null,          // { d0, z0, anchor } while two fingers are pinching
  pinchNext: null,      // latest pinch values, applied once per frame
  pinchFrame: 0,
  gesture: null,        // Mac Safari trackpad pinch
  wheelZoom: 1,         // Mac ctrl+wheel: unsnapped zoom, so it can move off 100%
  wheelAt: 0,
  redrawTimer: 0,
  zoomSave: null,       // { id, zoom } waiting to be saved
  zoomSaveTimer: 0,
};

let handlers = {};      // { onBack(), onEditSong(song) }
let metro = null;       // the visual metronome (see metronome.js)
let wake = null;        // keep-awake (see wake.js)

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
    : s ? "Song preview" : "";

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
  metro.tick(now);
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

// ---------- Zoom ----------
//
// Zoom changes the real width of the pages (not a CSS transform), so the
// scroll math above keeps working unchanged. While zooming, the existing
// page images just stretch; once zooming stops, they're redrawn sharp.

/** Page width at 100%: the chart's width, up to MAX_PAGE_WIDTH. */
function baseWidth() {
  const c = chart();
  const cs = getComputedStyle(c);
  const inner = c.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  return Math.max(100, Math.min(inner, MAX_PAGE_WIDTH));
}

function applyWidth() {
  $("#pages").style.width = `${Math.round(baseWidth() * P.zoom)}px`;
}

function clampZoom(z, snap = true) {
  z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  return snap && Math.abs(z - 1) < ZOOM_SNAP ? 1 : z;
}

function updateZoomChip() {
  const chip = $("#zoomChip");
  chip.hidden = P.zoom === 1 || !P.ctrl;
  $("#zoomPct").textContent = `${Math.round(P.zoom * 100)}%`;
}

/** What's under the screen point (x, y), as a page plus a fraction of it. */
function anchorAt(x, y) {
  let best = null;
  let bestD = Infinity;
  for (const el of $("#pages").children) {
    const r = el.getBoundingClientRect();
    const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    if (d < bestD) { best = el; bestD = d; }
    if (d === 0) break;
  }
  if (!best) return null;
  const r = best.getBoundingClientRect();
  return { el: best, fx: (x - r.left) / r.width, fy: (y - r.top) / r.height };
}

/**
 * Zoom to `z`, keeping the anchored point of the chart under screen point
 * (x, y). During a pinch the anchor stays fixed, so moving both fingers pans.
 */
function zoomTo(z, x, y, anchor = anchorAt(x, y), snap = true) {
  if (!P.ctrl || !P.song) return;
  P.zoom = clampZoom(z, snap);
  applyWidth();
  if (anchor && anchor.el.isConnected) {
    const r = anchor.el.getBoundingClientRect();
    const c = chart();
    c.scrollLeft += r.left + anchor.fx * r.width - x;
    c.scrollTop += r.top + anchor.fy * r.height - y;
  }
  updateZoomChip();
  scheduleRedraw();
  P.song.zoom = P.zoom;
  scheduleZoomSave();
}

function zoomAtCenter(z) {
  const r = chart().getBoundingClientRect();
  zoomTo(z, r.left + r.width / 2, r.top + r.height / 2);
}

function scheduleRedraw() {
  clearTimeout(P.redrawTimer);
  P.redrawTimer = setTimeout(() => {
    if (P.ctrl) P.ctrl.redraw().catch((err) => message(err.message));
  }, REDRAW_MS);
}

function scheduleZoomSave() {
  P.zoomSave = { id: P.song.id, zoom: Math.round(P.zoom * 100) / 100 };
  clearTimeout(P.zoomSaveTimer);
  P.zoomSaveTimer = setTimeout(flushZoomSave, ZOOM_SAVE_MS);
}

/** Save a pending zoom now. Never fails silently. */
async function flushZoomSave() {
  clearTimeout(P.zoomSaveTimer);
  const pending = P.zoomSave;
  P.zoomSave = null;
  if (!pending) return;
  try {
    await saveSongZoom(pending.id, pending.zoom);
  } catch (err) {
    toast(err.message, { error: true });
  }
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
  flushZoomSave();
  stopRun();
  clearTimeout(P.settleTimer);
  clearTimeout(P.redrawTimer);
  P.interacting = false;
  P.touchEnded = false;
  P.pinch = null;
  P.gesture = null;
  teardownChart();
  P.idx = idx;
  P.song = P.songs.get(P.songIds[idx]) || null;
  P.pos = 0;
  P.lastSec = -1;
  // Each song opens at its own saved zoom.
  P.zoom = clampZoom(Number(P.song && P.song.zoom) || 1);
  applyWidth();
  updateZoomChip();
  const c = chart();
  c.scrollTop = 0;
  c.scrollLeft = 0;
  updateLabels();
  updateTime();
  animateChange(dir);

  const song = P.song;
  // Every song load (including song changes) starts the metronome at beat one.
  if (song) metro.start(song.bpm);
  else metro.stop();
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
    updateZoomChip();
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
  // First thing, while the tap that opened the view still counts: some
  // browsers only grant the wake lock right after a tap.
  wake.start();
  P.open = true;
  P.listName = listName;
  P.songs = new Map((await getAllSongs()).map((s) => [s.id, s]));
  P.songIds = songIds.filter((id) => P.songs.has(id));
  if (!P.songIds.length) {
    P.songIds = [];
    P.song = null;
    metro.stop();
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
  wake.stop();
  flushZoomSave();
  cancelAnimationFrame(P.raf);
  cancelAnimationFrame(P.pinchFrame);
  P.pinch = null;
  P.gesture = null;
  clearTimeout(P.settleTimer);
  clearTimeout(P.redrawTimer);
  stopRun();
  metro.stop();
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
  await flushZoomSave(); // so the reload below sees the latest zoom
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

const fingerGap = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
const fingerMid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });

function onTouchStart(e) {
  P.fingers = e.touches.length;
  if (e.touches.length === 1) {
    const c = chart();
    const t = e.touches[0];
    const maxX = c.scrollWidth - c.clientWidth;
    P.touch = {
      x: t.clientX, y: t.clientY, t: performance.now(), multi: false,
      // When zoomed wider than the screen, a swipe only changes songs if the
      // chart is already at that edge; otherwise it pans.
      edgeL: c.scrollLeft <= 1,
      edgeR: c.scrollLeft >= maxX - 1,
    };
  } else if (P.touch) {
    P.touch.multi = true;
  }
  if (e.touches.length === 2 && P.ctrl) {
    const m = fingerMid(e.touches);
    P.pinch = { d0: fingerGap(e.touches) || 1, z0: P.zoom, anchor: anchorAt(m.x, m.y) };
  }
}

function onTouchMove(e) {
  // Only real movement pauses the clock; a plain tap doesn't.
  if (!P.interacting) beginInteraction();
  if (!P.pinch || e.touches.length !== 2) return;
  // Two fingers: this is ours, not the browser's scroll.
  e.preventDefault();
  const m = fingerMid(e.touches);
  P.pinchNext = { z: (P.pinch.z0 * fingerGap(e.touches)) / P.pinch.d0, x: m.x, y: m.y };
  if (!P.pinchFrame) {
    P.pinchFrame = requestAnimationFrame(() => {
      P.pinchFrame = 0;
      const q = P.pinchNext;
      if (q && P.pinch) zoomTo(q.z, q.x, q.y, P.pinch.anchor);
    });
  }
}

function onTouchEnd(e) {
  P.fingers = e.touches.length;
  if (e.touches.length < 2) { P.pinch = null; P.pinchNext = null; }
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

function onWheel(e) {
  if (e.ctrlKey) {
    // Trackpad pinch in Chrome (and ctrl + scroll wheel): zoom, not page zoom.
    e.preventDefault();
    const now = performance.now();
    // Track an unsnapped zoom while the pinch lasts, so small steps can
    // move off 100% instead of snapping straight back to it.
    if (now - P.wheelAt > 300) P.wheelZoom = P.zoom;
    P.wheelAt = now;
    P.wheelZoom = clampZoom(P.wheelZoom * Math.exp(-e.deltaY * 0.01), false);
    zoomTo(P.wheelZoom, e.clientX, e.clientY);
  }
  // Mac trackpad or mouse wheel: treat like a touch that has already ended.
  if (!P.running) return;
  beginInteraction();
  endInteraction();
}

// Trackpad pinch in Mac Safari arrives as gesture events instead. On the
// iPad those fire too, alongside the touches handled above, so ignore them
// whenever a finger is on the chart.
function onGestureStart(e) {
  if (P.fingers > 0 || !P.ctrl) return;
  const r = chart().getBoundingClientRect();
  const x = e.clientX ?? r.left + r.width / 2;
  const y = e.clientY ?? r.top + r.height / 2;
  P.gesture = { z0: P.zoom, x, y, anchor: anchorAt(x, y) };
  beginInteraction();
}

function onGestureChange(e) {
  if (!P.gesture || P.fingers > 0) return;
  zoomTo(P.gesture.z0 * e.scale, P.gesture.x, P.gesture.y, P.gesture.anchor);
}

function onGestureEnd() {
  if (!P.gesture) return;
  P.gesture = null;
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
    applyWidth(); // 100% follows the screen width, so rotating re-fits
    // Keep your place: put the chart back at the same point in the song.
    if (!P.running) {
      const m = maxScroll();
      if (m > 0) chart().scrollTop = (P.pos / lengthOf()) * m;
    }
    scheduleRedraw();
  }, 150);
}

/** Wire up the view. Call once at startup. callbacks: { onBack(), onEditSong(song) } */
export function initPerform(callbacks) {
  handlers = callbacks;
  metro = createMetronome({ button: $("#pMetro"), dot: $("#pDot"), bpmText: $("#pBpm") });
  $("#pMetro").addEventListener("click", () => metro.toggle());
  wake = createWakeLock({ button: $("#pWake"), text: $("#pWakeT") });
  const c = chart();
  c.addEventListener("touchstart", onTouchStart, { passive: true });
  // Not passive: a two-finger pinch has to stop the browser's own handling.
  c.addEventListener("touchmove", onTouchMove, { passive: false });
  c.addEventListener("touchend", onTouchEnd, { passive: true });
  c.addEventListener("touchcancel", onTouchEnd, { passive: true });
  c.addEventListener("scroll", onScroll, { passive: true });
  c.addEventListener("wheel", onWheel, { passive: false });
  c.addEventListener("gesturestart", onGestureStart);
  c.addEventListener("gesturechange", onGestureChange);
  c.addEventListener("gestureend", onGestureEnd);
  $("#zoomChip").addEventListener("click", () => zoomAtCenter(1));
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

