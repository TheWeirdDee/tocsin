"""Artifact bundle integrity: the fetch step must refuse anything that does not match the lock."""
import json
import os
import subprocess
import sys

import numpy as np
import pytest

from tocsin.spectra_codec import decode, encode

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUNDLE = os.path.join(ROOT, "dist", "tocsin-demo-artifacts-v1.1.0.tar.gz")


def test_spectra_codec_round_trip_within_0_3_db():
    a = np.array([0.0, 7e-7, 1e-4, 0.37], dtype=np.float32)
    d = decode(encode(a))
    assert d[0] == 0.0
    assert np.all(np.abs(20 * np.log10(d[1:] / a[1:])) <= 0.3 + 1e-6)


@pytest.mark.skipif(not os.path.exists(BUNDLE), reason="bundle not packaged locally")
def test_fetch_refuses_checksum_mismatch(tmp_path):
    lock = json.load(open(os.path.join(ROOT, "config", "artifacts.lock.json")))
    lock["url"] = "file:///" + BUNDLE.replace("\\", "/")
    lock["sha256"] = "0" * 64
    root = tmp_path / "repo"
    (root / "config").mkdir(parents=True)
    (root / "scripts").mkdir()
    (root / "config" / "artifacts.lock.json").write_text(json.dumps(lock))
    (root / "config" / "frozen.json").write_text(open(os.path.join(ROOT, "config", "frozen.json")).read())
    (root / "scripts" / "fetch_artifacts.py").write_text(open(os.path.join(ROOT, "scripts", "fetch_artifacts.py")).read())
    r = subprocess.run([sys.executable, str(root / "scripts" / "fetch_artifacts.py")], capture_output=True, text=True)
    assert r.returncode == 1 and "checksum mismatch" in r.stderr
    assert not (root / "artifacts").exists()
