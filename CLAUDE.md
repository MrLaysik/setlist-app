# Setlist App — project brief

Personal-use iPad setlist app for Brad, a drummer/vocalist who plays live gigs. Not for distribution. Built as an installable, offline-first web app (PWA) added to the iPad home screen.

`reference/mockup.html` is an approved clickable mockup. Match its look and behavior, but don't copy its code wholesale. It loads fonts and PDF.js from CDNs and keeps everything in memory, and the real app must do neither.

## Working agreements

- Brad is technical (audio engineer, comfortable with software) but new to web development. Explain what you're about to do in plain terms before running commands, and keep the tone casual and direct.
- Work one milestone at a time (see "Build order"). Don't start the next one until Brad confirms the current one works on his iPad.
- End every milestone with: what changed, how to test it on the Mac, and exactly how to test it on the iPad.
- Commit after each working step with a clear message. Push to deploy only when Brad says so.
- Don't add features beyond this brief without asking. Ask before adding any dependency.
- Gig reliability beats cleverness. Prefer simple, boring, well-supported approaches.

## Target

- iPad on iPadOS 27, Safari, installed to the home screen (standalone mode). Must also work in desktop Safari/Chrome on a Mac for testing.
- Portrait and landscape. Touch-first: tap targets at least 44px, primary controls bigger.

## Tech constraints

- Plain HTML, CSS, and JavaScript (ES modules are fine). No framework and no build step, so the repo is deployable as-is.
- Third-party code goes in `vendor/` and is served locally, never from a CDN: PDF.js for rendering charts, a small zip library (e.g. JSZip) for backups, plus the fonts (Barlow, Barlow Condensed) as local files.
- Storage in IndexedDB (a tiny wrapper like `idb` in `vendor/` is OK).
- A service worker precaches the whole app, including the vendor files and fonts, so it runs fully offline after the first load.
- Web app manifest with name, icons, `display: standalone`, and a dark theme color.
- Hosted on GitHub Pages from this repo. Local testing via a simple local server on `localhost` (service workers require it).

## Data model (IndexedDB)

- `songs`: `{ id, title, bpm, lengthSec, zoom (default 1), pdfId, createdAt, updatedAt }`
- `pdfs`: `{ id, blob, fileName, pageCount }`
- `setlists`: `{ id, name, songIds: [ordered], createdAt, updatedAt }`
- `meta`: `{ lastBackupAt, schemaVersion }`

Setlists reference songs by ID, so editing a song updates it everywhere and one song can appear in many setlists. Deleting a song asks for confirmation and removes it from every setlist.

## Features

### Library
- Two tabs: Setlists and Songs.
- Songs: add a song (title, PDF upload, BPM, length as m:ss), edit it, delete it. The app never edits PDF content; a song's file is just the uploaded PDF, which can be replaced.
- Setlists: create, rename, delete. Add songs from the master list. Reorder by dragging (touch-friendly). Show total set length.
- Tapping a setlist shows its numbered running order with a "Start set" button. Tapping a song in that list starts performance at that song.

### Performance view (dark "stage" look, always dark)
- Top bar: back, song title, "Song X of Y, <setlist name>", keep-awake indicator, song settings button, and the metronome (BPM plus dot).
- The chart renders as one continuous vertical stack of PDF pages.
- Bottom bar: previous button (shows the previous song's title), a big Start/Stop button with progress bar and `elapsed / length` time, and a next button (shows the next title).

### Auto-scroll (driven by song length)
- Scroll speed comes from the song's length: the chart moves from top to bottom over `lengthSec`.
- Implement it as a position-in-song clock (`pos` seconds). While running: `pos = posStart + elapsed`, `scrollTop = pos / lengthSec * maxScroll`. Use `requestAnimationFrame` and `performance.now()`.
- Start/Stop controls scrolling only. Start from the end restarts from the top.
- If Brad drags or pinches while it's running, pause the clock during the touch and any momentum, then resume from the new position at the same pace.
- Manual scrolling while stopped updates `pos`, so Start continues from where the chart is.

### Visual metronome
- Starts automatically whenever a song loads, including on song changes.
- A large dot (60px; 48px on narrow screens) with a solid on/off state and no animation: amber for the first 50% of each beat, dark gray for the rest.
- Beat timing is calculated from a start timestamp (`(now - start) % beatLen`), never accumulated, so it can't drift.
- Tapping the metronome toggles it on and off, independent of Start/Stop. When off, the dot shows as an empty ring.
- No audio.

### Pinch to zoom
- Custom pinch zoom on the chart only. Block browser page zoom (`touch-action: pan-x pan-y` on the chart, prevent `gesturestart`).
- Range 50%–300%, snapping to 100% near it, anchored to the point between the fingers.
- Zoom changes the rendered page width, not a CSS transform, so auto-scroll and the scroll math keep working. Re-render PDF pages at a resolution that stays sharp when zoomed.
- When zoomed wider than the screen, horizontal panning works and auto-scroll leaves the horizontal position alone.
- Zoom is saved per song (`song.zoom`).
- A "Fit to width" button appears whenever zoom isn't 100%.
- Trackpad pinch (ctrl + wheel) works on the Mac for testing.

### Moving between songs
- Previous/next buttons, plus swiping left or right on the chart. Ignore swipes that are mostly vertical, multi-touch, or slow.
- When zoomed in, a swipe only changes songs if the chart is already at that horizontal edge; otherwise it pans. The buttons always work.
- Changing songs stops the scroll, resets to the top at the song's saved zoom, and restarts the metronome. A short slide-in shows the change; respect reduced motion.
- A small bounce at the start or end of the set.

### Keep screen awake
- Request a Screen Wake Lock in performance view and re-request it when the app becomes visible again.
- An indicator shows "Screen stays on" or "Screen may sleep"; tapping it retries. Release the lock when leaving performance view.

### Backup and restore
- Backup exports one `.zip` with `data.json` (all songs, setlists, and meta with `schemaVersion`) and `pdfs/<id>.pdf`, then hands it to the iPad's share/save sheet so it can go to Files or iCloud Drive. Record `lastBackupAt`.
- Restore takes a backup zip, validates it, shows what it contains, and replaces everything after a clear confirmation.
- Settings shows "Last backed up X days ago".
- Show a gentle reminder if there's no backup in 14 days, or if there have been changes since the last backup.

### Reliability
- On first launch, call `navigator.storage.persist()`. Settings shows whether persistent storage was granted.
- Updates: when a new service worker is waiting, show a small "Update ready, tap to reload" banner. Never reload on its own, so it can't happen mid-song.
- Handle a full disk or a failed save with a clear message; never fail silently.

## Visual style (from the mockup)

- Library: clean, left-aligned list rows (not cards), with big condensed titles and numbered running orders. Light and dark themes follow the system.
- Stage colors: background `#151A24`, surfaces `#1E2431` / `#2A3142`, text `#ECE9E2` / `#9AA2B4`, accent amber `#F4B53F`, dot off `#3A4256`.
- Fonts: Barlow Condensed for titles, BPM, and the Start button; Barlow for everything else.
- Sentence case everywhere, plain wording, buttons named for what they do.
- Respect iPad safe areas (`viewport-fit=cover` plus `env(safe-area-inset-*)`).

## Build order

Each milestone ends with something Brad can test on his iPad.

0. **Setup:** repo structure, local server, GitHub Pages deploy, manifest, and icons. A blank app installs to the home screen and opens full-screen.
1. **Songs and PDFs:** add/edit/delete songs, store PDFs in IndexedDB, and view a chart as continuous pages.
2. **Backup and restore**, done before Brad loads his real charts.
3. **Setlists:** create, rename, delete, add songs, drag to reorder.
4. **Performance view:** auto-scroll by song length, Start/Stop, previous/next buttons, and swipe.
5. **Visual metronome.**
6. **Pinch to zoom**, saved per song.
7. **Gig-proofing:** offline caching, persistent storage, keep-awake, the update banner, and an airplane-mode test of a full set.
8. **Polish:** spacing, sizes, and any rough edges Brad finds at rehearsal.
