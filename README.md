# Setlist

Personal iPad setlist app: an offline-first web app installed to the home screen. See `CLAUDE.md` for the full brief.

## Run it locally

```sh
sh tools/serve.sh
```

Then open http://localhost:8000/ in Safari or Chrome. The script also prints a `192.168.x.x` address your iPad can open on the same Wi-Fi.

## Layout

- `index.html`, `css/`, `js/`: the app (plain HTML/CSS/JS, no build step)
- `manifest.json`, `icons/`: what makes it installable
- `sw.js`: the service worker that keeps a full offline copy of the app
- `vendor/`: third-party code and fonts, served locally
- `tools/`: dev helpers (`serve.sh`, `make-icons.py`, `check-sw.sh`)
- `reference/mockup.html`: the approved mockup

## Offline copy and updates

`sw.js` saves every app file on the device and serves from that copy first. So after the first load, the app runs with no connection, and changes you make locally won't show up until the version changes.

When releasing:

1. Bump `APP_VERSION` in `js/app.js` and `VERSION` in `sw.js` (they must match).
2. Add any new app file to `FILES` in `sw.js`.
3. Run `sh tools/check-sw.sh`, which checks both.

Installed copies then show "Update ready, tap to reload". They never reload on their own.

## Deploy

GitHub Pages serves the repo as-is from the `main` branch. Pushing to `main` deploys.
