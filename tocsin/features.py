"""Per-snapshot diagnostic features for one vibration channel.

Raw features only: no reference comparison, no thresholds. The detector
(`detectors.py`) turns these into scores against a per-bearing reference.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import numpy as np
from scipy import signal

from .bearing import FAULT_FAMILIES

EPS = 1e-12


@dataclass(frozen=True)
class FeatureParams:
    band: tuple[float, float] = (1000.0, 9000.0)
    filter_order: int = 4
    harmonics: int = 3
    band_tol: float = 0.02  # +/- fraction around each harmonic
    background_halfwidth_hz: float = 25.0
    env_max_hz: float = 1000.0  # envelope spectrum range kept for display/analysis

    def key(self) -> str:
        return f"{int(self.band[0])}-{int(self.band[1])}"


@lru_cache(maxsize=32)
def _bandpass_sos(fs: float, lo: float, hi: float, order: int):
    nyq = fs / 2.0
    return signal.butter(order, [lo / nyq, min(hi / nyq, 0.999)], btype="bandpass", output="sos")


@lru_cache(maxsize=8)
def _hann(n: int) -> np.ndarray:
    return signal.windows.hann(n, sym=False)


def time_features(x: np.ndarray) -> dict[str, float]:
    x = np.asarray(x, dtype=np.float64)
    xc = x - x.mean()
    std = float(xc.std())
    rms = float(np.sqrt(np.mean(x * x)))
    peak = float(np.max(np.abs(xc)))
    m2 = float(np.mean(xc**2)) + EPS
    return {
        "rms": rms,
        "rms_db": 20.0 * np.log10(rms + EPS),
        "std": std,
        "peak": peak,
        "p2p": float(x.max() - x.min()),
        "crest": peak / (std + EPS),
        "kurtosis": float(np.mean(xc**4) / m2**2),
        "skewness": float(np.mean(xc**3) / m2**1.5),
    }


def envelope_spectrum(x: np.ndarray, fs: float, params: FeatureParams) -> tuple[np.ndarray, np.ndarray, float]:
    """Band-pass -> Hilbert envelope -> Hann-windowed amplitude spectrum.

    Returns (freqs, amplitude, envelope_rms_db) truncated to env_max_hz.
    """
    x = np.asarray(x, dtype=np.float64)
    x = x - x.mean()
    sos = _bandpass_sos(float(fs), params.band[0], params.band[1], params.filter_order)
    y = signal.sosfiltfilt(sos, x)
    env = np.abs(signal.hilbert(y))
    env = env - env.mean()
    env_rms_db = 20.0 * np.log10(float(np.sqrt(np.mean(env * env))) + EPS)
    n = env.size
    w = _hann(n)
    spec = np.abs(np.fft.rfft(env * w)) * (2.0 / w.sum())
    freqs = np.fft.rfftfreq(n, d=1.0 / fs)
    keep = freqs <= params.env_max_hz
    return freqs[keep], spec[keep], env_rms_db


def band_prominence(freqs: np.ndarray, spec: np.ndarray, center: float, params: FeatureParams) -> tuple[float, float, float, float]:
    """Peak-to-local-background ratio (dB) around one defect harmonic.

    Returns (prominence_db, peak_amplitude, peak_freq, background_amplitude).
    """
    lo, hi = center * (1 - params.band_tol), center * (1 + params.band_tol)
    in_band = (freqs >= lo) & (freqs <= hi)
    bg_mask = (freqs >= center - params.background_halfwidth_hz) & (freqs <= center + params.background_halfwidth_hz) & ~in_band
    if not in_band.any() or bg_mask.sum() < 5:
        return float("nan"), float("nan"), float("nan"), float("nan")
    band_vals = spec[in_band]
    i = int(np.argmax(band_vals))
    peak = float(band_vals[i])
    peak_f = float(freqs[in_band][i])
    bg = float(np.median(spec[bg_mask]))
    return 20.0 * np.log10((peak + EPS) / (bg + EPS)), peak, peak_f, bg


def defect_features(freqs: np.ndarray, spec: np.ndarray, defect_hz: dict[str, float], params: FeatureParams) -> dict[str, float]:
    out: dict[str, float] = {}
    for fam in FAULT_FAMILIES:
        proms = []
        for h in range(1, params.harmonics + 1):
            p, peak, pf, bg = band_prominence(freqs, spec, h * defect_hz[fam], params)
            proms.append(p)
            if h == 1:
                out[f"{fam}_h1_peak"] = peak
                out[f"{fam}_h1_freq"] = pf
                out[f"{fam}_h1_bg"] = bg
        out[f"{fam}_prom_db"] = float(np.nanmean(proms)) if np.isfinite(proms).any() else float("nan")
        for h, p in enumerate(proms, start=1):
            out[f"{fam}_h{h}_prom_db"] = p
    return out


def snapshot_features(x: np.ndarray, fs: float, defect_hz: dict[str, float], params: FeatureParams, keep_spectrum: bool = False) -> dict:
    """All features for one validated channel snapshot."""
    feats = time_features(x)
    freqs, spec, env_db = envelope_spectrum(x, fs, params)
    feats["env_rms_db"] = env_db
    feats.update(defect_features(freqs, spec, defect_hz, params))
    if keep_spectrum:
        feats["_freqs"] = freqs
        feats["_spec"] = spec
    return feats


def display_spectrum(freqs: np.ndarray, spec: np.ndarray, pool: int = 2) -> tuple[np.ndarray, np.ndarray]:
    """Max-pool adjacent bins for display so narrow peaks survive downsampling."""
    m = (spec.size // pool) * pool
    s = spec[:m].reshape(-1, pool).max(axis=1)
    f = freqs[:m].reshape(-1, pool).mean(axis=1)
    return f, s
