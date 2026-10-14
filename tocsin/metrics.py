"""Run-to-failure metrics matched to the IMS label structure.

Labels exist only at the end of each test ("defect found at the end"), so
metrics are event-level per bearing, not per-snapshot classification scores.
"""
from __future__ import annotations

from datetime import datetime

import numpy as np

from .state import ALERT, alert_episodes


def _hours(a: datetime, b: datetime) -> float:
    return (b - a).total_seconds() / 3600.0


def snapshot_hours(times: list[datetime], cap_hours: float) -> np.ndarray:
    ts = np.array([t.timestamp() for t in times])
    d = np.diff(ts, append=ts[-1]) / 3600.0
    return np.clip(d, 0.0, cap_hours)


def bearing_metrics(times: list[datetime], valid: np.ndarray, effective: np.ndarray, faulty: bool,
                    n_ref: int, last24_hours: float = 24.0, cap_hours: float = 20 / 60) -> dict:
    """Event metrics for one bearing. Endpoint = last snapshot time of the run."""
    end = times[-1]
    start_mon_idx = np.flatnonzero(valid)
    mon_start = times[start_mon_idx[n_ref]] if start_mon_idx.size > n_ref else end
    eps = alert_episodes(effective, valid)
    # Each snapshot represents the time until the next one, capped so that
    # overnight pauses in the test are not counted as monitored/alert time.
    dur = snapshot_hours(times, cap_hours)
    mon_mask = np.zeros(len(times), dtype=bool)
    if start_mon_idx.size > n_ref:
        mon_mask[start_mon_idx[n_ref]:] = True
    alert_hours = float(dur[(effective == ALERT) & mon_mask].sum())
    monitored_hours = max(float(dur[mon_mask].sum()), 1e-9)
    monitored_valid = int(valid.sum()) - min(n_ref, int(valid.sum()))
    alert_valid = int(((effective == ALERT) & valid).sum())

    out = {
        "faulty": faulty,
        "n_snapshots": len(times),
        "n_valid": int(valid.sum()),
        "monitored_valid_snapshots": monitored_valid,
        "monitoring_start": mon_start.isoformat(),
        "endpoint": end.isoformat(),
        "monitored_hours": round(monitored_hours, 2),
        "alert_episodes": len(eps),
        "alert_hours": round(alert_hours, 2),
        "alert_valid_snapshots": alert_valid,
        "alert_fraction": round(alert_valid / monitored_valid, 5) if monitored_valid else None,
        "alert_hours_per_day": round(alert_hours / (monitored_hours / 24.0), 3),
        "alerted": len(eps) > 0,
    }
    if eps:
        first = times[eps[0][0]]
        out["first_alert"] = first.isoformat()
        out["lead_time_h"] = round(_hours(first, end), 2)
        active_at_end = eps[-1][1] == len(times) - 1
        out["alert_active_at_end"] = bool(active_at_end)
        out["terminal_alert_lead_time_h"] = round(_hours(times[eps[-1][0]], end), 2) if active_at_end else 0.0
        # Alerts in the final window (coupling from a failing neighbour on the same shaft).
        cut = end.timestamp() - last24_hours * 3600
        out["alert_episodes_last24h"] = sum(1 for s, e in eps if times[e].timestamp() >= cut)
        out["alert_episodes_before_last24h"] = sum(1 for s, e in eps if times[s].timestamp() < cut)
    else:
        out.update({"first_alert": None, "lead_time_h": None, "alert_active_at_end": False,
                    "terminal_alert_lead_time_h": None, "alert_episodes_last24h": 0,
                    "alert_episodes_before_last24h": 0})
    return out


def summarize(per_bearing: list[dict]) -> dict:
    """Bearing-level confusion counts with raw numbers kept alongside ratios."""
    faulty = [b for b in per_bearing if b["faulty"]]
    healthy = [b for b in per_bearing if not b["faulty"]]
    tp = sum(1 for b in faulty if b["alerted"])
    fn = len(faulty) - tp
    fp = sum(1 for b in healthy if b["alerted"])
    tn = len(healthy) - fp
    leads = [b["lead_time_h"] for b in faulty if b["lead_time_h"] is not None]
    term = [b["terminal_alert_lead_time_h"] for b in faulty if b["terminal_alert_lead_time_h"]]
    h_hours = sum(b["alert_hours"] for b in healthy)
    h_days = sum(b["monitored_hours"] for b in healthy) / 24.0
    return {
        "n_faulty": len(faulty),
        "n_healthy": len(healthy),
        "tp": tp, "fn": fn, "fp": fp, "tn": tn,
        "precision": round(tp / (tp + fp), 3) if (tp + fp) else None,
        "recall": round(tp / (tp + fn), 3) if (tp + fn) else None,
        "lead_times_h": leads,
        "terminal_lead_times_h": term,
        "healthy_alert_episodes": sum(b["alert_episodes"] for b in healthy),
        "healthy_alert_episodes_excl_last24h": sum(b["alert_episodes_before_last24h"] for b in healthy),
        "healthy_alert_hours": round(h_hours, 2),
        "healthy_monitored_days": round(h_days, 2),
        "healthy_alert_hours_per_bearing_day": round(h_hours / h_days, 3) if h_days else None,
    }
