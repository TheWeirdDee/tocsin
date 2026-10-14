"""End-to-end data-to-alert path on real IMS readings (shipped samples)."""
import os

import numpy as np
import pytest

from tocsin.bearing import IMS_ZA2115
from tocsin.detectors import FAMILIES, score_tocsin
from tocsin.explain import evidence
from tocsin.features import FeatureParams, snapshot_features
from tocsin.ingest import IMS_FS, IMS_N, parse_ims_bytes, parse_ims_timestamp, validate_and_repair
from tocsin.state import ALERT, BASELINING, DATA_INSUFFICIENT, run_states

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLES = os.path.join(ROOT, "web", "public", "samples")
EARLY = os.path.join(SAMPLES, "ims_test2_2004.02.12.10.32.39.txt")
LATE = os.path.join(SAMPLES, "ims_test2_2004.02.19.05.42.39.txt")
pytestmark = pytest.mark.skipif(not os.path.exists(LATE), reason="sample IMS readings not present")

P = FeatureParams(band=(2000.0, 8000.0))
DEFECT = IMS_ZA2115.frequencies(2000.0)


def _read(path):
    with open(path, "rb") as fh:
        return parse_ims_bytes(fh.read())


def test_real_ims_file_parses_with_documented_shape():
    d = _read(EARLY)
    assert d.shape == (IMS_N, 4)
    assert np.all(np.isfinite(d))
    assert parse_ims_timestamp(EARLY.replace("ims_test2_", "").replace(".txt", "")).year == 2004


def test_real_late_reading_raises_outer_race_alert_for_bearing_1():
    early = _read(EARLY)[:, 0]
    late = _read(LATE)[:, 0]
    rng = np.random.default_rng(0)
    seq, valid = [], []
    # 72 reference readings: the real healthy reading with small independent sensor noise
    for _ in range(72):
        seq.append(early + rng.normal(0, 0.005, early.size))
    # one unusable reading (40% contiguous gap) must not advance or clear anything
    gap = late.copy()
    gap[1000:1000 + int(0.4 * IMS_N)] = np.nan
    # then three real late-life readings, with the gap after the first
    stream = [late, gap, late + rng.normal(0, 0.005, late.size), late + rng.normal(0, 0.005, late.size)]
    seq += stream
    feats = {}
    for x in seq:
        y, q = validate_and_repair(x, IMS_FS)
        valid.append(q.valid)
        f = snapshot_features(y, IMS_FS, DEFECT, P) if q.valid else {}
        for fam in FAMILIES:
            feats.setdefault(f"{fam}_prom_db", []).append(f.get(f"{fam}_prom_db", np.nan))
    feats = {k: np.asarray(v) for k, v in feats.items()}
    valid = np.asarray(valid)
    sr = score_tocsin(feats, valid, 72)
    tr = run_states(sr.score, valid, theta=3.5, k=3, n_ref=72)
    assert tr.state[71] == BASELINING
    assert tr.state[73] == DATA_INSUFFICIENT
    assert tr.state[-1] == ALERT
    # With a one-reading reference both outer-race and rolling-element bands exceed the threshold;
    # the outer-race band must be one of them.
    assert sr.family_z["BPFO"][-1] >= 3.5
    ev = evidence(1, "2004-02-19T05:42:39", ALERT, int(sr.implicated[-1]), float(sr.score[-1]), 3.5, int(tr.counter[-1]), 3,
                  {f: float(feats[f"{f}_prom_db"][-1]) for f in FAMILIES}, sr.reference, DEFECT)
    assert ev["ratio_vs_reference"] > 1.5
    assert ev["family_label"] in ev["sentence"] and "Prioritize inspection" in ev["sentence"]
