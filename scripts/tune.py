"""Select thresholds and pass band on IMS Test 1 ONLY, then freeze config/frozen.json.

Rule (docs/EVALUATION_PROTOCOL.md section 6): for each detector, the smallest
threshold on the grid for which every undamaged tuning bearing spends <= 1% of
its monitored valid readings in ALERT. TOCSIN's pass band is the candidate with
the longest mean lead time on the two damaged tuning bearings (ties -> wider).
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tocsin import __version__  # noqa: E402
from tocsin.bearing import FAULT_FAMILIES, IMS_NOMINAL_RPM, IMS_ZA2115  # noqa: E402
from tocsin.detectors import reference_indices, robust_stats  # noqa: E402
from tocsin.features import FeatureParams  # noqa: E402
from tocsin.ingest import ValidationRules  # noqa: E402
from tocsin.pipeline import evaluate_run, load_run  # noqa: E402
from tocsin.runs import RUNS  # noqa: E402

GRID = [round(2.0 + 0.5 * i, 1) for i in range(57)]  # 2.0 .. 30.0
K = 3
N_REF = 72
MAX_HEALTHY_ALERT_FRACTION = 0.01
FLOOR_DB = 0.5
BANDS = ["1000-9000", "2000-8000", "4000-9000"]


def band_width(key: str) -> float:
    lo, hi = (float(v) for v in key.split("-"))
    return hi - lo


def select_theta(rf, detector, cfg, band):
    curve = []
    chosen = None
    for th in GRID:
        res = evaluate_run(rf, detector, th, K, N_REF, cfg, "clean", band)
        healthy = [b for b in res["per_bearing"] if not b["faulty"]]
        faulty = [b for b in res["per_bearing"] if b["faulty"]]
        worst = max(b["alert_fraction"] or 0.0 for b in healthy)
        leads = [b["lead_time_h"] or 0.0 for b in faulty]
        curve.append({"theta": th, "max_healthy_alert_fraction": worst, "faulty_lead_h": leads,
                      "healthy_episodes": res["summary"]["healthy_alert_episodes"],
                      "detected": res["summary"]["tp"]})
        if chosen is None and worst <= MAX_HEALTHY_ALERT_FRACTION:
            chosen = (th, res)
    failed = chosen is None
    if failed:
        th = GRID[-1]
        chosen = (th, evaluate_run(rf, detector, th, K, N_REF, cfg, "clean", band))
    return chosen[0], chosen[1], curve, failed


def global_reference(rf, band):
    """A2: pool the reference windows of the undamaged tuning bearings."""
    healthy = [b for b in RUNS["test1"]["channels"] if b not in RUNS["test1"]["faulty"]]
    ref = {}
    for fam in FAULT_FAMILIES:
        vals = []
        for b in healthy:
            v = rf.valid("clean", b)
            idx = reference_indices(v, N_REF)
            vals.append(rf.feats("clean", band, b)[f"{fam}_prom_db"][idx])
        med, sig = robust_stats(np.concatenate(vals), FLOOR_DB)
        ref[fam] = {"median": med, "sigma": sig}
    return ref


def main():
    rf = load_run("test1")
    base_cfg = {"floor_db": FLOOR_DB, "iforest_floor": 0.05, "seed": 0}
    report = {"generated": datetime.now(timezone.utc).isoformat(), "run": "test1", "grid": [GRID[0], GRID[-1], 0.5],
              "rule": f"smallest theta with every undamaged bearing ALERT fraction <= {MAX_HEALTHY_ALERT_FRACTION}",
              "band_search": {}, "detectors": {}}

    # 1. TOCSIN band selection
    best = None
    for band in BANDS:
        cfg = dict(base_cfg, band=band)
        th, res, curve, failed = select_theta(rf, "tocsin", cfg, band)
        faulty = [b for b in res["per_bearing"] if b["faulty"]]
        mean_lead = float(np.mean([b["lead_time_h"] or 0.0 for b in faulty]))
        report["band_search"][band] = {"theta": th, "rule_failed": failed, "mean_lead_h": round(mean_lead, 2),
                                       "per_bearing": res["per_bearing"], "curve": curve}
        print(f"band {band}: theta={th} failed={failed} mean_lead={mean_lead:.1f}h "
              f"leads={[b['lead_time_h'] for b in faulty]}", flush=True)
        key = (mean_lead, band_width(band))
        if best is None or key > best[0]:
            best = (key, band, th)
    band = best[1]
    print(f"selected band {band}", flush=True)

    cfg = dict(base_cfg, band=band)
    cfg["global_ref"] = global_reference(rf, band)

    thetas = {}
    for det in ["tocsin", "b0_rms", "b1_iforest", "a1_broadband_env", "a2_global_ref"]:
        th, res, curve, failed = select_theta(rf, det, cfg, band)
        thetas[det] = th
        report["detectors"][det] = {"theta": th, "rule_failed": failed, "summary": res["summary"],
                                    "per_bearing": res["per_bearing"], "curve": curve}
        print(f"{det}: theta={th} failed={failed} leads={res['summary']['lead_times_h']} "
              f"healthy_eps={res['summary']['healthy_alert_episodes']}", flush=True)
    thetas["b0_rms_3sigma"] = 3.0
    thetas["a3_no_persistence"] = thetas["tocsin"]
    for det in ["b0_rms_3sigma", "a3_no_persistence"]:
        res = evaluate_run(rf, det, thetas[det], K, N_REF, cfg, "clean", band)
        report["detectors"][det] = {"theta": thetas[det], "rule_failed": None, "summary": res["summary"],
                                    "per_bearing": res["per_bearing"], "note": "not tuned"}

    frozen = {
        "version": __version__,
        "frozen_at": datetime.now(timezone.utc).isoformat(),
        "tuning_data": "IMS Test 1 only (first channel per bearing)",
        "band": band,
        "feature_params": FeatureParams(band=tuple(float(v) for v in band.split("-"))).__dict__,
        "n_ref": N_REF,
        "k": K,
        "floor_db": FLOOR_DB,
        "iforest_floor": 0.05,
        "seed": 0,
        "thetas": thetas,
        "global_ref": cfg["global_ref"],
        "validation": ValidationRules().__dict__,
        "bearing": IMS_ZA2115.to_dict(),
        "rpm_assumed": IMS_NOMINAL_RPM,
        "defect_hz": IMS_ZA2115.frequencies(IMS_NOMINAL_RPM),
        "selection_rule": report["rule"],
    }
    # Hash the settings only (not the timestamp) so an identical rerun gives an identical hash.
    canon = json.dumps({k: v for k, v in frozen.items() if k != "frozen_at"}, sort_keys=True, default=list).encode()
    frozen["sha256"] = hashlib.sha256(canon).hexdigest()
    os.makedirs(os.path.join(ROOT, "config"), exist_ok=True)
    with open(os.path.join(ROOT, "config", "frozen.json"), "w") as fh:
        json.dump(frozen, fh, indent=2, default=list)
    os.makedirs(os.path.join(ROOT, "results"), exist_ok=True)
    with open(os.path.join(ROOT, "results", "tuning_test1.json"), "w") as fh:
        json.dump(report, fh, indent=1, default=list)
    print(f"frozen config sha256 {frozen['sha256']}", flush=True)


if __name__ == "__main__":
    main()
