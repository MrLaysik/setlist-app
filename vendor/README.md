# Vendored third-party files

Served locally so the app never needs a CDN and works offline.

## pdfjs/ — PDF.js 6.4.299 (Apache-2.0)
Source: npm `pdfjs-dist@6.4.299` (https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.4.299.tgz)

- `pdf.min.mjs`, `pdf.worker.min.mjs`: from `legacy/build/` (wider browser support)
- `standard_fonts/`: for PDFs that don't embed common fonts
- `wasm/`: JBIG2, OpenJPEG and QCMS decoders (scanned charts, color profiles)
- `iccs/`: color profile used by QCMS
- Not included: `cmaps/` (only needed for CJK text), the forms scripting engine

## fonts/ — Barlow 5.3.0, Barlow Condensed 5.3.0 (SIL OFL 1.1)
Source: npm `@fontsource/barlow@5.3.0`, `@fontsource/barlow-condensed@5.3.0`

- Barlow 400, 500, 600 and Barlow Condensed 500, 600, 700; Latin subset, woff2

## jszip/ — JSZip 3.10.2 (MIT, dual-licensed with GPLv3)
Source: npm `jszip@3.10.2` (https://registry.npmjs.org/jszip/-/jszip-3.10.2.tgz)

- `jszip.min.js` from `dist/`. Classic script (sets `window.JSZip`); loaded on demand by `js/backup.js`.
