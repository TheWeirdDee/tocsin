"""Download and verify the demo artifact bundle pinned in config/artifacts.lock.json.

Used by the Docker build (Railway) and for local setup without the raw data:

  python scripts/fetch_artifacts.py            # -> artifacts/

Fails with a non-zero exit and a clear message if the download fails, the
archive checksum differs from the lock file, any member's checksum differs
from the bundle manifest, or the bundle was built with a different config.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import sys
import tarfile
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCK = os.path.join(ROOT, "config", "artifacts.lock.json")
DEST = os.environ.get("TOCSIN_ARTIFACTS", os.path.join(ROOT, "artifacts"))


def fail(msg: str) -> None:
    print(f"fetch_artifacts: ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def download(url: str, attempts: int = 4) -> bytes:
    last = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "tocsin-fetch-artifacts"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception as e:  # network errors are retried, then reported
            last = e
            time.sleep(2 * (i + 1))
    fail(f"could not download {url}: {last}")
    return b""


def main():
    with open(LOCK) as fh:
        lock = json.load(fh)
    with open(os.path.join(ROOT, "config", "frozen.json")) as fh:
        cfg_sha = json.load(fh)["sha256"]
    if lock["config_sha"] != cfg_sha:
        fail(f"lock file is for config {lock['config_sha'][:12]}, but config/frozen.json is {cfg_sha[:12]}")
    print(f"fetch_artifacts: downloading {lock['bundle']} from {lock['url']}")
    data = download(lock["url"])
    got = hashlib.sha256(data).hexdigest()
    if got != lock["sha256"]:
        fail(f"archive checksum mismatch: expected {lock['sha256']}, got {got}")
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        members = {m.name: tar.extractfile(m).read() for m in tar.getmembers() if m.isfile()}
    man = json.loads(members["ARTIFACT_MANIFEST.json"])
    if man["config_sha"] != cfg_sha:
        fail("bundle manifest config hash does not match config/frozen.json")
    for name, meta in man["files"].items():
        if name not in members:
            fail(f"bundle is missing {name}")
        if hashlib.sha256(members[name]).hexdigest() != meta["sha256"]:
            fail(f"checksum mismatch for {name}")
    for name, content in members.items():
        if name.startswith("/") or ".." in name.split("/"):
            fail(f"unsafe path in bundle: {name}")
        path = os.path.join(DEST, *name.split("/"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(content)
    print(f"fetch_artifacts: verified {len(man['files'])} files, sha256 {got[:12]}..., config {cfg_sha[:12]} -> {DEST}")


if __name__ == "__main__":
    main()
