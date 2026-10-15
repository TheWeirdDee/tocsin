"""Find verified examples of the state logic under degraded data, from the replay artifacts.

  python scripts/robustness_examples.py   -> results/robustness_examples.json

Searches the precomputed v1.1 replays (no new analysis) for:
  A. an invalid reading while a bearing is in ALERT: the alert is kept (not cleared, not "normal");
  B. persistence across a gap: WATCH count before the gap, invalid reading(s), then the
     count continues from where it stopped (not reset, not advanced by the gap);
  C. an invalid reading while NORMAL: shown as no verdict, never as a fresh NORMAL verdict.
"""
from __future__ import annotations

import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALERT, WATCH, NORMAL, NODATA = 3, 2, 1, 4


def load(run, cond):
    with open(os.path.join(ROOT, "artifacts", "replay", run, f"{cond}.json")) as fh:
        return json.load(fh)


def main():
    found = {"A_alert_kept_through_invalid": None, "B_persistence_resumes_after_gap": None, "C_invalid_never_normal": None}
    for run in ("test3", "test2"):
        for cond in ("gaps", "loss30"):
            r = load(run, cond)
            for bid, b in r["bearings"].items():
                tr = b["detectors"]["tocsin"]
                st, eff, cnt, valid = tr["state"], tr["effective"], tr["counter"], b["valid"]
                n = len(valid)
                for i in range(1, n - 1):
                    if found["A_alert_kept_through_invalid"] is None and not valid[i] and eff[i] == ALERT and st[i] == NODATA:
                        j = i
                        while j < n and not valid[j]:
                            j += 1
                        found["A_alert_kept_through_invalid"] = {
                            "run": run, "condition": cond, "bearing": int(bid), "invalid_index": i, "timestamp": r["times"][i],
                            "reason": b["reasons"][b["reason"][i]], "effective_state": "ALERT",
                            "next_valid_index": j if j < n else None, "state_at_next_valid": st[j] if j < n else None,
                            "url": f"/demo/{run}?cond={cond}&b={bid}&t={i}"}
                    if found["B_persistence_resumes_after_gap"] is None and not valid[i] and valid[i - 1] and st[i - 1] == WATCH:
                        j = i
                        while j < n and not valid[j]:
                            j += 1
                        if j < n and st[j] in (WATCH, ALERT) and cnt[j] == cnt[i - 1] + 1:
                            found["B_persistence_resumes_after_gap"] = {
                                "run": run, "condition": cond, "bearing": int(bid), "before_index": i - 1, "count_before": cnt[i - 1],
                                "invalid_indices": list(range(i, j)), "count_during_gap": cnt[i], "after_index": j, "count_after": cnt[j],
                                "state_after": "ALERT" if st[j] == ALERT else "WATCH", "url": f"/demo/{run}?cond={cond}&b={bid}&t={i}"}
                    if found["C_invalid_never_normal"] is None and not valid[i] and eff[i] == NORMAL and i > r["n_ref"] + 5:
                        found["C_invalid_never_normal"] = {
                            "run": run, "condition": cond, "bearing": int(bid), "invalid_index": i, "timestamp": r["times"][i],
                            "displayed_state": "DATA_INSUFFICIENT", "last_valid_state": "NORMAL", "reason": b["reasons"][b["reason"][i]],
                            "url": f"/demo/{run}?cond={cond}&b={bid}&t={i}"}
    # Exhaustive check across every stored replay: an invalid reading is never displayed as a verdict.
    violations = 0
    checked = 0
    for run in ("test1", "test2", "test3"):
        d = os.path.join(ROOT, "artifacts", "replay", run)
        for fn in os.listdir(d):
            r = load(run, fn[:-5])
            for b in r["bearings"].values():
                for det in ("tocsin", "b0_rms", "b1_iforest"):
                    st = b["detectors"][det]["state"]
                    for i, v in enumerate(b["valid"]):
                        if not v:
                            checked += 1
                            violations += st[i] != NODATA
    found["exhaustive_check"] = {"invalid_readings_checked": checked, "invalid_readings_shown_with_a_verdict": violations}
    with open(os.path.join(ROOT, "results", "robustness_examples.json"), "w") as fh:
        json.dump(found, fh, indent=1)
    print(json.dumps(found, indent=1))


if __name__ == "__main__":
    main()
