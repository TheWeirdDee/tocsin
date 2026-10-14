"""Package the public demo bundle and the science bundle for a GitHub Release.

  python scripts/package_artifacts.py

Writes to dist/:
  tocsin-demo-artifacts-v<version>.tar.gz   runs.json, replay JSON, 8-bit display spectra,
                                            ARTIFACT_MANIFEST.json (per-file SHA-256)
  tocsin-features-v<version>.tar.gz         per-reading feature tables (lets evaluate.py run
                                            without the 1 GB NASA archive)
and prints the SHA-256 of each archive. The archives are deterministic
(sorted members, fixed mtime, no owner names).

Only the display spectra are re-encoded (see tocsin/spectra_codec.py). Replay
decisions, results and features are copied byte-for-byte.
"""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import os
import sys
import tarfile

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tocsin import __version__  # noqa: E402
from tocsin.spectra_codec import ENCODING, encode  # noqa: E402

ART = os.path.join(ROOT, "artifacts")
WORK = os.path.join(ROOT, "data", "work")
DIST = os.path.join(ROOT, "dist")


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def deterministic_tar(members: dict[str, bytes], out_path: str) -> str:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w", format=tarfile.PAX_FORMAT) as tar:
        for name in sorted(members):
            data = members[name]
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mtime = 0
            info.mode = 0o644
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            tar.addfile(info, io.BytesIO(data))
    raw = buf.getvalue()
    gz = io.BytesIO()
    with gzip.GzipFile(fileobj=gz, mode="wb", mtime=0, compresslevel=9) as fh:
        fh.write(raw)
    data = gz.getvalue()
    with open(out_path, "wb") as fh:
        fh.write(data)
    return sha256_bytes(data)


def npy_bytes(arr: np.ndarray) -> bytes:
    b = io.BytesIO()
    np.save(b, arr, allow_pickle=False)
    return b.getvalue()


def main():
    with open(os.path.join(ROOT, "config", "frozen.json")) as fh:
        cfg = json.load(fh)
    os.makedirs(DIST, exist_ok=True)
    band = cfg["band"]

    # ---- demo bundle ----
    bundle = f"tocsin-demo-artifacts-v{__version__}"
    members: dict[str, bytes] = {}
    with open(os.path.join(ART, "runs.json"), "rb") as fh:
        runs = json.load(fh)
    if runs.get("config_sha") != cfg["sha256"]:
        raise SystemExit("artifacts/runs.json was not built with the current frozen config; rerun build_artifacts.py")
    runs["spectrum_encoding"] = ENCODING
    members["runs.json"] = json.dumps(runs, indent=1).encode()
    for run in sorted(os.listdir(os.path.join(ART, "replay"))):
        for fn in sorted(os.listdir(os.path.join(ART, "replay", run))):
            with open(os.path.join(ART, "replay", run, fn), "rb") as fh:
                members[f"replay/{run}/{fn}"] = fh.read()
    for run in sorted(os.listdir(os.path.join(ART, "spectra"))):
        d = os.path.join(ART, "spectra", run)
        for fn in sorted(os.listdir(d)):
            if fn == "freqs.npy":
                with open(os.path.join(d, fn), "rb") as fh:
                    members[f"spectra/{run}/{fn}"] = fh.read()
            elif fn.endswith(f"__{band}.npy"):
                members[f"spectra/{run}/{fn}"] = npy_bytes(encode(np.load(os.path.join(d, fn))))
    manifest = {
        "bundle": bundle, "version": __version__, "config_sha": cfg["sha256"],
        "spectrum_encoding": ENCODING,
        "files": {k: {"sha256": sha256_bytes(v), "bytes": len(v)} for k, v in sorted(members.items())},
    }
    members["ARTIFACT_MANIFEST.json"] = json.dumps(manifest, indent=1).encode()
    demo_path = os.path.join(DIST, f"{bundle}.tar.gz")
    demo_sha = deterministic_tar(members, demo_path)

    # ---- science bundle (features) ----
    sci = f"tocsin-features-v{__version__}"
    smem: dict[str, bytes] = {}
    for fn in sorted(os.listdir(WORK)):
        if fn.startswith("features_") and (fn.endswith(".npz") or fn.endswith(".meta.json")):
            with open(os.path.join(WORK, fn), "rb") as fh:
                smem[f"data/work/{fn}"] = fh.read()
    smem["FEATURES_MANIFEST.json"] = json.dumps({
        "bundle": sci, "version": __version__, "config_sha": cfg["sha256"], "extraction_sha": cfg.get("extraction_sha"),
        "note": "Per-reading features from scripts/extract_features.py. *_tol4 files are the POST-HOC diagnostic only.",
        "files": {k: {"sha256": sha256_bytes(v), "bytes": len(v)} for k, v in sorted(smem.items())},
    }, indent=1).encode()
    sci_path = os.path.join(DIST, f"{sci}.tar.gz")
    sci_sha = deterministic_tar(smem, sci_path)

    for p, h in ((demo_path, demo_sha), (sci_path, sci_sha)):
        print(f"{os.path.basename(p)}  {os.path.getsize(p):,} bytes  sha256 {h}")
    with open(os.path.join(DIST, "SHA256SUMS.txt"), "w") as fh:
        fh.write(f"{demo_sha}  {os.path.basename(demo_path)}\n{sci_sha}  {os.path.basename(sci_path)}\n")


if __name__ == "__main__":
    main()
