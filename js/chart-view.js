// Chart view: one song's PDF as a continuous vertical stack of pages.
// Milestone 4 grows this into the full performance view.

import { $, fmtTime, plural } from "./ui.js";
import { getSong, getPdf } from "./db.js";
import { showChart } from "./charts.js";

let ctrl = null;      // the drawn chart, from showChart()
let songId = null;
let loadToken = 0;    // guards against a slow load finishing after we've moved on
let lastWidth = 0;
let resizeTimer = 0;

function message(text) {
  const el = $("#cvMsg");
  el.textContent = text || "";
  el.hidden = !text;
}

function teardown() {
  if (ctrl) { ctrl.destroy(); ctrl = null; }
  $("#pages").replaceChildren();
}

async function load() {
  const my = ++loadToken;
  teardown();
  $("#chart").scrollTo(0, 0);
  try {
    const song = await getSong(songId);
    if (my !== loadToken) return;
    if (!song) {
      $("#cvTitle").textContent = "";
      $("#cvSub").textContent = "";
      message("This song isn't in your library anymore.");
      return;
    }
    $("#cvTitle").textContent = song.title;
    const sub = `${song.bpm} BPM, ${fmtTime(song.lengthSec)}`;
    $("#cvSub").textContent = sub;
    if (!song.pdfId) {
      message("No chart yet. Tap Song settings (top right) to add a PDF.");
      return;
    }
    message("Opening chart…");
    const pdf = await getPdf(song.pdfId);
    if (my !== loadToken) return;
    if (!pdf) {
      message("This song's chart file is missing. Tap Song settings to add the PDF again.");
      return;
    }
    const c = await showChart($("#pages"), pdf.data);
    if (my !== loadToken) { c.destroy(); return; }
    ctrl = c;
    message(null);
    $("#cvSub").textContent = `${sub}, ${plural(c.pageCount, "page")}`;
    lastWidth = $("#pages").clientWidth;
    c.ready.catch((err) => { if (my === loadToken) message(err.message); });
  } catch (err) {
    if (my === loadToken) {
      teardown();
      message(err.message);
    }
  }
}

/** Show a song's chart. The view must already be visible so pages can be measured. */
export function openChartView(id) {
  songId = id;
  return load();
}

/** Reload after the song was edited (title, length or PDF may have changed). */
export function reloadChartView() {
  if (songId) return load();
}

export function closeChartView() {
  loadToken++;
  songId = null;
  teardown();
  message(null);
}

export function currentChartSongId() {
  return songId;
}

// Redraw sharp pages after a rotation or window resize.
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!ctrl) return;
    const w = $("#pages").clientWidth;
    if (w && w !== lastWidth) {
      lastWidth = w;
      ctrl.redraw().catch((err) => message(err.message));
    }
  }, 150);
});
