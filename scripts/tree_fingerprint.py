"""Identify the exact source state that was tested when it is not yet committed.

  python scripts/tree_fingerprint.py      -> prints HEAD, changed paths and a fingerprint

The fingerprint is SHA-256 over HEAD's commit id plus (path, SHA-256 of content
or "deleted") for every modified, added or deleted file, excluding results/,
docs/ and README.md (test logs, reports, screenshots and the write-ups that cite
them) so that recording the tests does not change the identifier of the code
they ran against.
"""
from __future__ import annotations

import hashlib
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GENERATED = ("results/", "docs/", "README.md")


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout


def main():
    head = git("rev-parse", "HEAD").strip()
    entries = []
    for line in git("status", "--porcelain", "--untracked-files=all").splitlines():
        status, path = line[:2], line[3:].strip().strip('"')
        if path.startswith(GENERATED):
            continue
        full = os.path.join(ROOT, path)
        if os.path.exists(full):
            with open(full, "rb") as fh:
                entries.append((path, hashlib.sha256(fh.read()).hexdigest()))
        else:
            entries.append((path, "deleted"))
    entries.sort()
    h = hashlib.sha256(head.encode())
    for p, d in entries:
        h.update(f"\n{p}\t{d}".encode())
    print(f"HEAD {head}")
    print(f"changed source files {len(entries)}")
    print(f"fingerprint {h.hexdigest()}")


if __name__ == "__main__":
    main()
