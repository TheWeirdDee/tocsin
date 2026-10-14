# Evaluation protocol (pre-registered)

**Written:** 14 Oct 2026, ~18:15 WAT. This was before any feature was computed on IMS Test 2 or Test 3. The only held-out files opened at this point were the archive listings (file names and byte sizes), which were used to check file counts.

**Status:** frozen for held-out evaluation. Any later change is recorded in the change log at the bottom, together with whether held-out results had already been seen.

## 1. Data split

| Role | Data | Bearings | Labels (IMS readme) |
|---|---|---|---|
| Tuning | IMS Test 1 (2,156 snapshots) | B1–B4, **first channel of each pair** (Ch 1, 3, 5, 7) | B3 inner-race defect, B4 roller defect at end of test; B1, B2 undamaged |
| Held-out | IMS Test 2 (984 snapshots) | B1–B4 (Ch 1–4) | B1 outer-race failure; B2–B4 undamaged |
| Held-out | IMS Test 3 (6,324 snapshots in archive) | B1–B4 (Ch 1–4) | B3 outer-race failure; B1, B2, B4 undamaged |

- The split is by whole test run. Windows from one run never fall on both sides.
- All held-out bearings are reported, whatever the outcome. Test 3 is known in the literature to be difficult and stays in the held-out set.
- Held-out totals: **2 failure events** and **6 undamaged bearings**. These counts are reported next to every summary number.

## 2. Labels and endpoint

- The readme states only that the defect was found at the *end* of each test. No onset time is labelled.
- **Endpoint = timestamp of the last snapshot in the run.** It is the end of recording, not a measured physical failure time.
- **Lead time** = endpoint − onset of the first ALERT on a faulty bearing, in hours.
- Secondary measure, the **terminal-alert lead time**: endpoint − onset of the ALERT episode that is still active at the endpoint. It is reported because an early, short alert followed by a long quiet period is less useful than a sustained one.

## 3. Calibration (per bearing, causal)

- Each bearing in each run gets a reference built from its **first N = 72 valid snapshots**. That is 12 h at 10-minute spacing, and 6 h for the first 43 files of Test 1.
- During those snapshots the state is BASELINING and no alert can be raised.
- The reference statistics are the **median** and the **scaled MAD** (1.4826 × MAD) of each feature over the window. A floor stops a tiny MAD from inflating scores (§5).
- No statistic from later in the run is ever used. Every score at time *t* depends only on snapshots ≤ *t*.
- **Every detector gets the same calibration window** (RMS baseline, isolation forest, TOCSIN and the ablations).

## 4. Signal processing (TOCSIN)

The bearing parameters come from the literature on this rig (Qiu et al., 2006), not from the IMS readme:

- Rexnord ZA-2115, 16 rollers per row, pitch diameter 2.815 in, roller diameter 0.331 in, contact angle 15.17°.
- Shaft speed is the readme's nominal 2000 RPM (33.33 Hz), which the rig holds constant.
- Defect frequencies are computed in code as orders of shaft speed, using the standard kinematic formulas: BPFO, BPFI and 2×BSF.

For each snapshot (one channel, 20,480 samples at 20 kHz):

1. **Validate.** The rate must be 20 kHz. The length must be ≥ 90% of 20,480. The missing fraction must be ≤ 20%. No contiguous gap may exceed 2,048 samples (0.1 s). If any check fails, the snapshot is **DATA_INSUFFICIENT**. Otherwise missing samples are linearly interpolated and the interpolated count is recorded.
2. **Remove the mean, then band-pass.** Butterworth order 4, zero-phase. The pass band is one of three candidates chosen on Test 1 only (§6): 1–9 kHz, 2–8 kHz or 4–9 kHz.
3. **Envelope.** Take |Hilbert(x)|, remove its mean, apply a Hann window and compute the amplitude spectrum. Resolution is 20,000 / 20,480 ≈ 0.98 Hz.
4. **Defect-band prominence.** For each family F ∈ {outer race (BPFO), inner race (BPFI), rolling element (2×BSF)} and harmonics h = 1, 2, 3:
   - **Peak** = maximum of the envelope spectrum within ±2% of h·f_F.
   - **Background** = median of the envelope spectrum within ±25 Hz of h·f_F, excluding the ±2% band.
   - **Prominence in dB** = 20·log10(peak / background).
   - The family feature x_F is the mean of the three harmonic prominences.
5. **Per-bearing score.** z_F = (x_F − median_ref) / max(1.4826·MAD_ref, 0.5 dB). The TOCSIN score is max_F z_F, and the implicated family is the argmax.

Context features are computed and shown but are not part of the TOCSIN decision: RMS, kurtosis, crest factor, peak, and broadband envelope level.

## 5. Detectors compared

All main detectors share the calibration window (§3), the threshold-selection rule (§6) and the persistence rule (§7).

| ID | Detector | Score |
|---|---|---|
| **TOCSIN** | Defect-band envelope prominence vs. own reference | max_F z_F (§4) |
| **B0 RMS** | Overall RMS level vs. own reference | (RMS_dB − median_ref) / max(1.4826·MAD_ref, 0.5 dB) |
| **B0-3σ** | Conventional fixed alarm (reported for context, not tuned) | Same as B0, threshold fixed at mean + 3σ of the reference window |
| **B1 iForest** | Isolation forest on the time-domain features RMS, std, peak, peak-to-peak, crest, kurtosis and skewness (standardised by the reference window). Fit per bearing on its reference window: 200 trees, seed 0 | −score_samples, robust-z vs. its own scores on the reference window, floor 0.05 |
| A1 | TOCSIN without defect bands: broadband envelope RMS in dB | robust z vs. own reference, 0.5 dB floor |
| A2 | TOCSIN with a *global* reference instead of a per-bearing one. Median and MAD are pooled from the reference windows of the Test 1 undamaged bearings and frozen | max_F z_F |
| A3 | TOCSIN without persistence (k = 1) | as TOCSIN, same threshold |

## 6. Threshold and band selection (Test 1 only)

- **Threshold grid:** θ ∈ {2.0, 2.5, …, 30.0}.
- **Rule, applied identically to every detector except B0-3σ and A3:** choose the smallest θ for which, on *each* undamaged tuning bearing (Test 1 B1, B2), the ALERT burden is ≤ 1% of its post-calibration valid snapshots. Among the three candidate pass bands, TOCSIN uses the one whose selected θ gives the longest mean lead time on Test 1 B3 and B4. Ties go to the wider band.
- If no θ satisfies the rule, the largest θ is used and the failure is recorded.
- The tuned configuration is written to `config/frozen.json` with a hash. Held-out features are computed only after this file exists.

## 7. Persistence and state machine

- **States:** BASELINING, NORMAL, WATCH, ALERT, DATA_INSUFFICIENT.
- A valid snapshot with score ≥ θ increments the exceedance counter. A valid snapshot below θ resets it.
- **WATCH** = 1 ≤ counter < k. **ALERT** = counter ≥ k. Here **k = 3** consecutive valid snapshots (30 min at 10-minute spacing). k was fixed a priori, not tuned.
- An ALERT clears to NORMAL only after **k consecutive valid snapshots below θ**.
- **DATA_INSUFFICIENT snapshots** do not advance, reset or clear any counter. The displayed state is "DATA_INSUFFICIENT (last valid: X, age Y)". These snapshots never produce a healthy verdict.

## 8. Metrics (per bearing, then summed per detector)

- **Faulty bearings (2 held-out events):**
  - detected (any ALERT after calibration): yes/no;
  - first-ALERT time and lead time;
  - terminal-alert lead time;
  - whether an ALERT is active at the endpoint;
  - number of ALERT episodes.
- **Undamaged bearings (6 held-out):**
  - number of ALERT episodes;
  - hours in ALERT;
  - ALERT hours per bearing-day;
  - whether any ALERT occurred.
- **Bearing-level confusion counts:** faulty bearing with ALERT = TP, without = FN; undamaged bearing with ALERT = FP, without = TN. Raw counts are always shown, with precision and recall computed from them.
- **Sub-analysis:** undamaged-bearing alerts in the last 24 h before the endpoint are counted separately. All four bearings share one shaft and one housing frame, so terminal failure can couple into neighbours. The strict primary metric still counts these alerts as false.

## 9. Complications (robustness, held-out runs)

Each condition is applied to the raw signal before the full pipeline. Seeds are fixed per (run, bearing, condition) by hashing those names.

| ID | Condition |
|---|---|
| clean | as recorded |
| noise20 / noise10 / noise0 | additive white Gaussian noise at 20/10/0 dB SNR. Noise σ is fixed per bearing as RMS_ref / 10^(SNR/20), where RMS_ref is the median RMS of the reference window, so it behaves like a constant sensor noise floor |
| drop5 / drop20 | 5% / 20% of samples per snapshot set missing at random positions |
| gaps | 15% of snapshots each lose one contiguous block of 40% of samples (which should yield DATA_INSUFFICIENT). Other snapshots are unchanged |
| loss30 | 30% of whole snapshots removed at random (the file never arrives) |

All detectors run under every condition with the frozen configuration.

## 10. Sensitivity and ablations

- Sensitivity of TOCSIN to N ∈ {36, 72, 144} and k ∈ {2, 3, 5}. This is reported for Test 1 (tuning) and for the held-out runs. Held-out sensitivity is **post-hoc and descriptive**. It is never used to change the frozen configuration.
- Ablations A1–A3 as in §5.

## 11. Reproducibility

- Seeds: complications are seeded by hashing the condition, run and bearing names. The isolation forest uses `random_state=0`.
- Software versions, data checksums and the frozen-config hash are written to `results/manifest.json`.

## Change log

- **14 Oct 2026, ~18:25 WAT. Before tuning and before any held-out feature was computed.** Clarified how durations are counted for alert hours and monitored hours. Each snapshot represents the time until the next snapshot, capped at 20 minutes. Without the cap, the overnight pauses in the tests (noted in the IMS readme) would count as monitored or alarmed time. This was implemented before tuning.
- **14 Oct 2026, ~18:40 WAT (config frozen 18:32 WAT). Tuning observations, recorded while held-out features were being extracted but before any held-out score or result was computed or viewed. The rule was not changed.**
  - The pre-registered band rule selected **2–8 kHz**. The deciding factor was an early first ALERT on Test 1 B4, 227.7 h before the endpoint.
  - Under the terminal-alert lead the three bands are nearly tied: 18.6 h, 18.5 h and 17.8 h.
  - The pre-registered rule was kept so that the selection is not adjusted after the fact.
  - The untuned B0-3σ alarm is in ALERT for about 96% of Test 1's monitored time on every bearing. It is reported only as context for a naive fixed alarm. The tuned B0 RMS detector is the fair baseline.
- **14 Oct 2026, ~19:15 WAT. Observation on a held-out reading, recorded before held-out results were computed. The frozen config was not changed.**
  - While writing an integration test, two Test 2 readings were inspected: the first file and one recorded about 40 minutes before the end.
  - In both readings, the strongest envelope peak near BPFO sits at 232.4 Hz. That is at the lower edge of the ±2% window around the computed 236.4 Hz.
  - Published analyses of this dataset report the observed outer-race frequency near 230–231 Hz, which suggests slip or a speed slightly below nominal.
  - Widening the tolerance after seeing a held-out reading would be leakage, so the frozen ±2% is kept for all held-out results.
  - Any wider-tolerance or speed-estimation variant is reported separately as **post-hoc**, never as held-out evidence.
  - The same readings show strong BPFO prominence on undamaged bearing 2 near the end of Test 2. This is consistent with vibration from bearing 1 coupling through the shared shaft.
- **14 Oct 2026, ~19:30 WAT. Hash convention fixed; no setting changed.** The config hash originally included the `frozen_at` timestamp, so an identical re-run would have produced a different hash. The hash now covers the settings only. The original hash `ac4af865dafc…` was verified to reproduce from the unchanged file before re-stamping it as `19deb402d814…`. The held-out feature metadata records both hashes.
- **14 Oct 2026, ~19:40 WAT. v1.0 held-out evaluation run.** Results were written to `results/v1.0_preregistered/`, with checksums in `SHA256SUMS.txt`. They are kept unchanged.
  - The hypothesis was **not supported**. TOCSIN's first alert on Test 2 B1 came 10 minutes before the end. The RMS alarm alerted 47 h before the end and the isolation forest 52.7 h before.
- **14 Oct 2026, ~19:50 WAT. Two ingestion defects found after the v1.0 results were seen. Fixed in v1.1.**
  1. Test 3's archive stores `2004.04.18.02.42.55` between `04.04.19.01.57` and `04.04.19.11.57`. Readings are now sorted by timestamp. The same permutation was applied to the existing feature files by `scripts/fix_order.py`; feature values are unchanged.
  2. The final readings of Tests 2 and 3 are flat on all channels (1–6% of normal RMS). Since v1.1, a reading below 10% of the bearing's normal RMS gets no verdict. "Normal" is the median of the bearing's first 72 accepted readings, or of the readings so far while that window fills. This flags zero Test 1 readings, so the tuned thresholds are unchanged.
  - **v1.1 held-out numbers were computed after the v1.0 results were seen. They are not clean held-out evidence.** Both versions are reported side by side.
- **14 Oct 2026, ~20:00 WAT. Post-hoc diagnosis, not held-out evidence.**
  - Stored envelope spectra show the outer-race tone at about 231 Hz on both held-out failures, which is outside the ±2% window (231.7–241.1 Hz).
  - A variant with a ±4% window was evaluated with the same Test 1 threshold rule (`scripts/posthoc_tolerance.py` → `results/posthoc_tol4.json`).
  - It is reported only as a diagnosis. The deployed detector is unchanged.
