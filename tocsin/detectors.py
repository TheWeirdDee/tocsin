"""Scores against a per-bearing healthy reference.

Every detector receives the same information: the bearing's own first N valid
snapshots as a reference window. Scores at index t depend only on the
reference window and snapshot t, so they are causal by construction (the
reference window always precedes t; during the window the state is
BASELINING and no score is acted upon).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from sklearn.ensemble import IsolationForest

from .bearing import FAULT_FAMILIES

MAD_SCALE = 1.4826
FAMILIES = list(FAULT_FAMILIES)
IF_FEATURES = ["rms", "std", "peak", "p2p", "crest", "kurtosis", "skewness"]


def reference_indices(valid: np.ndarray, n_ref: int) -> np.ndarray:
    """Indices of the first n_ref valid snapshots (the calibration window)."""
    idx = np.flatnonzero(valid)
    return idx[:n_ref]


def robust_stats(values: np.ndarray, floor: float) -> tuple[float, float]:
    v = values[np.isfinite(values)]
    if v.size == 0:
        return float("nan"), float(floor)
    med = float(np.median(v))
    mad = float(np.median(np.abs(v - med))) * MAD_SCALE
    return med, max(mad, floor)


@dataclass
class ScoreResult:
    score: np.ndarray  # NaN where not scored (invalid snapshot or no reference)
    reference: dict = field(default_factory=dict)
    family_z: dict[str, np.ndarray] | None = None
    implicated: np.ndarray | None = None  # index into FAMILIES, -1 if n/a


def score_tocsin(feats: dict[str, np.ndarray], valid: np.ndarray, n_ref: int, floor_db: float = 0.5,
                 global_ref: dict | None = None) -> ScoreResult:
    """max over fault families of robust-z of defect-band prominence.

    If global_ref is given (ablation A2), its frozen medians/sigmas replace the
    per-bearing reference.
    """
    ref_idx = reference_indices(valid, n_ref)
    n = valid.size
    zs = {}
    ref = {}
    for fam in FAMILIES:
        x = feats[f"{fam}_prom_db"]
        if global_ref is not None:
            med, sig = global_ref[fam]["median"], global_ref[fam]["sigma"]
        else:
            med, sig = robust_stats(x[ref_idx], floor_db)
        ref[fam] = {"median": med, "sigma": sig}
        z = (x - med) / sig
        z = np.where(valid, z, np.nan)
        zs[fam] = z
    stack = np.vstack([zs[f] for f in FAMILIES])
    all_nan = np.all(~np.isfinite(stack), axis=0)
    filled = np.where(np.isfinite(stack), stack, -np.inf)
    implicated = np.where(all_nan, -1, np.argmax(filled, axis=0))
    score = np.where(all_nan, np.nan, np.max(filled, axis=0))
    if len(ref_idx) < n_ref and global_ref is None:
        score = np.full(n, np.nan)
    return ScoreResult(score=score, reference=ref, family_z=zs, implicated=implicated)


def score_scalar(x: np.ndarray, valid: np.ndarray, n_ref: int, floor: float) -> ScoreResult:
    """Robust z of one scalar feature vs. own reference (RMS baseline, ablation A1)."""
    ref_idx = reference_indices(valid, n_ref)
    med, sig = robust_stats(x[ref_idx], floor)
    score = np.where(valid, (x - med) / sig, np.nan)
    if len(ref_idx) < n_ref:
        score = np.full(valid.size, np.nan)
    return ScoreResult(score=score, reference={"median": med, "sigma": sig})


def score_rms_3sigma(x: np.ndarray, valid: np.ndarray, n_ref: int) -> ScoreResult:
    """Conventional alarm: (x - mean)/std of reference; alert threshold fixed at 3."""
    ref_idx = reference_indices(valid, n_ref)
    v = x[ref_idx]
    mu, sd = float(np.mean(v)), float(np.std(v, ddof=1)) if v.size > 1 else 1.0
    sd = max(sd, 1e-9)
    score = np.where(valid, (x - mu) / sd, np.nan)
    if len(ref_idx) < n_ref:
        score = np.full(valid.size, np.nan)
    return ScoreResult(score=score, reference={"mean": mu, "std": sd})


def score_iforest(feats: dict[str, np.ndarray], valid: np.ndarray, n_ref: int, floor: float = 0.05, seed: int = 0) -> ScoreResult:
    """Isolation forest on time-domain stats, fit on the reference window only."""
    ref_idx = reference_indices(valid, n_ref)
    n = valid.size
    if len(ref_idx) < n_ref:
        return ScoreResult(score=np.full(n, np.nan))
    X = np.column_stack([feats[k] for k in IF_FEATURES])
    Xr = X[ref_idx]
    mu = Xr.mean(axis=0)
    sd = Xr.std(axis=0)
    sd[sd < 1e-12] = 1.0
    Z = (X - mu) / sd
    Z = np.where(np.isfinite(Z), Z, 0.0)
    model = IsolationForest(n_estimators=200, random_state=seed)
    model.fit(Z[ref_idx])
    raw = -model.score_samples(Z)
    med, sig = robust_stats(raw[ref_idx], floor)
    score = np.where(valid, (raw - med) / sig, np.nan)
    return ScoreResult(score=score, reference={"median": med, "sigma": sig})


def compute_score(detector: str, feats: dict[str, np.ndarray], valid: np.ndarray, n_ref: int, cfg: dict) -> ScoreResult:
    """Dispatch by detector id. cfg carries frozen floors and A2's global reference."""
    if detector in ("tocsin", "a3_no_persistence"):
        return score_tocsin(feats, valid, n_ref, cfg.get("floor_db", 0.5))
    if detector == "a2_global_ref":
        return score_tocsin(feats, valid, n_ref, cfg.get("floor_db", 0.5), global_ref=cfg["global_ref"])
    if detector == "a1_broadband_env":
        return score_scalar(feats["env_rms_db"], valid, n_ref, cfg.get("floor_db", 0.5))
    if detector == "b0_rms":
        return score_scalar(feats["rms_db"], valid, n_ref, cfg.get("floor_db", 0.5))
    if detector == "b0_rms_3sigma":
        return score_rms_3sigma(feats["rms"], valid, n_ref)
    if detector == "b1_iforest":
        return score_iforest(feats, valid, n_ref, cfg.get("iforest_floor", 0.05), cfg.get("seed", 0))
    raise KeyError(detector)


DETECTOR_LABELS = {
    "tocsin": "TOCSIN (defect-band envelope)",
    "b0_rms": "RMS level alarm (tuned)",
    "b0_rms_3sigma": "RMS mean + 3σ alarm (untuned)",
    "b1_iforest": "Isolation forest (time-domain stats)",
    "a1_broadband_env": "A1: no defect bands (broadband envelope)",
    "a2_global_ref": "A2: global reference, not per-bearing",
    "a3_no_persistence": "A3: no persistence (k = 1)",
}
