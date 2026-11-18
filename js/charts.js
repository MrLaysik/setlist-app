// PDF handling via the vendored PDF.js. The app never edits PDFs; it only
// checks them on upload and draws them.

const VENDOR = new URL("../vendor/pdfjs/", import.meta.url).href;

// iPad Safari refuses to draw canvases above roughly 16.7 million pixels.
const MAX_CANVAS_AREA = 16_000_000;
// And all the pages together get a budget (about 256 MB of pixels), so a long
// chart zoomed to 300% can't run the iPad out of memory. Past this, pages are
// drawn a little less sharp instead.
const MAX_TOTAL_AREA = 64_000_000;
// A page already drawn sharper than needed is kept (no redraw) unless it's
// more than this many times too big, which would just waste memory.
const KEEP_SHARPER_UP_TO = 2;

let libPromise = null;

function loadLib() {
  if (!libPromise) {
    libPromise = import(VENDOR + "pdf.min.mjs").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = VENDOR + "pdf.worker.min.mjs";
      return lib;
    });
    libPromise.catch(() => { libPromise = null; });
  }
  return libPromise;
}

async function openDoc(data) {
  let lib;
  try {
    lib = await loadLib();
  } catch {
    throw new ChartError("The PDF reader didn't load. Close and reopen the app, then try again.");
  }
  return lib.getDocument({
    // PDF.js takes ownership of the bytes it's given, so hand it a copy and
    // keep the stored original intact.
    data: new Uint8Array(data.slice(0)),
    standardFontDataUrl: VENDOR + "standard_fonts/",
    wasmUrl: VENDOR + "wasm/",
    iccUrl: VENDOR + "iccs/",
    isEvalSupported: false,
  }).promise;
}

/** Free a document and its worker resources. (PDF.js 6 closes via the loading task.) */
function closeDoc(doc) {
  doc.loadingTask.destroy().catch(() => {});
}

/** An error whose message is already written for people. */
class ChartError extends Error {}

function explain(err) {
  if (err instanceof ChartError) return err.message;
  switch (err && err.name) {
    case "PasswordException":
      return "That PDF is password-protected. Remove the password and try again.";
    case "InvalidPDFException":
      return "That file isn't a readable PDF. It may be damaged.";
    default:
      console.error("PDF error:", err);
      return "That PDF didn't open. It may be damaged.";
  }
}

/** Read a picked file and make sure PDF.js can open it. */
export async function inspectPdf(file) {
  const data = await file.arrayBuffer();
  let doc;
  try {
    doc = await openDoc(data);
    return { data, fileName: file.name, pageCount: doc.numPages };
  } catch (err) {
    throw new ChartError(explain(err));
  } finally {
    if (doc) closeDoc(doc);
  }
}

function release(canvas) {
  // Shrinking to zero frees the memory right away instead of waiting for GC.
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * Draw every page of `data` into `container`, top to bottom.
 * Returns { pageCount, ready, redraw(), destroy() }. `ready` resolves once
 * every page has been drawn at the current width.
 */
export async function showChart(container, data) {
  let doc;
  try {
    doc = await openDoc(data);
  } catch (err) {
    throw new ChartError(explain(err));
  }

  // Lay out every page at its real proportions first, so the full scroll
  // height is known before any drawing happens.
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const wrap = document.createElement("div");
    wrap.className = "pdfpage";
    wrap.style.aspectRatio = `${vp.width} / ${vp.height}`;
    container.append(wrap);
    pages.push({ page, wrap, w: vp.width, h: vp.height, canvas: null, task: null, drawnPx: 0 });
  }

  let gen = 0;
  let destroyed = false;

  /** How many pixels wide each page should be drawn at its current size. */
  function targets() {
    const dpr = window.devicePixelRatio || 1;
    const want = pages.map((p) => {
      const cssW = p.wrap.clientWidth;
      const maxPx = Math.floor(Math.sqrt(MAX_CANVAS_AREA * (p.w / p.h)));
      return Math.min(Math.round(cssW * dpr), maxPx);
    });
    const total = pages.reduce((sum, p, i) => sum + want[i] * want[i] * (p.h / p.w), 0);
    const k = total > MAX_TOTAL_AREA ? Math.sqrt(MAX_TOTAL_AREA / total) : 1;
    return want.map((px) => Math.floor(px * k));
  }

  /** Pages nearest the middle of the screen first, so what you're looking at sharpens first. */
  function byDistanceFromView() {
    const mid = window.innerHeight / 2;
    const dist = (p) => {
      const r = p.wrap.getBoundingClientRect();
      return r.top <= mid && r.bottom >= mid ? 0 : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid));
    };
    return pages.map((p, i) => ({ p, i, d: dist(p) })).sort((a, b) => a.d - b.d);
  }

  async function draw() {
    const my = ++gen;
    const want = targets();
    for (const { p, i } of byDistanceFromView()) {
      if (destroyed || my !== gen) return;
      const pxW = want[i];
      if (!pxW) continue;
      if (p.canvas && p.drawnPx >= pxW && p.drawnPx <= pxW * KEEP_SHARPER_UP_TO) continue;

      const viewport = p.page.getViewport({ scale: pxW / p.w });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      p.task = p.page.render({ canvas, viewport });
      try {
        await p.task.promise;
      } catch (err) {
        release(canvas);
        if (err && err.name === "RenderingCancelledException") return;
        throw new ChartError(explain(err));
      } finally {
        p.task = null;
      }
      if (destroyed || my !== gen) { release(canvas); return; }
      if (p.canvas) release(p.canvas);
      p.wrap.replaceChildren(canvas);
      p.canvas = canvas;
      p.drawnPx = pxW;
    }
  }

  function cancelAll() {
    for (const p of pages) if (p.task) p.task.cancel();
  }

  return {
    pageCount: doc.numPages,
    ready: draw(),
    redraw() {
      cancelAll();
      return draw();
    },
    destroy() {
      destroyed = true;
      gen++;
      cancelAll();
      for (const p of pages) if (p.canvas) release(p.canvas);
      container.replaceChildren();
      closeDoc(doc);
    },
  };
}
