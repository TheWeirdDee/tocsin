"""Stream IMS files straight out of the original RAR archives.

`bsdtar -tv` lists exact byte sizes per member and `bsdtar -xO` writes the
members to stdout in the same order, so the stream can be split precisely
without extracting ~5 GB of ASCII to disk.
"""
from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from typing import Iterator

_LIST_RE = re.compile(r"^(?P<mode>[-d][rwx-]{9})\s+\d+\s+\S+\s+\S+\s+(?P<size>\d+)\s+\w{3}\s+\d+\s+[\d:]+\s+(?P<name>.+)$")


def bsdtar_path() -> str:
    for cand in (os.environ.get("TOCSIN_BSDTAR"), shutil.which("bsdtar"), r"C:\msys64\usr\bin\bsdtar.exe"):
        if cand and os.path.exists(cand):
            return cand
    raise FileNotFoundError("bsdtar (libarchive) is required to read the IMS RAR archives")


@dataclass(frozen=True)
class Member:
    name: str
    size: int


def list_members(archive: str) -> list[Member]:
    out = subprocess.run([bsdtar_path(), "-tvf", archive], capture_output=True, text=True, check=True).stdout
    members = []
    for line in out.splitlines():
        m = _LIST_RE.match(line.strip())
        if not m:
            raise ValueError(f"unparsed listing line: {line!r}")
        if m["mode"].startswith("d"):
            continue
        members.append(Member(m["name"], int(m["size"])))
    return members


def iter_members(archive: str, limit: int | None = None) -> Iterator[tuple[Member, bytes, str]]:
    """Yield (member, raw_bytes, sha256) in archive order."""
    members = list_members(archive)
    if limit is not None:
        members = members[:limit]
    proc = subprocess.Popen([bsdtar_path(), "-xOf", archive], stdout=subprocess.PIPE, bufsize=1 << 20)
    assert proc.stdout is not None
    try:
        for m in members:
            buf = bytearray()
            while len(buf) < m.size:
                chunk = proc.stdout.read(m.size - len(buf))
                if not chunk:
                    raise IOError(f"archive stream ended early inside {m.name}")
                buf.extend(chunk)
            raw = bytes(buf)
            yield m, raw, hashlib.sha256(raw).hexdigest()
    finally:
        proc.stdout.close()
        proc.kill()
        proc.wait()
