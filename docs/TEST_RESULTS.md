# Test results

Every local log below was produced on 15 Oct 2026 against one source state: commit `260348a` plus the guided-scenario fix, fingerprint `a05ab1006140d80b05dcc433f3e0181cda4aaadb2d35bcbc67f56b351b5f3a4d`. That is exactly the source of the release that follows it (`python scripts/tree_fingerprint.py`). The fingerprint excludes `results/`, `docs/` and `README.md`, so recording results does not change it. Each log starts with its command, environment, fingerprint and start time.

Environment: Windows 11 Pro 10.0.26200; Python 3.12.10 in `.venv`; Node 24.13.1; Playwright Chromium; local uvicorn.

**One later test change.** After this run, the deployed-smoke browser job on release `9317a3e` failed one test on phone: "working preview panels do not overlap". The panels, which sit edge to edge, were reported overlapping by 0.013 px, which is sub-pixel rounding. The test now ignores overlaps under 1 px and measures after the entrance animation settles. That single test was then re-run on all three viewports in same-origin, cross-origin and live-deployment mode: 9 of 9 passed. Nothing else changed.

| Suite | Command (cwd) | Configuration | Passed | Failed | Skipped | Log |
|---|---|---|---|---|---|---|
| Python unit, integration, API, artifact integrity, audit regressions | `.venv/Scripts/python -m pytest -v` (root) | repo venv, local artifacts | 67 | 0 | 0 | `results/test-logs/pytest.txt` |
| Clean environment | `TOCSIN_ARTIFACTS=<fetched> <clean venv>/python -m pytest -q` (root) | venv built only from `requirements-dev.txt`; bundle `demo-artifacts-v1.1.0` fetched and checksum-verified from the GitHub release | 67 | 0 | 0 | `results/test-logs/clean_environment.txt` |
| Frontend unit | `npx vitest run` (web) | | 10 | 0 | 0 | `results/test-logs/vitest.txt` |
| Type-check | `npx tsc -b` (web) | | clean | | | `results/test-logs/tsc.txt` |
| Lint | `npx eslint .` (web) | | 0 errors, 0 warnings | | | `results/test-logs/eslint.txt` |
| Browser, same origin | `npx vite build && npx playwright test` (web) | uvicorn :8001 serves the build and the API; desktop 1440×900, tablet 820×1180, phone Pixel 7; 1 worker | 137 | 0 | 1 | `results/test-logs/playwright.txt`, `results/e2e.json` |
| Browser, cross-origin (Vercel/Railway split) | `VITE_API_BASE=http://127.0.0.1:8001 npx vite build && E2E_CROSS_ORIGIN=1 npx playwright test` (web) | vite preview :4173 calls the API on :8001; same three viewports | 137 | 0 | 1 | `results/test-logs/playwright-cross-origin.txt`, `results/e2e-cross-origin.json` |

The browser counts are **per configuration**: each configuration runs the full 138-test suite on all three viewports. That suite includes `motion.spec.ts`, which covers:
- reduced motion;
- every element visible after scrolling;
- no duplicate scroll animations after repeated navigation;
- calls to action and the preview staying usable while the motion runs.

The skipped test is the keyboard skip-link test on the phone profile, which has no physical keyboard. The pytest warning is a third-party deprecation notice from Starlette's test client.

## Checks against the live deployment

### Release `260348a` (15 Oct 2026; superseded, see the top of this section for the latest)

Both services served `260348a`, config `960523ff…`, bundle `tocsin-demo-artifacts-v1.1.0`, `consistent: true`.

| Check | Where it ran | Result |
|---|---|---|
| Deployed smoke workflow, all jobs | GitHub runner ([run 38749784194](https://github.com/TheWeirdDee/tocsin/actions/runs/38749784194)) | Passed: versions; deployment checks 26/26 (server analysis median 61.8 ms, round trip 343 ms); TC-11 identity; 12 audit findings 22/22 checks; browser suite desktop and phone 89 passed, 1 skipped; release gate |
| Deployment verification | Build machine | 26 passed, 0 failed (`results/deploy-verification.json`, label `release-260348a`) |
| TC-11 identity | Build machine and two GitHub runners | Three networks, three distinct identities, each equal to its own address hash; spoofed headers ignored |
| 12 audit findings | Build machine | Two runs: every check passed in at least one; the only failures were uploads that got no response over this machine's connection (HTTP 0), not server verdicts (`results/audit/deployed-check-260348a.json`) |

### Release `c7819c3` (previous)

These ran from the build machine against https://tocsin-phi.vercel.app and https://tocsin-production.up.railway.app, both serving `c7819c3`. They describe the deployed release, not the uncommitted change set above.

| Check | Command | Result | Record |
|---|---|---|---|
| Frontend/API version agreement | `GET /version.json`, `GET /api/version` | Both report `c7819c3`; config `960523ff…`, bundle `tocsin-demo-artifacts-v1.1.0`, `consistent: true` | n/a |
| Deployment verification | `python scripts/verify_deployment.py --api … --web … --label release-c7819c3` | 26 passed, 0 failed (health, artifacts, CORS, uploads, error codes, direct routes); server analysis median 29 ms, round trip from this machine 3.7 s | `results/deploy-verification.json` |
| 12 audit findings | `node web/e2e/audit_repro.mjs …` then `python scripts/check_audit_deployed.py …` | 19 of 22 checks passed: 11 findings pass. **TC-11 fails:** the identity is one of Railway's edge addresses, not the visitor (spoofing cannot change it). The fix is in the change set above, not yet deployed | `results/audit/reproduction-deployed.json`, `results/audit/deployed-check-c7819c3.json` |
| Browser suite, desktop and phone | `E2E_BASE_URL=… E2E_API_BASE=… npx playwright test --project=desktop --project=phone` | First pass: 66 passed, 13 failed, 1 skipped (see below) | `results/test-logs/playwright-deployed.txt` |
| Rerun of those 13 failures, deployed-mode timeouts | same, `--last-failed` | 12 passed; the 13th then passed in isolation | `results/test-logs/playwright-deployed-rerun.txt` |

What the first-pass failures were:
- **Network on the build machine:** 3 were `net::ERR_NETWORK_CHANGED` (the build machine's network dropped) and 2 were 60 s timeouts.
- **Slow arrival, not wrong content:** 7 found content arriving after the default 5 s wait. Spectrum and replay requests take about 3.6 s each from this machine, and TC-09's label correctly said "updating to reading N".
- **A real weakness on slow connections:** the deep link to `#reproduce` on phone lost its target as content loaded above it. Layout now keeps the target in view while content loads; that fix is in the change set above.

Deployed runs now allow 20 s per assertion, and tests against a deployment allow 120 s per test. The behaviour checked is unchanged. The one remaining rerun failure was a tooling clash: a concurrent local run removed its trace file. The `Deployed smoke` workflow repeats all of these from a GitHub runner after each deployment.

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
