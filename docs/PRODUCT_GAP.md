# From research demonstrator to manual-upload monitoring: gap assessment

**Status:** proposal for review. Nothing in this document is implemented. It does not change any historical result, frozen configuration or claim.

## 1. What exists today

| Capability | State | Evidence |
|---|---|---|
| Replay of three recorded IMS run-to-failure tests, with precomputed decisions | Working | `/demo`, `results/heldout.json` |
| Single-reading analysis against a stored **IMS** healthy reference | Working only for IMS-compatible readings (20 kHz, 2000 RPM, 20,480 samples, ZA-2115 geometry). Other settings are rejected | `POST /api/analyze`, `tests/test_audit_regressions.py` |
| Causal state machine (baseline → watch → alert, no-data handling) | Working on the IMS data | `tocsin/state.py`, tests |
| Detection performance | **Not established.** Held-out IMS: 1 of 2 failures alerted. The simpler variant did better | Evaluation page |
| Machine setup, machine-specific reference, upload history, inspection outcomes | **Do not exist** | n/a |

The current upload form must not be relabelled as general machinery monitoring. It is a comparison against someone else's bearing.

## 2. Target workflow (manual uploads; no sensor integration)

1. **Add a machine.** Bearing identity, speed, sensor and acquisition settings.
2. **Establish its healthy reference.** Upload readings taken while the machine is known to be in good condition.
3. **Analyze subsequent readings.** Each new upload is compared with that machine's own reference, in time order.
4. **Review inspection priorities.** Across the user's machines: what changed, when, and the supporting evidence.
5. **Record inspection outcomes.** What was found, kept as history alongside the alerts.

## 3. Step-by-step: what can be built safely and what needs validation

The categories are:

- **Safe engineering:** can be built now without making a new performance claim.
- **Needs validation:** cannot be presented as reliable until it is tested on data the method was not tuned on.

### 3.1 Machine setup

| Item | Category | Notes |
|---|---|---|
| Machine record: name, location and bearing per measurement point | Safe | Plain data entry |
| Bearing geometry: rollers, pitch diameter, roller diameter, contact angle, or the manufacturer's defect-frequency orders | Safe to compute (`tocsin/bearing.py`, unit-tested) | Correctness depends on user input. The IMS miss shows that frequencies a few percent off break detection with a ±2% window |
| Shaft speed (fixed, or entered per reading) | Safe to store | Speed estimation from the signal is **not** validated. Readings without a speed must be flagged "speed assumed" |
| Acquisition: sample rate, samples per reading, sensor type and orientation | Safe to store and check | See 3.2 |

### 3.2 Compatibility checks (before any comparison)

| Check | Category | Rule |
|---|---|---|
| Sample rate covers the analysis band | Safe | Nyquist must be above the band-pass upper edge with margin. Today's frozen band is 2–8 kHz, so at least about 17.6 kHz |
| Envelope range covers the defect bands | Safe | 3rd harmonic × (1 + tolerance) + 25 Hz must be ≤ the envelope range for every family, at the machine's speed |
| Reading length and missing data | Safe | Existing validation rules |
| Reading matches the machine's reference settings (rate, length, speed within a tolerance, same sensor) | Safe | Mismatches are rejected with a structured reason. Readings are never compared across incompatible settings |
| Analysis band suits this machine's resonance | **Needs validation** | The 2–8 kHz band was chosen on IMS Test 1. Another machine may need another band. Automatic band selection (for example spectral kurtosis) is unvalidated |

### 3.3 Machine-specific healthy reference

| Item | Category | Notes |
|---|---|---|
| Reference built from the first N valid uploads the user marks as healthy (N = 72 in the frozen config) | Safe to compute | It mirrors the frozen method exactly |
| Progress, coverage and quality of the reference shown to the user | Safe | The reference does not exist until N valid readings are in. The TC-03 rules apply |
| Checking that the reference period really was healthy | **Needs validation** | There is no method today. Show a clear attestation and warning instead |
| Re-baselining after maintenance | Safe as an explicit user action; **needs validation** as an automatic action | |
| Thresholds (θ = 3.5, k = 3) applied to a new machine | **Needs validation** | Tuned on one IMS test. Results must carry an "unvalidated for this machine" label |

### 3.4 Sequential uploads and history

| Item | Category | Notes |
|---|---|---|
| Per-machine, time-ordered reading history with timestamps from the user or the file | Safe | Sort by timestamp (the Test 3 ordering lesson). Reject duplicates. Out-of-order uploads re-run the causal state from that point |
| State machine continued across uploads, including no-verdict readings | Safe | Existing `tocsin/state.py` |
| Persistent storage | Safe | Needs a database and per-user ownership. Today the service is stateless |
| Authentication and data privacy | Safe, but required before storing anyone's machine data | Not present today |

### 3.5 Priorities, evidence, outcomes

| Item | Category | Notes |
|---|---|---|
| Cross-machine inspection list with evidence cards | Safe | Reuses the replay's evidence logic |
| Inspection outcome per alert (found / not found / notes) | Safe to record | |
| Using outcomes to change thresholds | **Needs validation** | Must not happen automatically. Treat as a future evaluation dataset |
| Any claim of detection rate or lead time on customer machines | **Needs validation** | Requires a pre-registered evaluation on non-IMS data |

## 4. Validation work that would justify more than "experimental"

1. A pre-registered evaluation on at least one more run-to-failure dataset (for example XJTU-SY or FEMTO/PRONOSTIA). These include speed and load variation, and the method would not have been tuned on them.
2. Frequency-accuracy handling: measured speed, slip tolerance or order tracking, evaluated rather than chosen after seeing results. The ±4% post-hoc result is a hypothesis to test there, not a fix.
3. A decision informed by the A1 result. A simpler envelope-level detector beat the defect-band detector on IMS. Both should be evaluated before choosing a production default.

## 5. Proposed acceptance criteria for a first manual-upload version (v2, "experimental")

1. A user can create a machine with geometry, speed and acquisition settings. Invalid or incompatible settings are rejected with a specific reason (tested per rule in 3.2).
2. Uploading a reading for a machine runs validation and the compatibility checks before any comparison. Every rejection names the rule that failed.
3. No score, reference comparison or alert is shown for a machine until its reference has N valid readings. Progress is shown (the same rules as TC-03).
4. Readings are processed in timestamp order. An out-of-order upload re-evaluates the later states. A duplicate is rejected.
5. A reading that fails validation never clears an alert and never produces a healthy verdict. Its age is shown.
6. Every alert card shows the machine, measurement point, reading timestamp, implicated band, current value, reference value, persistence, data quality and analysis version. It also carries the label "thresholds not validated for this machine".
7. Inspection outcomes can be recorded per alert and are shown in the history. They do not change thresholds.
8. Machine data is visible only to its owner. Upload size, rate and concurrency limits are enforced.
9. The IMS replay, its results and the frozen configurations remain unchanged and reachable under "Explore an example".
10. Automated tests cover each criterion above. A deployed end-to-end run covers add machine → build reference → alert → record outcome.

## 6. Explicit non-goals for that version

- No sensor or historian integration, and no live streaming.
- No remaining-useful-life or time-to-failure estimate.
- No automatic threshold learning from outcomes.
- No claim of detection performance beyond the published IMS results.

## 7. Decisions needed from the owner

1. Whether to build v2 at all within the event, or present this assessment as the roadmap.
2. Hosting for persistent data (a database on Railway adds cost) and the authentication approach.
3. Which validation dataset to pursue first, and whether the A1 (envelope-level) detector should become the default candidate.
