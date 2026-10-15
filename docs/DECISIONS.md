# Decisions and open dependencies

## Changes from the planning PRD, and why

| PRD said | What was built | Why |
|---|---|---|
| CWRU fault-type classifier is a core feature (F5) | Not built. Detection only | PS01 accepts detection *or* classification. With limited disk (~8 GB free) and time, the core detection evidence came first. Listed as an optional extension |
| B0 = mean + 3σ using healthy statistics "from tuning data" | Two RMS rows: **B0 tuned** (per-bearing reference, threshold chosen by the same rule as TOCSIN) and **B0-3σ** (fixed 3σ, untuned, context only) | The PRD described the baseline inconsistently. A fair comparison gives the baseline the same calibration window and the same tuning opportunity. The naive 3σ alarm is kept but labelled, because on Test 1 it sits in ALERT about 96% of the time |
| Isolation forest "trained on tuning healthy data" | Fit per bearing on that bearing's own first 72 valid readings | Same information as TOCSIN and the RMS baseline. A global model would be a different comparison |
| States include CRITICAL and BASELINE_SUSPECT (vs "fleet norms") | States are BASELINING, NORMAL, WATCH, ALERT and DATA_INSUFFICIENT | CRITICAL had no validated definition. "Fleet norms" were not established from permitted data. Both were removed rather than invented |
| Alert text like "inspect this shift" | "Prioritize inspection of this bearing" | No validated rule supports a time-bound instruction |
| Constrained benchmark inside a 0.5 CPU / 256 MB container | Measured as planned, on a GitHub Actions runner (Docker is not installed on the build machine): 83 ms median analysis, peak 110 MB, no OOM (`results/deploy_constrained.json`). Earlier laptop measurements are kept and labelled | The runner's CPU differs from the laptop and from Railway, so its milliseconds are reported only as what they are: latency at half a CPU on that runner |
| Fault point = last snapshot | Kept, and called the "recording endpoint" everywhere | The dataset has no failure timestamp |
| Test 1 channel: "use the first" | Kept: channels 1, 3, 5 and 7 | Pre-registered before tuning |
| Owner name, prior-project references, schedule | Not in any public material | They are not facts about the product |

## Engineering decisions

- **Streaming from the RAR archives** instead of extracting about 5 GB. `bsdtar -tv` gives exact member sizes and `bsdtar -xO` streams the members in the same order. Each member is hashed.
- **Precomputed replay per condition.** The full pipeline reruns offline for each complication. The UI labels these as precomputed with the config hash. Live analysis is available for uploads.
- **Robust z with a floor** (0.5 dB for prominence and RMS, 0.05 for the isolation-forest score). This stops a near-constant reference window from producing huge scores. The floor was fixed before tuning.
- **Durations capped at 20 min per reading** in alert-hours metrics, so overnight pauses are not counted.
- **Single theme (dark since 15 Oct).** One theme is implemented and tested fully, rather than shipping an untested second theme.
- **Custom SVG charts.** These keep causal display (nothing after the cursor), exact threshold lines and small bundles.

- **Hosting: Vercel (frontend) and Railway (API)**, as the owner specified. Railway builds the Dockerfile from GitHub `main`. A Railway "restart" does not rebuild; a push does. The frontend calls the API cross-origin through `VITE_API_BASE`, with CORS limited to configured origins.
- **Demo artifacts in a GitHub Release, not in Git.**
  - The local artifacts were 156 MB, 83% of it display spectra.
  - Spectra are now stored as 8-bit log amplitude (±0.3 dB, chart-only). The bundle is 49 MB, pinned by SHA-256 in `config/artifacts.lock.json` and verified at Docker build time.
  - Replay decisions and all result files are byte-identical. No scientific output was regenerated to save space.
- **Licence:** MIT for the original code (author Divine Dilibe). Dataset terms are kept separately in `NOTICE.md`.

## Open dependencies (need the owner)

1. **Deadline: resolved.** The Devfolio schedule says the hackathon ends **15 Oct 2026, 11:59 PM IST** (19:29 WAT). No separate submission deadline is listed, so that is the deadline.
2. **Organizer dataset: resolved.** None was supplied. The official PS document (re-fetched 15 Oct 2026, byte-identical to the copy used, SHA-256 `b77fb768…`) and the event pages contain no dataset. PS01 line 20 allows public data when its labels and operating conditions are stated.
3. **Hosting: resolved.**
   - Vercel project `tocsin` and Railway service `tocsin` are deployed. The Railway service sits in the owner's existing project `gentle-mercy`, which the owner chose because of the free-plan project limit.
   - The Railway account is on a trial with limited credit. Keeping the API online after the trial needs an owner decision.
4. **Submission assets.** The required video, deck and links are not stated publicly.
5. **Team details for the submission form.** The author is recorded as Divine Dilibe.

## Realignment to the PS01 rubric (15 Oct 2026)

- **The simpler variant (A1) was not promoted to default.** PS01 line 6 requires evaluation "on data or scenarios not used to tune the final solution". Selecting A1 because it won on the held-out runs would make those runs part of tuning. TOCSIN stays the submitted detector, and A1 is documented as a candidate for future validation with a frozen procedure.
- **Five scenario entry points** (alert, missed failure, missing data, supported sample, method comparison) replace dropping visitors at reading 1. Each states what it does not establish.
- **Bearing-level precision/recall/F1** (with fractions) and **fault-family identification** are derived from existing results (`scripts/derived_metrics.py`). Nothing was re-run or re-tuned.
- **Visual direction** follows the rendered SquadRoom reference:
  - pill navigation and a light pill call to action;
  - a heavy, tight display headline with one accented word;
  - a large working product panel;
  - a split FAQ and an inverted closing card.

  The display face is Inter Tight, deliberately not the reference's brand font. No reference assets, copy or brand elements are used.
- **The machine-monitoring workflow** (`docs/PRODUCT_GAP.md`) stays a scoped proposal. It is not part of the judge journey, and no navigation points to unbuilt features.
