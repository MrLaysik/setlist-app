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
- `vendor/`: third-party code and fonts, served locally (filled in later milestones)
- `tools/`: dev helpers (`serve.sh`, `make-icons.py`)
- `reference/mockup.html`: the approved mockup

## Deploy

GitHub Pages serves the repo as-is from the `main` branch. Pushing to `main` deploys.
