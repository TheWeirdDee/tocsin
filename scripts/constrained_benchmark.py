"""Measure the API inside a resource-capped container (PRD F10: 0.5 CPU, 256 MB).

Run by .github/workflows/constrained-benchmark.yml, which builds the production Dockerfile, starts it
with `docker run --cpus=0.5 --memory=256m --memory-swap=256m`, and passes in what only Docker can see
(cold start, peak memory from the container's cgroup, whether it was OOM-killed, image size):

  python scripts/constrained_benchmark.py --base http://127.0.0.1:8000 --meta meta.json --out results/deploy_constrained.json

Each request analyses one real IMS reading (20,480 samples x 4 channels). Requests are sequential, so
the numbers are per-reading latency on half a CPU, not throughput under load.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import time
import urllib.request
import uuid
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLE = os.path.join(ROOT, "web", "public", "samples", "ims_test2_2004.02.19.05.42.39.txt")


def analyze(base: str, raw: bytes) -> tuple[float, dict]:
    boundary = uuid.uuid4().hex
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="ims.txt"\r\n'
            f"Content-Type: text/plain\r\n\r\n").encode() + raw + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(f"{base}/api/analyze", data=body, method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read())
    return (time.perf_counter() - t0) * 1000, data


def summary(xs: list[float]) -> dict:
    xs = sorted(xs)
    return {"median": round(statistics.median(xs), 1), "p95": round(xs[int(0.95 * (len(xs) - 1))], 1),
            "max": round(xs[-1], 1), "n": len(xs)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--n", type=int, default=50)
    ap.add_argument("--meta", help="JSON file with container facts gathered by the workflow")
    ap.add_argument("--out", default=os.path.join(ROOT, "results", "deploy_constrained.json"))
    a = ap.parse_args()
    raw = open(SAMPLE, "rb").read()
    for _ in range(3):  # warm-up: first-call imports and caches
        analyze(a.base, raw)
    server, round_trip, valid = [], [], 0
    for _ in range(a.n):
        rt, d = analyze(a.base, raw)
        round_trip.append(rt)
        server.append(d["timing_ms"]["total"])
        valid += bool(d.get("valid"))
    meta = json.load(open(a.meta)) if a.meta else {}
    rec = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "what": "Production Docker image run with --cpus=0.5 --memory=256m (no swap) on a GitHub Actions runner",
        "container": meta,
        "input": f"{os.path.basename(SAMPLE)}: 20,480 samples x 4 channels, {len(raw):,} bytes",
        "analyses": a.n,
        "valid_results": valid,
        "server_analysis_ms": summary(server),
        "round_trip_ms_same_host": summary(round_trip),
        "note": "Sequential requests on half a CPU. Round trip is from the same host, so it adds HTTP and upload "
                "handling but no network. The runner's CPU differs from the laptop and from Railway.",
    }
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(rec, fh, indent=1)
    print(json.dumps(rec, indent=1))


if __name__ == "__main__":
    main()
