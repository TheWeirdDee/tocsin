# Test results

All logs come from actual runs on 14 Oct 2026 (re-run after the deployment changes), on the build machine (Windows 11, Python 3.12.10, Node 24).

| Suite | Command | Result | Log |
|---|---|---|---|
| Python unit + integration + API + artifact integrity | `.venv/Scripts/python -m pytest -v tests` | 42 passed | `results/test-logs/pytest.txt` |
| Frontend unit | `cd web && npx vitest run` | 6 passed | `results/test-logs/vitest.txt` |
| Type-check | `cd web && npx tsc -b` | clean | `results/test-logs/tsc.txt` |
| Lint | `cd web && npx eslint .` | 0 errors, 5 warnings (React fast-refresh, dev-only) | `results/test-logs/eslint.txt` |
| End-to-end, 3 viewports, same origin | `cd web && npm run build && npx playwright test` | 35 passed, 1 skipped (keyboard test on phone) | `results/test-logs/playwright.txt`, `results/e2e.json` |
| End-to-end, 3 viewports, cross-origin (Vercel/Railway split) | `cd web && VITE_API_BASE=http://127.0.0.1:8001 npm run build && E2E_CROSS_ORIGIN=1 npx playwright test` | 35 passed, 1 skipped | `results/test-logs/playwright-cross-origin.txt` |
| End-to-end against the live deployment | `E2E_BASE_URL=https://tocsin-phi.vercel.app E2E_API_BASE=https://tocsin-production.up.railway.app npx playwright test` | 35 passed, 1 skipped | `results/test-logs/playwright-deployed.txt`, `results/e2e-deployed.json` |
| Deployed API and frontend checks, before and after a Railway restart | `python scripts/verify_deployment.py --api … --web …` | 26/26 passed, twice | `results/deploy-verification.json` |
| CI (GitHub Actions) | `.github/workflows/ci.yml` | green on every push since the workflow was added | GitHub Actions tab |
| Tuning reproducibility | rerun `scripts/tune.py`, compare with `config/frozen_v1.0.json` | see log | `results/test-logs/retune_reproducibility.txt` |

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
