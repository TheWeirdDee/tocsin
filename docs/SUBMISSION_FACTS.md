# Submission facts

The verified facts are marked ✔. The unknowns that the owner must confirm are marked ☐.

| Item | Status | Value / action |
|---|---|---|
| Event | ✔ | Wild Bugs, 24-hour online hackathon, 14–15 Oct 2026 (https://wild-bugs.devfolio.co/) |
| Problem statement | ✔ | PS 01 — MachinaSense: Intelligent Industrial Fault Detection and Predictive Maintenance |
| Hackathon end | ✔ | 15 Oct 2026, 11:59 PM IST (+05:30) = 19:29 WAT (Devfolio schedule page) |
| Separate submission deadline | ☐ | Not listed publicly. Check the Devfolio dashboard |
| Team size | ✔ | 1–4 |
| Required assets (video, deck, repo) | ☐ | Not stated publicly. Check the dashboard |
| Organiser dataset | ☐ | PS01 says organisers "should provide" data. No link was found in the PS document or on the event pages |
| Judging | ✔ | The PS01 rubric weights are detection 25, early warning 15, robustness 15, engineering 15, explainability 10, deployment 10, commercial 10. The event page also mentions creativity, technical depth and execution |
| Contact | ✔ | jsmyn.labs@gmail.com (from the event page) |

## Live URLs (verified 14 Oct 2026)

- App: **https://tocsin-phi.vercel.app**
- API: **https://tocsin-production.up.railway.app** (`/api/health` reports the running commit and config hash)
- Repository: https://github.com/TheWeirdDee/tocsin
- Release bundles: https://github.com/TheWeirdDee/tocsin/releases/tag/demo-artifacts-v1.1.0

The Railway service runs on a trial plan, which showed about $3 of credit left at deployment time. If the credit runs out, the API stops.

## Deployment (Vercel frontend, Railway API)

See README → Deployment for the configuration. Railway goes first, because the frontend build needs its URL.

| Setting | Railway (API) | Vercel (frontend) |
|---|---|---|
| Source | GitHub `TheWeirdDee/tocsin`, branch `main` | GitHub `TheWeirdDee/tocsin`, branch `main` |
| Root directory | repository root | `web` |
| Build | `Dockerfile` (via `railway.json`) | Vite: `npm ci`, `npm run build`, output `dist` (via `web/vercel.json`) |
| Start | `uvicorn server.app:app --host 0.0.0.0 --port $PORT` (Dockerfile CMD) | static |
| Health | `/api/health` (200 only when the config and artifacts agree) | n/a |
| Variables | `TOCSIN_ALLOWED_ORIGINS=https://tocsin-phi.vercel.app` | `VITE_API_BASE=https://tocsin-production.up.railway.app` |
| Secrets | none | none (everything in `VITE_*` is public) |

## Text for the submission form (draft)

**One line:** TOCSIN tells a maintenance lead which bearing to inspect first and shows the vibration evidence behind each alert.

**What it is:**
- A bearing-health monitor. It compares each bearing's envelope-spectrum energy at its own fault frequencies with that bearing's own healthy baseline, and requires persistence before alerting.
- Alerts are ranked into an inspection list. Each alert carries its evidence: the defect band, its level against the reference, persistence, spectrum, data quality and config version.
- Missing or invalid readings never produce a healthy verdict and never clear an alert.

**Evaluation (honest summary):**
- Thresholds were frozen on IMS Test 1. Held-out: IMS Tests 2 and 3 (2 failures, 6 undamaged bearings).
- TOCSIN alerted on 1 of 2 held-out failures. It gave the earliest warning on Test 3 B3 (40 h before the recording endpoint, vs 27 h for an RMS alarm). It spent the least time alerting on undamaged bearings of the three detectors compared.
- It missed Test 2 B1. A post-hoc diagnosis traced the miss to the observed defect tone (~231 Hz) sitting just outside the ±2% window around the computed 236.4 Hz.
- The pre-registered "earlier and quieter" claim is withdrawn. Robustness under noise and missing data, ablations and a reproducible pipeline are documented.
