"""Compact display encoding for stored envelope spectra.

Display spectra are chart-only (no evaluation result depends on them). They
are stored as 8-bit log amplitude: q = round((20*log10(a) - FLOOR_DB) / STEP_DB),
clipped to 1..255, with q = 0 meaning "no spectrum" (an invalid reading).
Round-trip error is at most STEP_DB / 2 = 0.3 dB (about 3.5% in amplitude); the
range -140..+13 dB covers every stored IMS envelope amplitude (about -123..-9 dB).
"""
from __future__ import annotations

import numpy as np

FLOOR_DB = -140.0
STEP_DB = 0.6
ENCODING = {"name": "uint8-log-db", "floor_db": FLOOR_DB, "step_db": STEP_DB, "zero_means": "no spectrum"}


def encode(amp: np.ndarray) -> np.ndarray:
    a = np.asarray(amp, dtype=np.float32)
    out = np.zeros(a.shape, dtype=np.uint8)
    pos = a > 0
    db = 20.0 * np.log10(a[pos])
    out[pos] = np.clip(np.round((db - FLOOR_DB) / STEP_DB), 1, 255).astype(np.uint8)
    return out


def decode(q: np.ndarray) -> np.ndarray:
    q = np.asarray(q)
    if q.dtype != np.uint8:
        return q.astype(np.float32)  # legacy float16 store
    amp = 10.0 ** ((q.astype(np.float32) * STEP_DB + FLOOR_DB) / 20.0)
    amp[q == 0] = 0.0
    return amp
