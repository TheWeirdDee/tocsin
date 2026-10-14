"""Evidence objects and plain-language sentences built from structured decision data.

No language model is involved: every sentence is a template filled from
numbers that are also shown next to it, and unit-tested.
"""
from __future__ import annotations

import math

from .bearing import FAULT_FAMILIES
from .state import STATE_NAMES

FAMILY_LIST = list(FAULT_FAMILIES)


def _fmt(x: float, nd: int = 1) -> str:
    return "n/a" if x is None or not math.isfinite(x) else f"{x:.{nd}f}"


def ratio_vs_reference(prom_db: float, ref_db: float) -> float | None:
    """Linear ratio of current band prominence to the bearing's healthy median prominence.

    Both are peak/background amplitude ratios expressed in dB, so their dB
    difference converts to a valid linear ratio.
    """
    if prom_db is None or ref_db is None or not (math.isfinite(prom_db) and math.isfinite(ref_db)):
        return None
    return 10 ** ((prom_db - ref_db) / 20.0)


def evidence(bearing: int, timestamp: str, state: int, family_idx: int, score: float, theta: float,
             counter: int, k: int, prom_db: dict[str, float], reference: dict[str, dict], defect_hz: dict[str, float],
             peak_hz: float | None = None, trend_per_hour: float | None = None, quality_note: str | None = None,
             config_sha: str | None = None, clear_count: int = 0) -> dict:
    fam = FAMILY_LIST[family_idx] if 0 <= family_idx < len(FAMILY_LIST) else None
    ev = {
        "bearing": bearing,
        "timestamp": timestamp,
        "state": STATE_NAMES[state],
        "family": fam,
        "family_label": FAULT_FAMILIES.get(fam) if fam else None,
        "defect_hz": defect_hz.get(fam) if fam else None,
        "peak_hz": peak_hz,
        "current_prom_db": prom_db.get(fam) if fam else None,
        "reference_prom_db": reference.get(fam, {}).get("median") if fam else None,
        "score": score,
        "threshold": theta,
        "score_over_threshold": (score / theta) if (score is not None and math.isfinite(score) and theta) else None,
        "persistence": {"count": int(counter), "required": int(k), "clear_count": int(clear_count)},
        "trend_per_hour": trend_per_hour,
        "quality_note": quality_note,
        "config_sha": config_sha,
    }
    ev["ratio_vs_reference"] = ratio_vs_reference(ev["current_prom_db"], ev["reference_prom_db"]) if fam else None
    ev["sentence"] = sentence(ev)
    return ev


def sentence(ev: dict) -> str:
    st = ev["state"]
    b = ev["bearing"]
    if st == "BASELINING":
        return f"Bearing {b}: learning this bearing's healthy reference; no alerts are possible yet."
    if st == "DATA_INSUFFICIENT":
        note = ev.get("quality_note") or "the reading failed validation"
        return f"Bearing {b}: no verdict for this reading because {note}. The previous state is kept."
    fam = ev.get("family_label") or "defect"
    band = f"{fam} band ({_fmt(ev.get('defect_hz'), 0)} Hz)"
    cur, ref = ev.get("current_prom_db"), ev.get("reference_prom_db")
    ratio = ev.get("ratio_vs_reference")
    p = ev["persistence"]
    level = (f"{band} stands {_fmt(cur)} dB above its local background "
             f"versus {_fmt(ref)} dB in this bearing's healthy reference")
    if ratio is not None:
        level += f" ({_fmt(ratio)}× the reference)"
    if st == "ALERT" and p.get("clear_count", 0) > 0:
        return (f"Bearing {b}: alert still active. {level}, now below the threshold for "
                f"{p['clear_count']} of {p['required']} readings needed to clear it.")
    if st == "ALERT":
        return (f"Bearing {b}: {level}, at or above the alert threshold for {p['count']} consecutive readings "
                f"(needs {p['required']}). Prioritize inspection of this bearing.")
    if st == "WATCH":
        need = p["required"] - p["count"]
        return (f"Bearing {b}: {level}. Above threshold for {p['count']} of {p['required']} readings; "
                f"it becomes an alert if it holds for {need} more.")
    return f"Bearing {b}: no defect band is above its threshold. Strongest: {level}."
