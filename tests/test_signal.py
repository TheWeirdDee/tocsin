"""Feature engine and validation on known synthetic signals (unit-test inputs only)."""
import numpy as np
import pytest

from tocsin.bearing import IMS_ZA2115
from tocsin.features import FeatureParams, envelope_spectrum, snapshot_features, time_features
from tocsin.ingest import IMS_FS, IMS_N, ValidationRules, parse_csv_bytes, parse_ims_bytes, validate_and_repair

DEFECT = IMS_ZA2115.frequencies(2000.0)
P = FeatureParams(band=(1000.0, 9000.0))


def impulse_train(rate_hz, resonance=3500.0, amp=1.0, noise=0.3, seed=0, n=IMS_N, fs=IMS_FS):
    """Decaying resonance bursts repeating at rate_hz plus white noise: a textbook localized defect."""
    rng = np.random.default_rng(seed)
    t = np.arange(n) / fs
    x = rng.normal(0, noise, n)
    ring = np.exp(-t[:200] * 2500) * np.sin(2 * np.pi * resonance * t[:200])
    for t0 in np.arange(0, n / fs, 1.0 / rate_hz):
        i = int(t0 * fs)
        seg = ring[: max(0, min(200, n - i))]
        x[i:i + seg.size] += amp * seg
    return x


def test_defect_frequencies_match_published_values():
    assert DEFECT["BPFO"] == pytest.approx(236.4, abs=0.2)
    assert DEFECT["BPFI"] == pytest.approx(296.9, abs=0.2)
    assert DEFECT["shaft"] == pytest.approx(33.33, abs=0.01)


def test_outer_race_signal_lights_up_bpfo_band_only():
    f = snapshot_features(impulse_train(DEFECT["BPFO"]), IMS_FS, DEFECT, P)
    noise = snapshot_features(np.random.default_rng(1).normal(0, 0.3, IMS_N), IMS_FS, DEFECT, P)
    assert f["BPFO_prom_db"] > noise["BPFO_prom_db"] + 10
    assert f["BPFO_prom_db"] > f["BPFI_prom_db"] + 6
    assert abs(f["BPFO_h1_freq"] - DEFECT["BPFO"]) < 2.0


def test_inner_race_signal_lights_up_bpfi_band():
    f = snapshot_features(impulse_train(DEFECT["BPFI"]), IMS_FS, DEFECT, P)
    assert f["BPFI_prom_db"] > f["BPFO_prom_db"] + 6


def test_envelope_spectrum_resolution_and_range():
    freqs, spec, _ = envelope_spectrum(np.random.default_rng(0).normal(size=IMS_N), IMS_FS, P)
    assert freqs[1] - freqs[0] == pytest.approx(IMS_FS / IMS_N)
    assert freqs[-1] <= P.env_max_hz


def test_time_features_of_sine():
    t = np.arange(IMS_N) / IMS_FS
    f = time_features(np.sin(2 * np.pi * 50 * t))
    assert f["rms"] == pytest.approx(1 / np.sqrt(2), rel=1e-3)
    assert f["kurtosis"] == pytest.approx(1.5, rel=1e-2)
    assert f["crest"] == pytest.approx(np.sqrt(2), rel=1e-2)


def test_validation_accepts_clean_and_interpolates_short_gaps():
    x = np.sin(np.arange(IMS_N) * 0.01)
    x[100:110] = np.nan
    y, q = validate_and_repair(x, IMS_FS)
    assert q.valid and q.interpolated == 10 and np.all(np.isfinite(y))
    assert y[105] == pytest.approx(np.sin(105 * 0.01), abs=5e-3)


@pytest.mark.parametrize("mutate,fs,expect", [
    (lambda x: x[:10000], IMS_FS, "samples"),
    (lambda x: x, 25_600.0, "sample rate"),
    (lambda x: np.where(np.random.default_rng(0).random(x.size) < 0.25, np.nan, x), IMS_FS, "missing"),
    (lambda x: np.concatenate([x[:5000], np.full(3000, np.nan), x[8000:]]), IMS_FS, "gap"),
])
def test_validation_rejects_inadequate_snapshots(mutate, fs, expect):
    y, q = validate_and_repair(mutate(np.ones(IMS_N)), fs, ValidationRules())
    assert y is None and not q.valid
    assert any(expect in r for r in q.reasons)


def test_parse_ims_and_csv():
    raw = b"-0.022\t-0.039\r\n0.1\t0.2\r\n"
    a = parse_ims_bytes(raw)
    assert a.shape == (2, 2) and a[0, 1] == pytest.approx(-0.039)
    c = parse_csv_bytes(b"ch1,ch2\n1,2\n3,\n")
    assert c.shape == (2, 2) and np.isnan(c[1, 1])
    with pytest.raises(ValueError):
        parse_ims_bytes(b"1\t2\r\n3\r\n")
