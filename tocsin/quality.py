"""Bearing-relative data-quality rules that need history (added in v1.1).

A reading whose RMS is a small fraction of the same bearing's normal level is
not evidence about the bearing: the machine has stopped or the sensor has
come loose. Such a reading gets no verdict (DATA_INSUFFICIENT), like any other
invalid reading. The rule is causal: "normal" is the median RMS of the
bearing's first n_ref accepted readings, or of the accepted readings so far
while that window is still filling.
"""
from __future__ import annotations

import numpy as np

LOW_SIGNAL_REASON = "signal level is {pct:.0f}% of this bearing's normal level (machine stopped or sensor disconnected)"


def low_signal_mask(rms: np.ndarray, valid: np.ndarray, n_ref: int, frac: float, min_history: int = 5) -> tuple[np.ndarray, np.ndarray]:
    """Return (flagged mask, level ratio) for readings far below the bearing's normal RMS."""
    n = rms.size
    flagged = np.zeros(n, dtype=bool)
    ratio = np.full(n, np.nan)
    hist: list[float] = []
    for t in range(n):
        if not valid[t] or not np.isfinite(rms[t]):
            continue
        ref = None
        if len(hist) >= n_ref:
            ref = float(np.median(hist[:n_ref]))
        elif len(hist) >= min_history:
            ref = float(np.median(hist))
        if ref and ref > 0:
            ratio[t] = rms[t] / ref
            if rms[t] < frac * ref:
                flagged[t] = True
                continue
        hist.append(float(rms[t]))
    return flagged, ratio
