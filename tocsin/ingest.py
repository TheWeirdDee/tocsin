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
    if n_cols == 0:
        raise ValueError("empty first row")
    # Every row must have the same width. A total-count check alone would accept a long row
    # balanced by a short one, and the reshape would then shift samples between channels.
    for i, ln in enumerate(lines):
        w = len(ln.split())
        if w != n_cols:
            raise ValueError(f"row {i + 1} has {w} fields; expected {n_cols}")
    flat = np.array(text.split(), dtype=np.float64)
    return flat.reshape(len(lines), n_cols)


def parse_csv_bytes(raw: bytes) -> np.ndarray:
    """Generic CSV/TSV adapter: numeric columns, optional single header row.

    Empty cells and 'nan' become NaN (missing samples), at their own position
    for comma- or tab-separated files. Whitespace-only files cannot express an
    empty cell, so ragged rows there are rejected rather than silently shifted.

    A blank line is a missing sample on every channel, kept at its position so the
    time axis is never compressed. Only blank lines after the last data row, or
    before a header row, are formatting and are ignored.
    """
    text = raw.decode("utf-8-sig", errors="strict")
    all_lines = text.splitlines()
    filled = [i for i, ln in enumerate(all_lines) if ln.strip()]
    if not filled:
        raise ValueError("empty file")
    lines = all_lines[:filled[-1] + 1]
    lead = filled[0]  # blank lines before the first non-blank line; decided once the header is known
    # Delimiter-aware so empty cells keep their position: comma, then tab, then
    # whitespace (whitespace splitting cannot represent an empty cell).
    if any("," in ln for ln in lines[:5]):
        delim = ","
    elif any("	" in ln for ln in lines[:5]):
        delim = "	"
    else:
        delim = None
    first = lines[lead].split(delim) if delim else lines[lead].split()

    def _is_number(tok: str) -> bool:
        tok = tok.strip()
        if tok == "" or tok.lower() == "nan":
            return True
        try:
            float(tok)
            return True
        except ValueError:
            return False

    # With a header, everything up to and including it is skipped; without one, leading blank
    # lines are missing samples like any other blank line.
    start = 0 if all(_is_number(t) for t in first) else lead + 1
    rows: list[list[float] | None] = []
    for ln in lines[start:]:
        if not ln.strip():
            rows.append(None)  # a missing sample on every channel, filled in below
            continue
        toks = ln.split(delim) if delim else ln.split()
        rows.append([float(t) if t.strip() not in ("", "nan", "NaN") else np.nan for t in toks])
    widths = [len(r) for r in rows if r is not None]
    if not widths or widths[0] == 0:
        raise ValueError("ragged or empty CSV")
    width = widths[0]
    for i, r in enumerate(rows):
        if r is not None and len(r) != width:
            raise ValueError(f"ragged CSV: data row {i + 1} has {len(r)} fields; expected {width}")
    return np.asarray([r if r is not None else [np.nan] * width for r in rows], dtype=np.float64)


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
