# Architecture

```
data/raw/*.rar  (NASA archive, checksummed, never fully extracted)
      │  bsdtar -xO stream, split by exact member sizes (tocsin/archive.py)
      ▼
scripts/extract_features.py ──► data/work/features_<run>.npz     per-reading raw features, validity, quality
      │                    └──► artifacts/spectra/<run>/*.npy    display spectra (float16, 512 bins)
      ▼
scripts/tune.py (Test 1 only) ──► config/frozen.json (+ sha256)
      ▼
scripts/evaluate.py ──► results/heldout.json, robustness.json, sensitivity.json
scripts/build_artifacts.py ──► artifacts/runs.json, artifacts/replay/<run>/<condition>.json
scripts/benchmark.py ──► results/deploy.json        scripts/manifest.py ──► results/manifest.json
      ▼
scripts/package_artifacts.py ──► dist/*.tar.gz  (GitHub Release; pinned in config/artifacts.lock.json)
      ▼
server/app.py (FastAPI, Railway) ── serves artifacts + results read-only, runs POST /api/analyze live,
      │                              CORS for the Vercel origin; /api/health = readiness
      ▼  HTTPS (VITE_API_BASE)
web/ (React + TypeScript, Vite, Vercel) ── landing, replay workspace, evaluation, data & method, analyze
```

## Analysis package (`tocsin/`)

Every module can be tested on its own, and none of them does any I/O except `archive.py`.

| Module | Responsibility |
|---|---|
| `bearing.py` | Bearing geometry → defect frequencies as orders of shaft speed |
| `ingest.py` | IMS/CSV parsing; validation (rate, length, missing fraction, longest gap); interpolation of short gaps |
| `features.py` | Time-domain stats; band-pass → Hilbert envelope → spectrum; defect-band prominence |
| `detectors.py` | TOCSIN score, RMS baseline, isolation forest, ablations. All of them use the same per-bearing reference window |
| `state.py` | Causal state machine: BASELINING / NORMAL / WATCH / ALERT / DATA_INSUFFICIENT |
| `metrics.py` | Event-level run-to-failure metrics |
| `complications.py` | Seeded noise, sample dropout, gaps and lost readings |
| `explain.py` | Evidence object and template sentence built from structured decision data |
| `pipeline.py` | Feature table → scores → states → metrics (shared by tuning, evaluation and artifacts) |

## Why the replay is precomputed

The raw recordings are about 5 GB of ASCII, so the server cannot rerun the archive on demand within a free-tier memory budget.

Instead, every condition offered in the UI (as recorded, 10 dB noise, 0 dB noise, 20% dropout, gaps, 30% lost readings) was run through the **full pipeline** offline with the frozen configuration. The results are stored per condition.

- The UI labels these results as precomputed and shows the config hash.
- The replay reveals only readings up to the cursor.
- Live computation is demonstrated by `POST /api/analyze`, which runs the same functions on an uploaded reading.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Status, version, config hash |
| `GET /api/runs` | Runs, conditions, stored references, spectrum axis |
| `GET /api/config` | Frozen configuration and defect-band markers |
| `GET /api/replay/{run}?condition=` | Precomputed per-reading decisions for one run and condition |
| `GET /api/spectrum/{run}/{bearing}/{index}?condition=` | One display envelope spectrum |
| `GET /api/results/{name}` | `heldout`, `robustness`, `sensitivity`, `tuning_test1`, `deploy`, `manifest`, `tests` |
| `POST /api/analyze` | Multipart upload of one reading. Takes `sample_rate`, `rpm`, `column` and `reference` (e.g. `test2:1`) |

OpenAPI documentation is served at `/api/docs`.

## Deployment split

- **Frontend: Vercel.** Static Vite build from `web/` (`web/vercel.json`, SPA rewrite). `VITE_API_BASE` holds the API origin. It is public, not a secret.
- **API: Railway.** Built from `Dockerfile` (`railway.json`, health check `/api/health`).
  - The build downloads the pinned demo bundle once and verifies its checksums (`scripts/fetch_artifacts.py`).
  - The service never touches the NASA archive.
  - Allowed origins come from `TOCSIN_ALLOWED_ORIGINS`, plus localhost dev origins.
  - Upload bodies are capped at 8 MB before parsing.
- **Local:** the same API can serve `web/dist` itself (same origin), or Vite's dev server can proxy `/api`.

## Runtime footprint

`results/deploy.json` holds the measured values. Runtime state is one process. The server holds no secrets, has no database and needs no login.
