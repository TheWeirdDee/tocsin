# PS01 requirements map

**Source:** the official problem-statement document, PS 01 section. Raw text retrieved 15 Oct 2026, SHA-256 `b77fb768…`. Line numbers refer to that text.

## Mandatory MVP

| PS01 line | Requirement | Implementation | Evidence | Genuine gap | Status / next |
|---|---|---|---|---|---|
| 8 | Ingest and analyze time-series data from at least one type of industrial equipment | IMS bearing accelerometer recordings: 9,464 one-second readings at 20 kHz, streamed from the NASA archive with per-file SHA-256 (`tocsin/archive.py`, `ingest.py`). Live single-reading analysis via `POST /api/analyze` | `results/manifest.json`; parse errors 0; `tests/test_signal.py`, `test_integration.py` | One equipment type (rolling bearings) on one rig | Met |
| 9 | Detect abnormal patterns or classify predefined faults "in the supplied dataset" | Per-bearing envelope defect-band detector with persistence (`detectors.py`, `state.py`). The implicated band names the potential fault condition | `results/heldout.json`; `results/derived_metrics.json` (fault-family identification) | The organisers supplied no dataset: the official PS document (re-fetched 15 Oct, unchanged) and the event pages contain none. Public IMS data is used, which PS01 line 20 allows. Detection is weak: 1 of 2 held-out failures alerted, and 4 of 6 undamaged bearings alerted (precision 0.20); TOCSIN is below both baselines | Met, with weak results reported honestly |
| 10 | Each alert shows relevant sensor evidence, timestamp, and interpretable severity or priority | Evidence card: band, measurement vs reference, ratio, persistence, spectrum, data quality, recording timestamp, state (Watch/Alert), priority rank | Replay UI; `tocsin/explain.py`; e2e tests | "Severity" is an ordinal state plus a score relative to the threshold, not a calibrated probability, and is labelled that way | Met |
| 11 | Evaluate on a held-out dataset or hidden scenarios and report the selected metrics | Thresholds frozen on Test 1; Tests 2 and 3 held out; event-level metrics plus bearing-level P/R/F1 with counts | `docs/EVALUATION_PROTOCOL.md`; `results/v1.0_preregistered/`; `results/heldout.json`; `results/derived_metrics.json` | v1.1 corrections were made after v1.0 was seen (disclosed). Only 2 failure events | Met for the pre-registered v1.0 run. **Not strictly met for v1.1:** its data-handling fixes were made after v1.0's held-out results were seen, so v1.1 needs an untouched test set before claiming strict compliance, and IMS has none left. Both versions are reported. P/R/F1 with fractions are shown on the landing page, the evaluation page and in the README |
| 12 | Handle at least one realistic complication (noise, missing samples, or changing conditions) | Validation rules, no-verdict state, retained last valid state; seeded noise at 20/10/0 dB, dropout, gaps, lost readings, each rerun through the full pipeline | `results/robustness.json`; replay complications; e2e TC-07 | Changing operating conditions: **not** demonstrated (IMS runs at constant speed and load) | Met for noise and missing data; each perturbation is shown with its transformation, seed and behaviour (`results/robustness_examples.json`) |

## Framing sentences that constrain decisions

| Line | Text (abridged) | Consequence |
|---|---|---|
| 5 | "Smaller operators may have limited capacity to interpret sensor data" | Target user for the commercial framing |
| 6 | "identify potential fault conditions" | Report fault-family identification against labels (derived metrics) |
| 6 | "must be evaluated on data or scenarios not used to tune the final solution" | **Do not promote A1 to default on the basis of held-out results.** That would tune the final solution on its test data. TOCSIN stays the default, and A1 is reported as an evidence-informed candidate for future validation |
| 20 | "If public data is used, teams should be told what labels and operating conditions are available" | State the labels (end-of-test damage per bearing, no onset) and conditions (2000 RPM, 6000 lb, constant) in one place |
| 20 | "Synthetic telemetry … should not be the sole basis for claims" | All performance claims come from real recordings. Perturbations are labelled as such |

## Rubric

| Criterion (weight) | Rubric text | Evidence before this release | Improvement in this release |
|---|---|---|---|
| Detection (25) | P/R/F1 or an appropriate metric fitting the label structure | Event-level counts; bearing-level P/R/F1 with counts (derived) | Show P/R/F1 with fractions in the app and README; fault-family identification |
| Early warning (15) | Warnings before a defined fault point; consistent lead time | Lead time to the recording endpoint; alert timelines | "Before final 24 h" view; keep the endpoint definition explicit |
| Robustness (15) | Noise, missing samples, changing loads, unseen periods | Robustness grid; held-out tests are unseen periods | Show the transformation, seed, affected readings and behaviour; demonstrate an invalid reading not clearing an alert and valid data resuming |
| Engineering and reproducibility (15) | Reliable ingestion, clear pipeline, repeatable evaluation, failure handling, understandable setup | Checksums, streaming, frozen config, reproduce script, CI, artifact verification, audit fixes | Clean-environment setup check; version record agreement |
| Explainability and actionability (10) | Alerts supported by signals; useful priorities; no overstated certainty | Evidence card, priority list, templated sentences | Actionability line ("arrange a confirmatory inspection; does not confirm a defect") |
| Deployment efficiency (10) | Latency, memory, compute; suitability for the *proposed* deployment | Laptop benchmark; Railway server timing | State the proposed deployment; single-core benchmark with peak memory (no claim of a container cap) |
| Commercial (10) | Target user, workflow integration, defensible benefit | Landing copy | A concise section: user, workflow (exported readings, then sensors), benefit framed as proposed |

## Optional extensions (status)

- Remaining useful life / time-to-inspection: not attempted. The labels cannot support it.
- Constrained-deployment report: partial (see above).
- Fusing features with a learned model: no. The isolation forest is a baseline only.
- Fault explanations: yes (implicated band and evidence). Drift, confidence and feedback: no.
- Live sensor or microcontroller feed: no.
