"""Derived, label-appropriate metrics from existing results. No re-tuning, no new runs.

  python scripts/derived_metrics.py   -> results/derived_metrics.json

1. Bearing-level precision / recall / F1 (counts kept alongside), for v1.0
   (pre-registered) and v1.1 (data-handling corrections), every detector.
   Unit = one bearing in one held-out test; positive = the readme says it was
   damaged at the end of the test; predicted positive = any ALERT.
2. The same, counting only alerts that *began before* each run's final 24 h
   (sub-analysis named in docs/EVALUATION_PROTOCOL.md section 8).
3. Fault-condition identification: for TOCSIN alerts on damaged bearings, does
   the implicated defect family match the readme label? Read from the v1.1
   replay artifacts (alert onset evidence). Tuning-set (Test 1) rows are
   reported separately and are not held-out evidence.
"""
from __future__ import annotations

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tocsin.runs import RUNS  # noqa: E402

DETS = ["tocsin", "b0_rms", "b1_iforest", "b0_rms_3sigma", "a1_broadband_env", "a2_global_ref", "a3_no_persistence"]
LABEL_FAMILY = {"outer-race failure": "BPFO", "inner-race defect": "BPFI", "roller-element defect": "2xBSF"}


def prf(tp, fp, fn):
    p = tp / (tp + fp) if (tp + fp) else None
    r = tp / (tp + fn) if (tp + fn) else None
    f1 = 2 * p * r / (p + r) if p and r else (0.0 if p is not None and r is not None else None)
    return {"tp": tp, "fp": fp, "fn": fn, "precision": p, "recall": r, "f1": f1,
            "precision_frac": f"{tp}/{tp + fp}" if (tp + fp) else "0/0", "recall_frac": f"{tp}/{tp + fn}"}


def bearing_table(heldout: dict, det: str, early_only: bool) -> dict:
    runs = heldout["detectors"][det]["runs"]
    tp = fp = fn = 0
    for run in ("test2", "test3"):
        for b in runs[run]["per_bearing"]:
            alerted = (b["alert_episodes_before_last24h"] > 0) if early_only else b["alerted"]
            if b["faulty"]:
                tp += alerted
                fn += not alerted
            else:
                fp += alerted
    return prf(tp, fp, fn)


def family_identification() -> list[dict]:
    rows = []
    for run in ("test2", "test3", "test1"):
        path = os.path.join(ROOT, "artifacts", "replay", run, "clean.json")
        if not os.path.exists(path):
            continue
        with open(path) as fh:
            rep = json.load(fh)
        for b, label in RUNS[run]["faulty"].items():
            evs = rep["bearings"][str(b)]["alert_events"]
            fams = [e.get("family") for e in evs]
            expected = LABEL_FAMILY.get(label)
            rows.append({
                "run": run, "role": RUNS[run]["role"], "bearing": b, "label": label, "expected_family": expected,
                "alert_onsets": len(evs),
                "families_at_onsets": fams,
                "first_onset_family": fams[0] if fams else None,
                "first_onset_matches": (fams[0] == expected) if fams else None,
                "onsets_matching": sum(f == expected for f in fams),
            })
    return rows


def main():
    out = {"definition": __doc__.strip(), "versions": {}}
    sources = {"v1.0_preregistered": os.path.join(ROOT, "results", "v1.0_preregistered", "heldout.json"),
               "v1.1_current": os.path.join(ROOT, "results", "heldout.json")}
    for name, path in sources.items():
        with open(path) as fh:
            h = json.load(fh)
        out["versions"][name] = {d: {"all_alerts": bearing_table(h, d, False), "alerts_starting_before_final_24h": bearing_table(h, d, True)}
                                 for d in DETS if d in h["detectors"]}
    out["fault_family_identification_v1_1"] = family_identification()
    with open(os.path.join(ROOT, "results", "derived_metrics.json"), "w") as fh:
        json.dump(out, fh, indent=1)
    for name, v in out["versions"].items():
        for d in ("tocsin", "b0_rms", "b1_iforest", "a1_broadband_env"):
            a, e = v[d]["all_alerts"], v[d]["alerts_starting_before_final_24h"]
            f1 = lambda x: "—" if x["f1"] is None else f"{x['f1']:.2f}"
            print(f"{name:20s} {d:18s} all: P {a['precision_frac']} R {a['recall_frac']} F1 {f1(a)} | early: P {e['precision_frac']} R {e['recall_frac']} F1 {f1(e)}")
    for r in out["fault_family_identification_v1_1"]:
        print(r)


if __name__ == "__main__":
    main()
