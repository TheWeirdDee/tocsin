"""State machine, metrics, causality and determinism."""
from datetime import datetime, timedelta

import numpy as np
import pytest

from tocsin import complications
from tocsin.detectors import compute_score
from tocsin.metrics import bearing_metrics, summarize
from tocsin.state import ALERT, BASELINING, DATA_INSUFFICIENT, NORMAL, WATCH, run_states

N_REF = 5


def states(scores, valid=None, theta=3.0, k=3):
    s = np.asarray(scores, float)
    v = np.ones(s.size, bool) if valid is None else np.asarray(valid, bool)
    return run_states(s, v, theta, k, N_REF)


def test_baselining_blocks_alerts():
    tr = states([9] * 5 + [0])
    assert list(tr.state[:5]) == [BASELINING] * 5
    assert tr.state[5] == NORMAL


def test_persistence_watch_then_alert_then_clear():
    tr = states([0] * 5 + [5, 5, 5, 5, 0, 0, 0, 0])
    assert list(tr.state[5:]) == [WATCH, WATCH, ALERT, ALERT, ALERT, ALERT, NORMAL, NORMAL]


def test_single_spikes_never_alert():
    tr = states([0] * 5 + [5, 0, 5, 0, 5, 5, 0])
    assert ALERT not in tr.state


def test_insufficient_data_freezes_counters_and_keeps_alert():
    sc = [0] * 5 + [5, 5, 5, 0, 0, 0, 0]
    va = [1] * 5 + [1, 1, 1, 0, 0, 0, 0]
    tr = states(sc, va)
    assert tr.state[8] == DATA_INSUFFICIENT
    assert all(tr.effective[8:] == ALERT), "missing data must not clear an alert"
    assert tr.last_valid_idx[-1] == 7


def test_insufficient_does_not_advance_persistence():
    sc = [0] * 5 + [5, 9, 9, 5]
    va = [1] * 5 + [1, 0, 0, 1]
    tr = states(sc, va)
    assert tr.state[8] == WATCH and tr.counter[8] == 2


def test_invalid_reading_never_produces_healthy_verdict():
    tr = states([0] * 8, [1] * 6 + [0, 0])
    assert list(tr.state[6:]) == [DATA_INSUFFICIENT] * 2


def _times(n, step=10):
    t0 = datetime(2004, 2, 12, 10, 0, 0)
    return [t0 + timedelta(minutes=step * i) for i in range(n)]


def test_lead_time_and_alarm_burden():
    n = 20
    eff = np.full(n, NORMAL, np.int8)
    eff[:N_REF] = BASELINING
    eff[14:] = ALERT
    m = bearing_metrics(_times(n), np.ones(n, bool), eff, True, N_REF)
    assert m["lead_time_h"] == pytest.approx(50 / 60, abs=0.01)
    assert m["alert_active_at_end"] and m["alert_episodes"] == 1
    assert m["alert_hours"] == pytest.approx(50 / 60, abs=0.01)


def test_overnight_gap_is_not_counted_as_alarm_time():
    times = _times(10)
    times = times[:5] + [t + timedelta(hours=14) for t in times[5:]]
    eff = np.full(10, ALERT, np.int8)
    m = bearing_metrics(times, np.ones(10, bool), eff, False, 2)
    assert m["alert_hours"] <= 8 * (20 / 60) + 1e-9


def test_summary_counts():
    per = [{"faulty": True, "alerted": True, "lead_time_h": 10.0, "terminal_alert_lead_time_h": 5.0, "alert_episodes": 1,
            "alert_episodes_before_last24h": 1, "alert_hours": 5, "monitored_hours": 100},
           {"faulty": False, "alerted": True, "lead_time_h": 1.0, "terminal_alert_lead_time_h": 0, "alert_episodes": 2,
            "alert_episodes_before_last24h": 0, "alert_hours": 2, "monitored_hours": 48},
           {"faulty": False, "alerted": False, "lead_time_h": None, "terminal_alert_lead_time_h": None, "alert_episodes": 0,
            "alert_episodes_before_last24h": 0, "alert_hours": 0, "monitored_hours": 48}]
    s = summarize(per)
    assert (s["tp"], s["fn"], s["fp"], s["tn"]) == (1, 0, 1, 1)
    assert s["healthy_alert_hours_per_bearing_day"] == pytest.approx(2 / 4)


def _fake_feats(n, rng):
    f = {k: rng.normal(6, 1, n) for k in ["BPFO_prom_db", "BPFI_prom_db", "2xBSF_prom_db"]}
    f.update({k: rng.normal(1, 0.1, n) for k in ["rms", "std", "peak", "p2p", "crest", "kurtosis", "skewness"]})
    f["rms_db"] = 20 * np.log10(f["rms"])
    f["env_rms_db"] = rng.normal(-25, 1, n)
    f["BPFO_prom_db"][60:] += np.linspace(0, 20, n - 60)
    return f


@pytest.mark.parametrize("det", ["tocsin", "b0_rms", "b1_iforest", "a1_broadband_env", "b0_rms_3sigma"])
def test_no_future_leakage(det):
    """Scores and states up to t must not change when later readings are removed."""
    rng = np.random.default_rng(3)
    n, n_ref = 100, 30
    f = _fake_feats(n, rng)
    valid = np.ones(n, bool)
    valid[[40, 41, 77]] = False
    cfg = {"floor_db": 0.5, "iforest_floor": 0.05, "seed": 0}
    full = compute_score(det, f, valid, n_ref, cfg).score
    full_states = run_states(full, valid, 3.0, 3, n_ref).state
    for cut in (35, 50, 80):
        part = compute_score(det, {k: v[:cut] for k, v in f.items()}, valid[:cut], n_ref, cfg).score
        np.testing.assert_allclose(part, full[:cut], equal_nan=True)
        np.testing.assert_array_equal(run_states(part, valid[:cut], 3.0, 3, n_ref).state, full_states[:cut])


def test_complications_are_deterministic_and_labelled():
    x = np.random.default_rng(0).normal(size=1000)
    a = complications.apply("noise10", x, "test2", 1, 7, 1.0)
    b = complications.apply("noise10", x, "test2", 1, 7, 1.0)
    np.testing.assert_array_equal(a, b)
    d = complications.apply("drop20", x, "test2", 1, 7, None)
    assert np.isnan(d).mean() == pytest.approx(0.2, abs=0.001)
    noise = a - x
    assert np.std(noise) == pytest.approx(1.0 / 10 ** 0.5, rel=0.1)
    assert set(complications.CONDITIONS) >= {"clean", "noise0", "gaps", "loss30"}


def test_low_signal_rule_flags_machine_stopped_readings_causally():
    from tocsin.quality import low_signal_mask
    rms = np.array([1.0, 1.1, 0.9, 1.0, 1.05, 0.02, 1.0, 0.95, 0.03])
    valid = np.ones(rms.size, bool)
    flagged, ratio = low_signal_mask(rms, valid, n_ref=4, frac=0.10)
    assert list(np.flatnonzero(flagged)) == [5, 8]
    # with too little history nothing can be judged, so an early flat reading is not flagged
    f2, _ = low_signal_mask(np.array([0.01, 1.0, 1.0]), np.ones(3, bool), n_ref=4, frac=0.10)
    assert not f2.any()
    # causal: flags up to t do not depend on later readings
    part, _ = low_signal_mask(rms[:6], valid[:6], n_ref=4, frac=0.10)
    np.testing.assert_array_equal(part, flagged[:6])


def test_out_of_order_timestamps_never_produce_negative_durations():
    from tocsin.metrics import snapshot_hours
    t = _times(4)
    d = snapshot_hours([t[0], t[2], t[1], t[3]], 20 / 60)
    assert (d >= 0).all()
