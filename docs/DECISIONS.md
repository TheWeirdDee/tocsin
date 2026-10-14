# Decisions and open dependencies

## Changes from the planning PRD, and why

| PRD said | What was built | Why |
|---|---|---|
| CWRU fault-type classifier is a core feature (F5) | Not built. Detection only | PS01 accepts detection *or* classification. With limited disk (~8 GB free) and time, the core detection evidence came first. Listed as an optional extension |
| B0 = mean + 3σ using healthy statistics "from tuning data" | Two RMS rows: **B0 tuned** (per-bearing reference, threshold chosen by the same rule as TOCSIN) and **B0-3σ** (fixed 3σ, untuned, context only) | The PRD described the baseline inconsistently. A fair comparison gives the baseline the same calibration window and the same tuning opportunity. The naive 3σ alarm is kept but labelled, because on Test 1 it sits in ALERT about 96% of the time |
| Isolation forest "trained on tuning healthy data" | Fit per bearing on that bearing's own first 72 valid readings | Same information as TOCSIN and the RMS baseline. A global model would be a different comparison |
| States include CRITICAL and BASELINE_SUSPECT (vs "fleet norms") | States are BASELINING, NORMAL, WATCH, ALERT and DATA_INSUFFICIENT | CRITICAL had no validated definition. "Fleet norms" were not established from permitted data. Both were removed rather than invented |
| Alert text like "inspect this shift" | "Prioritize inspection of this bearing" | No validated rule supports a time-bound instruction |
| Constrained benchmark inside a 0.5 CPU / 256 MB container | Measured on the build laptop and reported as such | Docker is not installed on the build machine. The target is not reported as a measurement |
| Fault point = last snapshot | Kept, and called the "recording endpoint" everywhere | The dataset has no failure timestamp |
| Test 1 channel: "use the first" | Kept: channels 1, 3, 5 and 7 | Pre-registered before tuning |
| Owner name, prior-project references, schedule | Not in any public material | They are not facts about the product |

## Engineering decisions

- **Streaming from the RAR archives** instead of extracting about 5 GB. `bsdtar -tv` gives exact member sizes and `bsdtar -xO` streams the members in the same order. Each member is hashed.
- **Precomputed replay per condition.** The full pipeline reruns offline for each complication. The UI labels these as precomputed with the config hash. Live analysis is available for uploads.
- **Robust z with a floor** (0.5 dB for prominence and RMS, 0.05 for the isolation-forest score). This stops a near-constant reference window from producing huge scores. The floor was fixed before tuning.
- **Durations capped at 20 min per reading** in alert-hours metrics, so overnight pauses are not counted.
- **Single light theme.** Implemented and tested fully, rather than shipping an untested dark mode.
- **Custom SVG charts.** These keep causal display (nothing after the cursor), exact threshold lines and small bundles.

- **Hosting: Vercel (frontend) and Railway (API)**, as the owner specified. Railway builds the Dockerfile from GitHub `main`. A Railway "restart" does not rebuild; a push does. The frontend calls the API cross-origin through `VITE_API_BASE`, with CORS limited to configured origins.
- **Demo artifacts in a GitHub Release, not in Git.**
  - The local artifacts were 156 MB, 83% of it display spectra.
  - Spectra are now stored as 8-bit log amplitude (±0.3 dB, chart-only). The bundle is 49 MB, pinned by SHA-256 in `config/artifacts.lock.json` and verified at Docker build time.
  - Replay decisions and all result files are byte-identical. No scientific output was regenerated to save space.
- **Licence:** MIT for the original code (author Divine Dilibe). Dataset terms are kept separately in `NOTICE.md`.

## Open dependencies (need the owner)

1. **Deadline confirmation.** The Devfolio schedule says the hackathon ends **15 Oct 2026, 11:59 PM IST** (19:29 WAT). No separate submission deadline is listed publicly, so please confirm in the Devfolio dashboard.
2. **Organizer dataset.** PS01 says organizers "should provide" data, but none is linked publicly. Please confirm in the dashboard or Discord whether a mandatory dataset exists.
3. **Hosting: resolved.**
   - Vercel project `tocsin` and Railway service `tocsin` are deployed. The Railway service sits in the owner's existing project `gentle-mercy`, which the owner chose because of the free-plan project limit.
   - The Railway account is on a trial with limited credit. Keeping the API online after the trial needs an owner decision.
4. **Submission assets.** The required video, deck and links are not stated publicly.
5. **Team details for the submission form.** The author is recorded as Divine Dilibe.
