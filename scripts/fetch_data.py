"""Download the IMS bearing archive from NASA's PCoE repository and verify it.

Leaves data/raw/{1st,2nd,3rd}_test.rar and the readme PDF. The ~5 GB of ASCII
inside the RARs is never extracted; the pipeline streams it.
"""
from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from tocsin.archive import bsdtar_path  # noqa: E402

URL = "https://phm-datasets.s3.amazonaws.com/NASA/4.+Bearings.zip"
RAW = os.path.join(ROOT, "data", "raw")
EXPECTED = {
    "ims_bearings.zip": "21001ac266c465f5d345ec42d7b508c6a6328487fd9d4d7774422dd5ea10ad83",
    "IMS.7z": "c6925060e702708afc47261d349339d7cd97a98166161da6b29c377eb3e66f2c",
    "1st_test.rar": "c25241571583948462a3916d97dc11c984a839f38a0da0907fff18c958c0a484",
    "2nd_test.rar": "b154d5ba1ae5f7f01cdd4f1bde5b08cfdc2f3134d51ad2f6614b1270a86ab632",
    "3rd_test.rar": "01e9ec83c6c55adc0300a20003a261f9a2ac2b714aae4984050325e589252bc8",
    "Readme Document for IMS Bearing Data.pdf": "cf46d37c21f7f292c11bbbdd4695d876c417ed1d6425e3d87c962ae2182ae6ed",
}


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def verify(name: str) -> None:
    got = sha256(os.path.join(RAW, name))
    if got != EXPECTED[name]:
        raise SystemExit(f"checksum mismatch for {name}: {got}")
    print(f"ok  {name}  {got}")


def main():
    os.makedirs(RAW, exist_ok=True)
    if all(os.path.exists(os.path.join(RAW, n)) for n in ("1st_test.rar", "2nd_test.rar", "3rd_test.rar")):
        for n in ("1st_test.rar", "2nd_test.rar", "3rd_test.rar", "Readme Document for IMS Bearing Data.pdf"):
            verify(n)
        return
    z = os.path.join(RAW, "ims_bearings.zip")
    if not os.path.exists(z):
        print(f"downloading {URL} (~1.08 GB)")
        urllib.request.urlretrieve(URL, z)
    verify("ims_bearings.zip")
    tar = bsdtar_path()
    subprocess.run([tar, "-xf", z, "-C", RAW], check=True)
    inner = os.path.join(RAW, "4. Bearings", "IMS.7z")
    shutil.move(inner, os.path.join(RAW, "IMS.7z"))
    shutil.rmtree(os.path.join(RAW, "4. Bearings"), ignore_errors=True)
    os.remove(z)
    verify("IMS.7z")
    subprocess.run([tar, "-xf", os.path.join(RAW, "IMS.7z"), "-C", RAW], check=True)
    os.remove(os.path.join(RAW, "IMS.7z"))
    for n in ("1st_test.rar", "2nd_test.rar", "3rd_test.rar", "Readme Document for IMS Bearing Data.pdf"):
        verify(n)


if __name__ == "__main__":
    main()
