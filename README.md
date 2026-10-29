# fit2map

Visualize Garmin GPS activities on an interactive map.

Two components in one repo:

| Component | Language | Purpose |
|-----------|----------|---------|
| **CLI tool** | Rust | Batch-converts a directory of `.fit` files → single `.gpx.gz` |
| **Web app** | JS / Leaflet | Interactive map; drop files directly or load the CLI output |

All browser processing is local — files are never uploaded anywhere.

---

## Web app

**Supported formats:** FIT, GPX, TCX, IGC, SKIZ, DERIVE, geotagged JPEG (and `.gz` variants of each)

Open the deployed app and drag-drop your activity files onto the map.

For large collections (hundreds to thousands of files), use the CLI tool first to
produce a single `.gpx.gz`, then drop that one file into the web app.

### Map controls

| Button | Action |
|--------|--------|
| Camera | Export as PNG or SVG |
| Sliders | Track color, width, opacity, map theme |
| Filter | Filter by date range |
| Map icon | Zoom to fit all tracks |
| Floppy | Save current tracks as `.derive` (fast reload later) |

### Getting your files

**Garmin device:** connect via USB → copy from `GARMIN/Activities/`

**Garmin Connect:** export individual activities, or request a full data export

**Strava:** account settings → "Request your archive" (may take several hours)

---

## CLI tool

### Build

Requires Rust (stable). Install via [rustup](https://rustup.rs/).

```sh
cargo build --release
# binary: ./target/release/fit2map
```

### Usage

```sh
fit2map <input-dir> <output.gpx.gz>
```

Reads every `.fit` file in `<input-dir>` in parallel, deduplicates consecutive
identical positions, and writes a single gzip-compressed GPX.

**Example — 10,000 files in ~5 seconds:**

```sh
./target/release/fit2map ~/Garmin/Activities all_activities.gpx.gz
# Decoding 10014 .fit files...
# Writing 1232 tracks, 907051 points → all_activities.gpx.gz
```

Then drag `all_activities.gpx.gz` into the web app.

---

## Development

### Web app

```sh
cd web
npm install
npm run serve   # webpack dev server
npm run build   # production build → web/bundle.js
```

### GitHub Pages

Push to `main`. The workflow in `.github/workflows/pages.yml` builds the web app
and deploys automatically.

Enable in repo settings: **Settings → Pages → Source → GitHub Actions**.
