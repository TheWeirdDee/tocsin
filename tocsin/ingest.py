"""Snapshot parsing and validation.

A snapshot is one channel of a short vibration recording. Validation decides
whether a snapshot can be analysed at all; invalid snapshots become
DATA_INSUFFICIENT and never advance or clear alert state.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

import re

import numpy as np

_EMPTY_TAB_FIELD = re.compile(r"(^|\n)\t|\t\t|\t[ ]*\r?(\n|$)")

IMS_FS = 20_000.0
IMS_N = 20_480


@dataclass(frozen=True)
class ValidationRules:
    expected_fs: float = IMS_FS
    expected_n: int = IMS_N
    min_length_fraction: float = 0.90
    max_missing_fraction: float = 0.20
    max_gap_samples: int = 2048


@dataclass
class Quality:
    valid: bool
    n_samples: int
    missing_fraction: float
    longest_gap: int
    interpolated: int
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "valid": self.valid,
            "n_samples": self.n_samples,
            "missing_fraction": round(float(self.missing_fraction), 5),
            "longest_gap": int(self.longest_gap),
            "interpolated": int(self.interpolated),
            "reasons": list(self.reasons),
        }


def parse_ims_timestamp(name: str) -> datetime:
    """IMS file names are 'YYYY.MM.DD.hh.mm.ss'."""
    base = name.replace("\\", "/").rsplit("/", 1)[-1]
    return datetime.strptime(base, "%Y.%m.%d.%H.%M.%S")


def parse_ims_bytes(raw: bytes) -> np.ndarray:
    """Parse one IMS ASCII file (tab-separated columns, CRLF rows).

    Returns float64 array of shape (n_samples, n_channels). Raises ValueError
    on ragged rows or non-numeric content.
    """
    text = raw.decode("ascii", errors="strict")
    # Whitespace splitting would silently drop empty tab-separated cells and shift
    # values; files with empty fields must go through the delimiter-aware parser.
    if _EMPTY_TAB_FIELD.search(text):
        raise ValueError("file contains empty tab-separated fields")
    lines = text.splitlines()
    while lines and not lines[-1].strip():
        lines.pop()
    if not lines:
        raise ValueError("empty file")
    n_cols = len(lines[0].split())
    flat = np.array(text.split(), dtype=np.float64)
    if n_cols == 0 or flat.size != len(lines) * n_cols:
        raise ValueError(f"ragged file: {flat.size} values for {len(lines)} rows x {n_cols} columns")
    return flat.reshape(len(lines), n_cols)


def parse_csv_bytes(raw: bytes) -> np.ndarray:
    """Generic CSV/TSV adapter: numeric columns, optional single header row.

    Empty cells and 'nan' become NaN (missing samples), at their own position
    for comma- or tab-separated files. Whitespace-only files cannot express an
    empty cell, so ragged rows there are rejected rather than silently shifted.
    """
    text = raw.decode("utf-8-sig", errors="strict")
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        raise ValueError("empty file")
    # Delimiter-aware so empty cells keep their position: comma, then tab, then
    # whitespace (whitespace splitting cannot represent an empty cell).
    if any("," in ln for ln in lines[:5]):
        delim = ","
    elif any("	" in ln for ln in lines[:5]):
        delim = "	"
    else:
        delim = None
    first = lines[0].split(delim) if delim else lines[0].split()

    def _is_number(tok: str) -> bool:
        tok = tok.strip()
        if tok == "" or tok.lower() == "nan":
            return True
        try:
            float(tok)
            return True
        except ValueError:
            return False

    start = 0 if all(_is_number(t) for t in first) else 1
    rows = []
    for ln in lines[start:]:
        toks = ln.split(delim) if delim else ln.split()
        rows.append([float(t) if t.strip() not in ("", "nan", "NaN") else np.nan for t in toks])
    width = len(rows[0]) if rows else 0
    if width == 0 or any(len(r) != width for r in rows):
        raise ValueError("ragged or empty CSV")
    return np.asarray(rows, dtype=np.float64)


def _longest_run(mask: np.ndarray) -> int:
    if not mask.any():
        return 0
    padded = np.concatenate(([0], mask.astype(np.int8), [0]))
    d = np.diff(padded)
    starts = np.flatnonzero(d == 1)
    ends = np.flatnonzero(d == -1)
    return int((ends - starts).max())


def validate_and_repair(x: np.ndarray, fs: float, rules: ValidationRules = ValidationRules()) -> tuple[np.ndarray | None, Quality]:
    """Check one channel; linearly interpolate short gaps if acceptable.

    Returns (clean_signal or None, Quality).
    """
    x = np.asarray(x, dtype=np.float64).ravel()
    reasons: list[str] = []
    n = x.size
    missing = ~np.isfinite(x)
    miss_frac = float(missing.mean()) if n else 1.0
    gap = _longest_run(missing)

    if abs(fs - rules.expected_fs) > 1e-6 * rules.expected_fs:
        reasons.append(f"sample rate {fs:g} Hz differs from expected {rules.expected_fs:g} Hz")
    if n < rules.min_length_fraction * rules.expected_n:
        reasons.append(f"only {n} samples, need at least {int(rules.min_length_fraction * rules.expected_n)}")
    if miss_frac > rules.max_missing_fraction:
        reasons.append(f"{miss_frac:.0%} of samples missing (limit {rules.max_missing_fraction:.0%})")
    if gap > rules.max_gap_samples:
        reasons.append(f"gap of {gap} consecutive missing samples ({gap / fs:.3f} s) exceeds {rules.max_gap_samples}")

    if reasons:
        return None, Quality(False, n, miss_frac, gap, 0, reasons)

    n_interp = int(missing.sum())
    if n_interp:
        idx = np.arange(n)
        good = ~missing
        x = x.copy()
        x[missing] = np.interp(idx[missing], idx[good], x[good])
    return x, Quality(True, n, miss_frac, gap, n_interp, [])


def read_upload(raw: bytes, filename: str) -> np.ndarray:
    """Dispatch to the right parser for an uploaded snapshot.

    Whitespace-separated numeric files (the IMS format, usually .txt or no
    extension) take the fast path; anything with commas, headers or empty
    cells falls back to the CSV adapter.
    """
    if not filename.lower().endswith(".csv"):
        try:
            return parse_ims_bytes(raw)
        except (ValueError, UnicodeDecodeError):
            pass
    return parse_csv_bytes(raw)


__all__ = [
    "IMS_FS",
    "IMS_N",
    "ValidationRules",
    "Quality",
    "parse_ims_timestamp",
    "parse_ims_bytes",
    "parse_csv_bytes",
    "validate_and_repair",
    "read_upload",
]
