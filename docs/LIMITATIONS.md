# Known limitations

## Evidence

- **Two held-out failure events**, both outer-race (Test 2 B1, Test 3 B3), plus six undamaged bearings. The results show behaviour on unseen runs, not a reliable detection rate. No percentage is meaningful at this sample size.
- **The pre-registered hypothesis failed.** TOCSIN did not alert earlier than the RMS alarm, and did not alert on fewer undamaged bearings than the isolation forest. TOCSIN missed Test 2 B1 in v1.1. The "earlier and quieter" claim is withdrawn everywhere.
- **The ablation favoured a simpler signal.** The broadband envelope level without defect bands (A1) alerted on 2 of 2 failures with the lowest undamaged-bearing alert time. As configured, the defect-band step did not add value on these runs.
- **The v1.1 numbers are not clean held-out evidence.** Two ingestion defects (reading order, machine-stopped readings) were found and fixed *after* the v1.0 held-out results were seen. Neither fix changes a threshold, and neither affects any Test 1 reading. v1.0 results are preserved unchanged in `results/v1.0_preregistered/`.
- **The ±4% window variant is post-hoc.** It catches both failures, but it was designed after the held-out results were seen and alerts more on undamaged bearings. It is a diagnosis, not a validated improvement.

## Labels and endpoint

- The IMS readme says only which bearing had a defect at the end of each test. Onset is unlabelled, so "lead time" is measured to the last recorded reading, not to a physical failure.
- The Test 3 archive contains 6,324 files ending 18 Apr 2004. The readme says 4,448 files ending 4 Apr. The first 4,448 archive files match the readme exactly. The protocol fixed the endpoint as the last archived file.
- The last readings of Tests 2 and 3 are flat on every channel (the rig had stopped). Since v1.1 they get no verdict. The endpoint remains the last recorded reading.

## Physics and operating conditions

- One rig, one bearing type, constant nominal speed (2000 RPM) and load (6000 lb). Changing speed or load was **not** tested. The "changed operating conditions" complication is not demonstrated.
- Shaft speed is assumed, not measured. The observed outer-race tone (~231 Hz) sits about 2.3% below the frequency computed at nominal speed. This is consistent with a lower actual speed or with geometry differing from the published values.
- Bearing geometry comes from the literature, not from the IMS readme.
- Fault-family naming is not validated for inner-race or rolling-element faults on held-out data.

## Complications

- Noise and missing data are injected into real recordings with fixed seeds. Real sensor faults can look different.
- Under injected noise, TOCSIN's very late Test 2 B1 alerts come from the machine-stopped final readings. The added noise hides the flat signal from the low-signal rule.

## Shared-shaft coupling

- All four bearings share one shaft and frame. Near the end of each run, vibration from the failing bearing reaches its neighbours. Every detector alerts on some undamaged bearings in the final day. These alerts are counted as false (the strict metric) and also reported separately.

## Product scope

- The replay serves precomputed analyses, produced by the same pipeline for each listed condition. Live computation is demonstrated for single uploaded readings. Persistence needs a stream, which the demo does not ingest live.
- Analysis of uploaded readings is fixed to the IMS bearing geometry.
- No remaining-useful-life estimate, no fault-size estimate, no hardware integration.
- Latency and memory were measured on a developer laptop (including a single-core pinned run) and as server-side timings on the deployed Railway service. The 0.5 CPU / 256 MB container test ran on a GitHub Actions runner (83 ms median analysis, peak 110 MB, no OOM). That runner's CPU is not the target hardware; the test shows the service fits the limits, not how fast a specific edge device would be.
- Only a dark theme is provided.
- Automated responsive and keyboard tests passed. That is not an accessibility certification.

## Fault-condition naming

- On the held-out data, the single alerted failure (Test 3 B3) was named correctly (outer race, 5 of 5 alert onsets). That is one event.
- On the tuning set, the roller-element failure (Test 1 B4) was named as the outer race. Fault naming is a hint, not a diagnosis.

## Detector choice

- The submitted detector scored below both baselines on held-out detection.
- A simpler variant did better, but was not adopted after seeing the results (see `docs/DECISIONS.md`). Its advantage is unvalidated.
