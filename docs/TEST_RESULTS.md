# Test results

Every log below was produced on 15 Oct 2026 against one source state. That state is HEAD `400a328` plus uncommitted changes, with fingerprint `b8783fbd8446b423d83622fea0ca3c7f700afeccec6eed0eff90254eb3b23548` from `python scripts/tree_fingerprint.py`. The fingerprint excludes `results/`, `docs/` and `README.md`, so recording the results does not change it. After release, the commit replaces the fingerprint as the identifier. Each log starts with its command, environment, fingerprint and start time.

Environment: Windows 11 Pro 10.0.26200; Python 3.12.10 in `.venv`; Node 24.13.1; Playwright Chromium; local uvicorn.

| Suite | Command (cwd) | Configuration | Passed | Failed | Skipped | Log |
|---|---|---|---|---|---|---|
| Python unit, integration, API, artifact integrity, audit regressions | `.venv/Scripts/python -m pytest -v` (root) | repo venv, local artifacts | 60 | 0 | 0 | `results/test-logs/pytest.txt` |
| Clean environment | `TOCSIN_ARTIFACTS=<fetched> <clean venv>/python -m pytest -q` (root) | venv built only from `requirements-dev.txt`; bundle `demo-artifacts-v1.1.0` fetched and checksum-verified from the GitHub release | 60 | 0 | 0 | `results/test-logs/clean_environment.txt` |
| Frontend unit | `npx vitest run` (web) | | 10 | 0 | 0 | `results/test-logs/vitest.txt` |
| Type-check | `npx tsc -b` (web) | | clean | | | `results/test-logs/tsc.txt` |
| Lint | `npx eslint .` (web) | | 0 errors, 0 warnings | | | `results/test-logs/eslint.txt` |
| Browser, same origin | `npx vite build && npx playwright test` (web) | uvicorn :8001 serves the build and the API; desktop 1440×900, tablet 820×1180, phone Pixel 7; 1 worker | 119 | 0 | 1 | `results/test-logs/playwright.txt`, `results/e2e.json` |
| Browser, cross-origin (Vercel/Railway split) | `VITE_API_BASE=http://127.0.0.1:8001 npx vite build && E2E_CROSS_ORIGIN=1 npx playwright test` (web) | vite preview :4173 calls the API on :8001; same three viewports | 119 | 0 | 1 | `results/test-logs/playwright-cross-origin.txt`, `results/e2e-cross-origin.json` |
| Browser, live deployment | `E2E_BASE_URL=https://tocsin-phi.vercel.app E2E_API_BASE=https://tocsin-production.up.railway.app npx playwright test` | earlier build (commit `3f857bf`) | 35 | 0 | 1 | `results/test-logs/playwright-deployed.txt` (to be rerun after deployment) |
| Deployed API and frontend checks | `python scripts/verify_deployment.py --api … --web …` | earlier build | 26/26, twice | | | `results/deploy-verification.json` (to be rerun after deployment) |
| Tuning reproducibility | rerun `scripts/tune.py`, compare with `config/frozen_v1.0.json` | | see log | | | `results/test-logs/retune_reproducibility.txt` |

The browser counts are **per configuration**. Each configuration runs the full 120-test suite on all three viewports. The skipped test is the keyboard skip-link test on the phone profile, which has no physical keyboard. The pytest warning is a third-party deprecation notice from Starlette's test client.

## What the tests cover

- **Real-file parsing:** a real IMS reading has shape 20,480 × 4. Ragged files and non-numeric content fail cleanly.
- **Validation:** wrong sample rate, short readings, more than 20% missing, and gaps over 2,048 samples are all rejected. Short gaps are interpolated. Machine-stopped readings are flagged causally.
- **Features:** synthetic outer- and inner-race impulse trains light up the correct band. The defect frequencies match the published values.
- **State machine:** baselining blocks alerts; WATCH → ALERT → clear; single spikes never alert; missing data freezes counters and never clears an alert or issues a healthy verdict.
- **No future leakage:** for TOCSIN, the RMS alarm, the isolation forest, A1 and the 3σ alarm, truncating the input never changes earlier scores or states.
- **Metrics:** lead time, alert burden, overnight-gap capping, non-negative durations, confusion counts.
- **Determinism:** seeded complications reproduce exactly.
- **Data-to-alert integration on real readings:** 72 healthy references, one gapped reading (no verdict), then late-life readings → ALERT with evidence.
- **Deployment hardening:** CORS allows known origins (including preflight) and refuses others; uploads over 8 MB get 413 before parsing; `/api/health` returns 503 without artifacts; a tampered artifact bundle is refused.
- **API:** the contract shape, and 404 or 422 on unknown run, condition, index, result, column, reference or bad file. Live analysis of a real reading reproduces the documented below-threshold Test 2 B1 behaviour. SPA fallback serves direct URLs.
- **Browser, on each viewport:**
  - landing → demo navigation;
  - play, pause, step, reset, seek;
  - direct URL with state and refresh;
  - complication switch;
  - a missing-data reading showing "No valid data";
  - evaluation, data and analyze pages;
  - 404 page and the mobile menu;
  - the skip link and visible focus;
  - no horizontal page scroll.

## Audit regressions and accessibility (added 15 Oct 2026)

- `tests/test_audit_regressions.py` covers:
  - TC-02/TC-08: unsupported settings return a structured 422 with CORS headers; unexpected errors return a JSON 500 with CORS headers.
  - TC-04: the analysis names the upload, not a hard-coded bearing.
  - TC-10: empty tab-separated cells keep their position, and repeated tabs are rejected rather than shifted.
  - TC-11: the rate limit returns 429 with `Retry-After`; analysis runs off the event loop; a timed-out analysis returns 504 but keeps its concurrency slot until its worker finishes; spoofed `X-Forwarded-For` entries neither change the client identity nor bypass the limit; over-long input is rejected before analysis.
- `web/e2e/audit.spec.ts` covers:
  - TC-01: fractional, negative, non-numeric, out-of-range and empty cursors, plus unknown run, condition and bearing, refresh, and back/forward.
  - TC-03: at readings 0, 40 and 71 of calibration, no reference, ratio, score, implicated band or trend appears in page text, chart tooltips, the priority list or accessible labels; the order is neutral.
  - TC-04 and TC-05: Analyze.
  - TC-06: delayed and failed replay loads.
  - TC-07: retained values.
  - TC-09: spectrum during playback.
  - Guided examples and the version display.
- `web/e2e/a11y.spec.ts` runs an automated axe-core WCAG 2.1 A/AA scan on six pages, at three viewports, and a reduced-motion check. Automated scanning is not an accessibility certification.
- `results/audit/reproduction-before.json` records the findings reproduced on the live site at commit `400a328`. `results/audit/reproduction-after.json` records the same script against the fixed local build.

## Final local record

The table at the top is the final record. Two problems found while producing it were fixed before the final run:

- **Landing contrast regression.** The axe scan failed on `/` at all three viewports: the paragraph in the dark closing card took the light card's text colour. It was fixed in `landing.css`.
- **TC-01 load timing.** Two TC-01 cursor cases failed on desktop because the 3.7 MB Test 3 replay had not finished loading within the default 5 s assertion wait. They now wait up to 20 s for the replay, like the other Test 3 tests. Loading takes several seconds on this machine under the suite's load; that is a product limitation, not hidden by the test.

Not covered: physical phones, real sensors, accessibility certification, and load tests of the public service.
