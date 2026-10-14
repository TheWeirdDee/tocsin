"""POST-HOC diagnostic, NOT held-out evidence.

Question: did TOCSIN miss Test 2 bearing 1 because the observed outer-race
tone (~231 Hz) falls outside the frozen +/-2% window around the computed
236.4 Hz? Re-run the identical pipeline with a +/-4% window. The threshold is
re-selected on Test 1 with the pre-registered rule; nothing else changes.
Because this variant was designed after the held-out results were seen, its
held-out numbers are reported only as a diagnosis.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from scripts.tune import GRID, K, MAX_HEALTHY_ALERT_FRACTION, N_REF  # noqa: E402
from tocsin.metrics import summarize  # noqa: E402
from tocsin.pipeline import evaluate_run, load_run  # noqa: E402


def main():
    with open(os.path.join(ROOT, "config", "frozen.json")) as fh:
        cfg = dict(json.load(fh))
    work = os.path.join(ROOT, "data", "work")
    runs = {r: load_run(r, os.path.join(work, f"features_{r}_tol4.npz")) for r in ("test1", "test2", "test3")}
    band = cfg["band"]
    theta = None
    for th in GRID:
        res = evaluate_run(runs["test1"], "tocsin", th, K, N_REF, cfg, "clean", band)
        worst = max(b["alert_fraction"] or 0.0 for b in res["per_bearing"] if not b["faulty"])
        if worst <= MAX_HEALTHY_ALERT_FRACTION:
            theta = th
            tune = res
            break
    allb, per = [], {}
    for r in ("test2", "test3"):
        res = evaluate_run(runs[r], "tocsin", theta, K, N_REF, cfg, "clean", band)
        per[r] = res["per_bearing"]
        allb += res["per_bearing"]
    out = {
        "label": "POST-HOC diagnostic: TOCSIN with a ±4% defect-band window (not held-out evidence)",
        "generated": datetime.now(timezone.utc).isoformat(),
        "band_tol": 0.04, "theta": theta, "k": K, "n_ref": N_REF,
        "tuning_test1": tune["summary"],
        "combined": summarize(allb),
        "runs": per,
        "why_not_evidence": "Designed after the v1.0 held-out results were seen; Tests 2 and 3 are no longer unseen for this variant.",
    }
    with open(os.path.join(ROOT, "results", "posthoc_tol4.json"), "w") as fh:
        json.dump(out, fh, indent=1)
    s = out["combined"]
    print(f"theta {theta}; held-out TP {s['tp']}/2 FP {s['fp']}/6 leads {s['lead_times_h']} healthy h/day {s['healthy_alert_hours_per_bearing_day']}")


if __name__ == "__main__":
    main()
