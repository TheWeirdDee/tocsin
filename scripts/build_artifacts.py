"""Build the precomputed, versioned analysis artifacts served to the UI.

Every number in artifacts/replay/*.json comes from the same pipeline functions
used in evaluation (tocsin.pipeline.evaluate_bearing) with the frozen config.
"""
from __future__ import annotations

import json
import math
import os
import sys
from datetime import datetime, timezone

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tocsin import __version__  # noqa: E402
from tocsin.bearing import FAULT_FAMILIES  # noqa: E402
from tocsin.complications import CONDITIONS  # noqa: E402
from tocsin.explain import evidence  # noqa: E402
from tocsin.pipeline import effective_validity, evaluate_bearing, load_run  # noqa: E402
from tocsin.runs import BEARINGS, RUNS  # noqa: E402
from tocsin.state import ALERT  # noqa: E402

ART = os.path.join(ROOT, "artifacts")
UI_CONDITIONS = ["clean", "noise10", "noise0", "drop20", "gaps", "loss30"]
SPECTRA_SAME_AS_CLEAN = ["gaps", "loss30"]  # these only remove readings; valid readings are unchanged
FEATURES_OUT = ["rms", "kurtosis", "crest", "env_rms_db", "BPFO_prom_db", "BPFI_prom_db", "2xBSF_prom_db",
                "BPFO_h1_freq", "BPFI_h1_freq", "2xBSF_h1_freq"]
FAMS = list(FAULT_FAMILIES)


def r(x, nd=3):
    out = []
    for v in np.asarray(x, dtype=float):
        out.append(None if not math.isfinite(v) else round(float(v), nd))
    return out


def clean_json(o):
    if isinstance(o, float):
        return None if not math.isfinite(o) else round(o, 4)
    if isinstance(o, dict):
        return {k: clean_json(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean_json(v) for v in o]
    if isinstance(o, (np.floating,)):
        return clean_json(float(o))
    if isinstance(o, (np.integer,)):
        return int(o)
    return o


def build_run_condition(rf, cond, cfg):
    k, n_ref = cfg["k"], cfg["n_ref"]
    times = [t.isoformat() for t in rf.times]
    out = {
        "run": rf.run, "label": RUNS[rf.run]["label"], "role": RUNS[rf.run]["role"],
        "condition": cond, "condition_label": CONDITIONS[cond],
        "precomputed": True, "generated": datetime.now(timezone.utc).isoformat(),
        "config_sha": cfg["sha256"], "version": __version__,
        "band": cfg["band"], "k": k, "n_ref": n_ref,
        "thresholds": {d: cfg["thetas"][d] for d in ("tocsin", "b0_rms", "b1_iforest")},
        "families": FAMS, "family_labels": FAULT_FAMILIES,
        "defect_hz": {f: round(cfg["defect_hz"][f], 2) for f in FAMS},
        "times": times, "bearings": {},
    }
    for b in BEARINGS:
        q = rf.quality(cond, b)
        valid, reasons = effective_validity(rf, cond, b, cfg["band"], n_ref, cfg)
        reasons_list = sorted(set(reasons))
        reason_idx = [reasons_list.index(x) for x in reasons]
        bd = {"faulty": b in RUNS[rf.run]["faulty"], "label": RUNS[rf.run]["faulty"].get(b),
              "valid": [int(v) for v in valid],
              "missing": r(q["missing"], 4), "interpolated": [int(v) for v in q["interp"]],
              "reasons": reasons_list, "reason": reason_idx, "detectors": {}, "metrics": {}}
        for det in ("tocsin", "b0_rms", "b1_iforest"):
            m, d = evaluate_bearing(rf, b, det, cfg["thetas"][det], k, n_ref, cfg, cond, cfg["band"])
            sr, tr = d["score"], d["trace"]
            entry = {"score": r(sr.score, 3), "state": [int(v) for v in tr.state],
                     "effective": [int(v) for v in tr.effective]}
            if det == "tocsin":
                entry["counter"] = [int(v) for v in tr.counter]
                entry["clear"] = [int(v) for v in tr.clear_counter]
                entry["family"] = [int(v) for v in sr.implicated]
                entry["z"] = {f: r(sr.family_z[f], 3) for f in FAMS}
                entry["reference"] = sr.reference
                feats = d["feats"]
                bd["features"] = {f: r(feats[f], 4) for f in FEATURES_OUT if f in feats}
                # Evidence for each ALERT onset, generated from structured data.
                events = []
                eff = tr.effective
                for t in range(len(eff)):
                    if eff[t] == ALERT and (t == 0 or eff[t - 1] != ALERT):
                        fam_i = int(sr.implicated[t])
                        fam = FAMS[fam_i] if fam_i >= 0 else None
                        ev = evidence(b, times[t], ALERT, fam_i, float(sr.score[t]), cfg["thetas"]["tocsin"],
                                      int(tr.counter[t]), k, {f: float(feats[f"{f}_prom_db"][t]) for f in FAMS},
                                      sr.reference, cfg["defect_hz"],
                                      peak_hz=float(feats[f"{fam}_h1_freq"][t]) if fam else None,
                                      config_sha=cfg["sha256"])
                        ev["index"] = t
                        events.append(clean_json(ev))
                bd["alert_events"] = events
            else:
                entry["reference"] = sr.reference
            bd["detectors"][det] = entry
            bd["metrics"][det] = m
        out["bearings"][str(b)] = bd
    return clean_json(out)


def main():
    with open(os.path.join(ROOT, "config", "frozen.json")) as fh:
        cfg = json.load(fh)
    runs_meta = []
    references = {}
    freqs = None
    for run in ("test2", "test3", "test1"):
        path = os.path.join(ROOT, "data", "work", f"features_{run}.npz")
        if not os.path.exists(path):
            print(f"skip {run}: no features")
            continue
        rf = load_run(run)
        with open(os.path.join(ROOT, "data", "work", f"features_{run}.meta.json")) as fh:
            meta = json.load(fh)
        conds = [c for c in UI_CONDITIONS if c in rf.conditions()]
        os.makedirs(os.path.join(ART, "replay", run), exist_ok=True)
        for c in conds:
            obj = build_run_condition(rf, c, cfg)
            with open(os.path.join(ART, "replay", run, f"{c}.json"), "w") as fh:
                json.dump(obj, fh, separators=(",", ":"))
            if c == "clean":
                references[run] = {}
                for b in BEARINGS:
                    v, _ = effective_validity(rf, "clean", b, cfg["band"], cfg["n_ref"], cfg)
                    ref_rms = float(np.median(rf.feats("clean", cfg["band"], b)["rms"][np.flatnonzero(v)[: cfg["n_ref"]]]))
                    references[run][str(b)] = {"label": f"{RUNS[run]['label']} · bearing {b} · first {cfg['n_ref']} readings",
                                               "tocsin": obj["bearings"][str(b)]["detectors"]["tocsin"]["reference"],
                                               "rms_median": ref_rms}
            print(f"{run}/{c} written", flush=True)
        spec_dir = os.path.join(ART, "spectra", run)
        stored = sorted(f.split("__")[0] for f in os.listdir(spec_dir) if f.endswith(f"__{cfg['band']}.npy"))
        if freqs is None and os.path.exists(os.path.join(spec_dir, "freqs.npy")):
            freqs = np.load(os.path.join(spec_dir, "freqs.npy"))
        runs_meta.append({
            "id": run, "label": RUNS[run]["label"], "role": RUNS[run]["role"], "archive": RUNS[run]["archive"],
            "n_snapshots": len(rf.times), "readme_files": RUNS[run]["readme_files"],
            "first": rf.times[0].isoformat(), "last": rf.times[-1].isoformat(),
            "faulty": {str(b): v for b, v in RUNS[run]["faulty"].items()},
            "readme": RUNS[run]["readme"], "channels": {str(b): c + 1 for b, c in RUNS[run]["channels"].items()},
            "conditions": [{"id": c, "label": CONDITIONS[c]} for c in conds],
            "spectra_conditions": stored, "spectra_same_as_clean": SPECTRA_SAME_AS_CLEAN,
            "parse_errors": len(meta.get("parse_errors", {})),
        })
    index = {
        "generated": datetime.now(timezone.utc).isoformat(), "version": __version__, "config_sha": cfg["sha256"],
        "runs": runs_meta, "references": references,
        "spectrum_freqs": {"f0": float(freqs[0]), "df": float(freqs[1] - freqs[0]), "n": int(freqs.size)} if freqs is not None else None,
        "display_note": "Displayed spectra are max-pooled to ~1.95 Hz bins; decisions use the full 0.98 Hz resolution.",
    }
    with open(os.path.join(ART, "runs.json"), "w") as fh:
        json.dump(clean_json(index), fh, indent=1)
    print("runs.json written")


if __name__ == "__main__":
    main()
