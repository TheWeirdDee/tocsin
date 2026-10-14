"""Feature tables -> scores -> states -> metrics, shared by tuning, evaluation and artifacts."""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime

import numpy as np

from .detectors import compute_score
from .metrics import bearing_metrics, summarize
from .quality import LOW_SIGNAL_REASON, low_signal_mask
from .runs import BEARINGS, RUNS
from .state import run_states

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, "data", "work")


@dataclass
class RunFeatures:
    run: str
    names: list[str]
    times: list[datetime]
    sha256: list[str]
    raw: dict

    def valid(self, cond: str, b: int) -> np.ndarray:
        return self.raw[f"valid/{cond}/{b}"].astype(bool)

    def feats(self, cond: str, band: str, b: int) -> dict[str, np.ndarray]:
        prefix = f"feat/{cond}/{band}/{b}/"
        return {k[len(prefix):]: self.raw[k] for k in self.raw if k.startswith(prefix)}

    def quality(self, cond: str, b: int) -> dict[str, np.ndarray]:
        return {
            "missing": self.raw[f"missing/{cond}/{b}"],
            "interp": self.raw[f"interp/{cond}/{b}"],
            "reason": self.raw[f"reason/{cond}/{b}"],
        }

    def conditions(self) -> list[str]:
        return sorted({k.split("/")[1] for k in self.raw if k.startswith("valid/")})


def load_run(run: str, path: str | None = None) -> RunFeatures:
    path = path or os.path.join(WORK, f"features_{run}.npz")
    with np.load(path, allow_pickle=False) as d:
        raw = {k: d[k] for k in d.files}
    times = [datetime.fromisoformat(t) for t in raw.pop("times")]
    return RunFeatures(run, list(raw.pop("names")), times, list(raw.pop("sha256")), raw)


def effective_validity(rf: "RunFeatures", cond: str, b: int, band: str, n_ref: int, cfg: dict) -> tuple[np.ndarray, list[str]]:
    """Validity after all data-quality rules, with a reason string per reading."""
    valid = rf.valid(cond, b).copy()
    reasons = [str(r) for r in rf.quality(cond, b)["reason"]]
    frac = cfg.get("low_signal_fraction")
    if frac:
        rms = rf.feats(cond, band, b)["rms"]
        flagged, ratio = low_signal_mask(rms, valid, n_ref, frac)
        for t in np.flatnonzero(flagged):
            reasons[t] = LOW_SIGNAL_REASON.format(pct=100 * ratio[t])
        valid &= ~flagged
    return valid, reasons


def evaluate_bearing(rf: RunFeatures, b: int, detector: str, theta: float, k: int, n_ref: int, cfg: dict,
                     cond: str = "clean", band: str | None = None) -> tuple[dict, dict]:
    band = band or cfg["band"]
    valid, reasons = effective_validity(rf, cond, b, band, n_ref, cfg)
    feats = rf.feats(cond, band, b)
    sr = compute_score(detector, feats, valid, n_ref, cfg)
    k_eff = 1 if detector == "a3_no_persistence" else k
    tr = run_states(sr.score, valid, theta, k_eff, n_ref)
    faulty = b in RUNS[rf.run]["faulty"]
    m = bearing_metrics(rf.times, valid, tr.effective, faulty, n_ref)
    m["bearing"] = b
    return m, {"score": sr, "trace": tr, "valid": valid, "feats": feats, "reasons": reasons}


def evaluate_run(rf: RunFeatures, detector: str, theta: float, k: int, n_ref: int, cfg: dict,
                 cond: str = "clean", band: str | None = None) -> dict:
    per = [evaluate_bearing(rf, b, detector, theta, k, n_ref, cfg, cond, band)[0] for b in BEARINGS]
    return {"per_bearing": per, "summary": summarize(per)}
