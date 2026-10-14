"""Seeded, reproducible signal complications for robustness testing.

These are clearly labelled stress conditions applied to *real* recordings.
They are never presented as recorded data.
"""
from __future__ import annotations

import hashlib

import numpy as np

CONDITIONS = {
    "clean": "As recorded",
    "noise20": "Added sensor noise, 20 dB SNR",
    "noise10": "Added sensor noise, 10 dB SNR",
    "noise0": "Added sensor noise, 0 dB SNR",
    "drop5": "5% of samples missing at random",
    "drop20": "20% of samples missing at random",
    "gaps": "15% of readings lose a 40% contiguous block",
    "loss30": "30% of readings never arrive",
}

NOISE_SNR = {"noise20": 20.0, "noise10": 10.0, "noise0": 0.0}
DROP_FRAC = {"drop5": 0.05, "drop20": 0.20}


def seed_for(*parts) -> int:
    h = hashlib.sha256("|".join(str(p) for p in parts).encode()).digest()
    return int.from_bytes(h[:8], "little")


def apply(condition: str, x: np.ndarray, run: str, bearing: int, idx: int, ref_rms: float | None) -> np.ndarray | None:
    """Return the modified snapshot, or None if the reading never arrives."""
    if condition == "clean":
        return x
    rng = np.random.default_rng([seed_for(run, bearing, condition), idx])
    if condition in NOISE_SNR:
        if ref_rms is None:
            raise ValueError("noise conditions need the reference RMS")
        sigma = ref_rms / (10.0 ** (NOISE_SNR[condition] / 20.0))
        return x + rng.normal(0.0, sigma, size=x.shape)
    if condition in DROP_FRAC:
        y = x.astype(np.float64, copy=True)
        k = int(round(DROP_FRAC[condition] * y.size))
        y[rng.choice(y.size, size=k, replace=False)] = np.nan
        return y
    if condition == "gaps":
        if rng.random() < 0.15:
            y = x.astype(np.float64, copy=True)
            L = int(0.40 * y.size)
            s = int(rng.integers(0, y.size - L))
            y[s:s + L] = np.nan
            return y
        return x
    if condition == "loss30":
        return None if rng.random() < 0.30 else x
    raise KeyError(condition)
