"""Write results/manifest.json: data checksums, per-file hash digests, config hash, versions."""
from __future__ import annotations

import hashlib
import json
import os
import platform
import sys
from datetime import datetime, timezone
from importlib import metadata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from scripts.fetch_data import EXPECTED, URL  # noqa: E402
from tocsin import __version__  # noqa: E402
from tocsin.pipeline import load_run  # noqa: E402


def main():
    with open(os.path.join(ROOT, "config", "frozen.json")) as fh:
        cfg = json.load(fh)
    raw = os.path.join(ROOT, "data", "raw")
    archives = []
    for name in ("1st_test.rar", "2nd_test.rar", "3rd_test.rar", "Readme Document for IMS Bearing Data.pdf"):
        p = os.path.join(raw, name)
        archives.append({"name": name, "sha256": EXPECTED[name], "bytes": os.path.getsize(p) if os.path.exists(p) else None})
    runs = {}
    for run in ("test1", "test2", "test3"):
        rf = load_run(run)
        with open(os.path.join(ROOT, "data", "work", f"features_{run}.meta.json")) as fh:
            meta = json.load(fh)
        # Digest of the ordered per-file SHA-256 list: one value that pins every file read.
        digest = hashlib.sha256("\n".join(f"{n} {h}" for n, h in zip(rf.names, rf.sha256)).encode()).hexdigest()
        runs[run] = {"files": len(rf.names), "first": rf.times[0].isoformat(), "last": rf.times[-1].isoformat(),
                     "per_file_sha256_digest": digest, "parse_errors": len(meta.get("parse_errors", {})),
                     "features_config_sha": meta.get("config_sha"), "extract_seconds": meta.get("elapsed_s")}
    pkgs = {}
    for p in ("numpy", "scipy", "scikit-learn", "fastapi", "uvicorn"):
        try:
            pkgs[p] = metadata.version(p)
        except metadata.PackageNotFoundError:
            pkgs[p] = None
    out = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "tocsin_version": __version__,
        "source_url": URL,
        "archive_zip_sha256": EXPECTED["ims_bearings.zip"],
        "archives": archives,
        "runs": runs,
        "frozen_config_sha256": cfg["sha256"],
        "frozen_at": cfg["frozen_at"],
        "seeds": {"complications": "sha256(run|bearing|condition) with reading index", "isolation_forest": cfg["seed"]},
        "software": {"python": platform.python_version(), **pkgs},
        "platform": platform.platform(),
    }
    with open(os.path.join(ROOT, "results", "manifest.json"), "w") as fh:
        json.dump(out, fh, indent=2)
    print(json.dumps(runs, indent=1))


if __name__ == "__main__":
    main()
