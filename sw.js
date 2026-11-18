// Service worker: keeps a complete copy of the app on the device, so it runs
// with no connection at all, and serves from that copy first so a slow or
// flaky venue Wi-Fi can't hold anything up.
//
// Updates: when VERSION changes, the browser downloads the new copy in the
// background. It then waits, and the app shows "Update ready, tap to reload".
// It only takes over when Brad taps that, never on its own, so it can't
// happen mid-song.
//
// VERSION must match APP_VERSION in js/app.js, and FILES must list every file
// the app uses. Run `sh tools/check-sw.sh` before committing to check both.

const VERSION = "0.8.0";
const CACHE = `setlist-${VERSION}`;

const FILES = [
  "./",
  "index.html",
  "manifest.json",
  "css/app.css",
  "js/app.js",
  "js/backup.js",
  "js/charts.js",
  "js/db.js",
  "js/metronome.js",
  "js/offline.js",
  "js/perform.js",
  "js/reorder.js",
  "js/setlist-dialogs.js",
  "js/setlist-view.js",
  "js/settings.js",
  "js/song-sheet.js",
  "js/ui.js",
  "js/wake.js",
  "icons/icon-32.png",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-512-maskable.png",
  "vendor/fonts/barlow-condensed-latin-500-normal.woff2",
  "vendor/fonts/barlow-condensed-latin-600-normal.woff2",
  "vendor/fonts/barlow-condensed-latin-700-normal.woff2",
  "vendor/fonts/barlow-latin-400-normal.woff2",
  "vendor/fonts/barlow-latin-500-normal.woff2",
  "vendor/fonts/barlow-latin-600-normal.woff2",
  "vendor/jszip/jszip.min.js",
  "vendor/pdfjs/pdf.min.mjs",
  "vendor/pdfjs/pdf.worker.min.mjs",
  "vendor/pdfjs/iccs/CGATS001Compat-v2-micro.icc",
  "vendor/pdfjs/standard_fonts/FoxitDingbats.pfb",
  "vendor/pdfjs/standard_fonts/FoxitFixed.pfb",
  "vendor/pdfjs/standard_fonts/FoxitFixedBold.pfb",
  "vendor/pdfjs/standard_fonts/FoxitFixedBoldItalic.pfb",
  "vendor/pdfjs/standard_fonts/FoxitFixedItalic.pfb",
  "vendor/pdfjs/standard_fonts/FoxitSerif.pfb",
  "vendor/pdfjs/standard_fonts/FoxitSerifBold.pfb",
  "vendor/pdfjs/standard_fonts/FoxitSerifBoldItalic.pfb",
  "vendor/pdfjs/standard_fonts/FoxitSerifItalic.pfb",
  "vendor/pdfjs/standard_fonts/FoxitSymbol.pfb",
  "vendor/pdfjs/standard_fonts/LiberationSans-Bold.ttf",
  "vendor/pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf",
  "vendor/pdfjs/standard_fonts/LiberationSans-Italic.ttf",
  "vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf",
  "vendor/pdfjs/wasm/jbig2.wasm",
  "vendor/pdfjs/wasm/openjpeg.wasm",
  "vendor/pdfjs/wasm/qcms_bg.wasm",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // "reload" skips the browser's HTTP cache, so every file comes fresh from
    // this exact version (never a mix of old and new). If any file fails, the
    // install fails and the old version keeps running untouched.
    await cache.addAll(FILES.map((f) => new Request(f, { cache: "reload" })));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("setlist-") && key !== CACHE) await caches.delete(key);
    }
    // Take charge of the open page straight away on the very first install.
    await self.clients.claim();
  })());
});

// The app's "tap to reload" sends this.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Opening the app (or reloading it) always gets the saved page.
    const hit = req.mode === "navigate"
      ? await cache.match("index.html")
      : await cache.match(req, { ignoreSearch: true });
    return hit || fetch(req);
  })());
});
