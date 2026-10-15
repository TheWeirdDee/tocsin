# Submission facts

The verified facts are marked ✔. The unknowns that the owner must confirm are marked ☐.

| Item | Status | Value / action |
|---|---|---|
| Event | ✔ | Wild Bugs, 24-hour online hackathon, 14–15 Oct 2026 (https://wild-bugs.devfolio.co/) |
| Problem statement | ✔ | PS 01 — MachinaSense: Intelligent Industrial Fault Detection and Predictive Maintenance |
| Hackathon end | ✔ | 15 Oct 2026, 11:59 PM IST (+05:30) = 19:29 WAT (Devfolio schedule page) |
| Submission deadline | ✔ | No separate deadline is listed; the hackathon end applies: 15 Oct 2026, 11:59 PM IST = 19:29 WAT (Devfolio schedule page, checked 15 Oct) |
| Team size | ✔ | 1–4 |
| Required assets (video, deck, repo) | ☐ | Not stated on the public pages; Devfolio shows them in the project submission form |
| Organiser dataset | ✔ | None supplied. The official PS document (re-fetched 15 Oct, unchanged, SHA-256 `b77fb768…`) and the event pages contain no dataset. PS01 line 20 allows public data if its labels and operating conditions are stated, which the README does |
| Judging | ✔ | The PS01 rubric weights are detection 25, early warning 15, robustness 15, engineering 15, explainability 10, deployment 10, commercial 10. The event page also mentions creativity, technical depth and execution |
| Contact | ✔ | jsmyn.labs@gmail.com (from the event page) |

## Live URLs (checked 15 Oct 2026, release `260348a`)

- App: **https://tocsin-phi.vercel.app**
- API: **https://tocsin-production.up.railway.app** (`/api/version` reports the running commit, config hash and artifact bundle)
- Repository: https://github.com/TheWeirdDee/tocsin
- Release bundles: https://github.com/TheWeirdDee/tocsin/releases/tag/demo-artifacts-v1.1.0

**Hosting continuity:**
- The API runs on a Railway trial with $2.95 of credit left (15 Oct 2026). If the credit or the trial ends during judging, the API stops; the app then shows that the server could not be reached.
- Both services are in the owner's accounts (Vercel and Railway). Configuration and verification: [DEPLOYMENT.md](DEPLOYMENT.md).

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md): ownership, every environment variable, build settings and verification.

## Demo video

Not recorded yet. The three-minute script is in [DEMO_SCRIPT.md](DEMO_SCRIPT.md). It needs the owner's narration and screen recording.

## Text for the submission form

**One line:** TOCSIN checks bearing vibration, flags unusual changes, and shows the evidence behind each alert. It is a research prototype evaluated on recorded run-to-failure tests.

**What it does:**
- For each bearing, it compares the strength of bearing-fault vibration patterns (outer race, inner race, rolling element) with that bearing's own early readings. It alerts only after three consecutive valid readings above the threshold.
- Alerts become a ranked inspection list with their evidence: band, measurement vs reference, persistence, spectrum, data quality and version.
- Readings that fail quality checks get no verdict and never clear an alert.
- A recorded replay of three NASA/IMS run-to-failure tests (decisions precomputed), plus live server-side analysis of one supported, IMS-compatible reading.

**Evaluation:**
- Thresholds were frozen on IMS Test 1 before the held-out run. Tests 2 and 3 are held out: 2 failed bearings, 6 undamaged.
- TOCSIN alerted on **1 of 2** failures. 4 of 6 undamaged bearings were also alerted, so bearing-level precision is 1 of 5 alerted bearings (0.20). That is a count over 8 bearings, not a per-reading or field rate.
- The RMS alarm and the isolation forest alerted on 2 of 2.
- On the failure it caught (Test 3 bearing 3), TOCSIN warned 40 h before the recording endpoint, against 27 h (RMS alarm) and 26.5 h (isolation forest), and named the correct fault family. A stricter 3-sigma RMS alarm warned earlier (59 h). Lead time is measured to the end of the recording, not to a measured failure time.
- It missed Test 2 bearing 1: the real fault tone sat just outside its frequency window.
- A simpler variant without defect bands did better on these recordings. It was not adopted, because choosing it after seeing the held-out results would tune the final solution on its test data.
- v1.1 corrected two data-handling defects after the pre-registered v1.0 run, so only v1.0 is clean held-out evidence. Both are reported.
- Noise and missing-data handling are tested with seeded perturbations of the real recordings.

**Links:** app https://tocsin-phi.vercel.app · repository https://github.com/TheWeirdDee/tocsin · judge quick start in the README.
