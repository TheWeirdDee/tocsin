"""Held-out evaluation with the frozen configuration (no tuning happens here).

Writes results/heldout.json, results/robustness.json, results/sensitivity.json.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tocsin.complications import CONDITIONS  # noqa: E402
from tocsin.detectors import DETECTOR_LABELS  # noqa: E402
from tocsin.metrics import summarize  # noqa: E402
from tocsin.pipeline import evaluate_run, load_run  # noqa: E402
from tocsin.runs import RUNS  # noqa: E402

HELDOUT = ["test2", "test3"]
MAIN = ["tocsin", "b0_rms", "b1_iforest", "b0_rms_3sigma"]
ABLATIONS = ["a1_broadband_env", "a2_global_ref", "a3_no_persistence"]


def load_frozen():
    with open(os.path.join(ROOT, "config", "frozen.json")) as fh:
        return json.load(fh)


def check_provenance(run, cfg):
    with open(os.path.join(ROOT, "data", "work", f"features_{run}.meta.json")) as fh:
        meta = json.load(fh)
    allowed = {cfg["sha256"], cfg.get("extraction_sha")}
    if RUNS[run]["role"] == "held-out" and meta.get("config_sha") not in allowed:
        raise SystemExit(f"{run} features were not produced under the frozen config ({meta.get('config_sha')} != {cfg['sha256']})")
    return meta


def tag(per, run):
    for b in per:
        b["run"] = run
    return per


def main():
    cfg = load_frozen()
    runs = {r: load_run(r) for r in HELDOUT}
    metas = {r: check_provenance(r, cfg) for r in HELDOUT}
    tuning = load_run("test1")
    k, n_ref = cfg["k"], cfg["n_ref"]
    stamp = datetime.now(timezone.utc).isoformat()

    def run_det(rf, det, cond="clean", k_=k, n_=n_ref):
        return evaluate_run(rf, det, cfg["thetas"][det], k_, n_, cfg, cond, cfg["band"])

    # 1. Main held-out comparison (clean)
    heldout = {"generated": stamp, "config_sha": cfg["sha256"], "endpoint": "last recorded snapshot of each run",
               "counts": {"failure_events": 2, "undamaged_bearings": 6}, "detectors": {}}
    for det in MAIN + ABLATIONS:
        per_run = {}
        allb = []
        for r, rf in runs.items():
            res = run_det(rf, det)
            per_run[r] = {"per_bearing": tag(res["per_bearing"], r), "summary": res["summary"]}
            allb += res["per_bearing"]
        tune = run_det(tuning, det)
        heldout["detectors"][det] = {"label": DETECTOR_LABELS[det], "theta": cfg["thetas"][det],
                                     "k": 1 if det == "a3_no_persistence" else k,
                                     "combined": summarize(allb), "runs": per_run,
                                     "tuning_test1": {"per_bearing": tag(tune["per_bearing"], "test1"), "summary": tune["summary"]}}
        s = heldout["detectors"][det]["combined"]
        print(f"{det:20s} TP {s['tp']}/2 FP {s['fp']}/6 leads {s['lead_times_h']} healthy_h/day {s['healthy_alert_hours_per_bearing_day']}", flush=True)
    with open(os.path.join(ROOT, "results", "heldout.json"), "w") as fh:
        json.dump(heldout, fh, indent=1)

    # 2. Robustness grid
    conds = [c for c in CONDITIONS if all(c in rf.conditions() for rf in runs.values())]
    rob = {"generated": stamp, "config_sha": cfg["sha256"], "conditions": {c: CONDITIONS[c] for c in conds}, "grid": {}}
    for c in conds:
        rob["grid"][c] = {}
        for det in MAIN:
            allb = []
            per = {}
            for r, rf in runs.items():
                res = run_det(rf, det, c)
                per[r] = tag(res["per_bearing"], r)
                allb += per[r]
            valid_frac = {r: round(float(sum(rf.valid(c, b).mean() for b in RUNS[r]["channels"]) / 4), 4) for r, rf in runs.items()}
            rob["grid"][c][det] = {"combined": summarize(allb), "per_bearing": per, "valid_fraction": valid_frac}
        s = rob["grid"][c]["tocsin"]["combined"]
        print(f"[{c}] tocsin TP {s['tp']} FP {s['fp']} leads {s['lead_times_h']}", flush=True)
    with open(os.path.join(ROOT, "results", "robustness.json"), "w") as fh:
        json.dump(rob, fh, indent=1)

    # 3. Sensitivity (descriptive; never feeds back into the frozen config)
    sens = {"generated": stamp, "note": "Post-hoc and descriptive. The frozen configuration (N=72, k=3) was not changed.",
            "grid": []}
    for n_ in (36, 72, 144):
        for k_ in (2, 3, 5):
            row = {"n_ref": n_, "k": k_}
            for det in ("tocsin", "b0_rms", "b1_iforest"):
                allb = []
                for rf in runs.values():
                    allb += run_det(rf, det, "clean", k_, n_)["per_bearing"]
                row[det] = summarize(allb)
                row[det + "_tuning"] = run_det(tuning, det, "clean", k_, n_)["summary"]
            sens["grid"].append(row)
    with open(os.path.join(ROOT, "results", "sensitivity.json"), "w") as fh:
        json.dump(sens, fh, indent=1)
    print("done", flush=True)


if __name__ == "__main__":
    main()
