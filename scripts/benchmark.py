"""Measure deployment characteristics of the actual implementation.

Writes results/deploy.json. Every value is measured here on the machine the
script runs on; nothing is copied from a target. Run with the API not already
listening on the chosen port.
"""
from __future__ import annotations

import json
import os
import platform
import statistics
import subprocess
import sys
import time
import urllib.request

import numpy as np
import psutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tocsin.bearing import IMS_NOMINAL_RPM, IMS_ZA2115  # noqa: E402
from tocsin.features import FeatureParams, snapshot_features  # noqa: E402
from tocsin.ingest import IMS_FS, parse_ims_bytes, validate_and_repair  # noqa: E402

SAMPLE = os.path.join(ROOT, "web", "public", "samples", "ims_test2_2004.02.19.05.42.39.txt")
PORT = 8765
N = 200


def pct(xs, q):
    return float(np.percentile(xs, q))


def cpu_name():
    if platform.system() == "Windows":
        try:
            out = subprocess.run(["powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_Processor).Name"],
                                 capture_output=True, text=True, timeout=20).stdout.strip()
            return out or platform.processor()
        except Exception:
            return platform.processor()
    try:
        with open("/proc/cpuinfo") as fh:
            for line in fh:
                if line.startswith("model name"):
                    return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return platform.processor()


def rss_tree(proc: psutil.Process) -> int:
    """Resident memory of a process and its children (the Windows venv launcher spawns the real interpreter)."""
    total = 0
    for q in [proc] + proc.children(recursive=True):
        try:
            total += q.memory_info().rss
        except psutil.NoSuchProcess:
            pass
    return total


def dir_size(path):
    total = 0
    for dp, _, fns in os.walk(path):
        for f in fns:
            total += os.path.getsize(os.path.join(dp, f))
    return total


def main():
    with open(os.path.join(ROOT, "config", "frozen.json")) as fh:
        cfg = json.load(fh)
    fp = cfg["feature_params"]
    params = FeatureParams(band=tuple(fp["band"]), harmonics=fp["harmonics"], band_tol=fp["band_tol"],
                           background_halfwidth_hz=fp["background_halfwidth_hz"], env_max_hz=fp["env_max_hz"])
    defect = IMS_ZA2115.frequencies(IMS_NOMINAL_RPM)
    raw = open(SAMPLE, "rb").read()

    # warm-up, then timed runs (single process)
    for _ in range(5):
        x = parse_ims_bytes(raw)[:, 0]
        snapshot_features(validate_and_repair(x, IMS_FS)[0], IMS_FS, defect, params)
    full, feat_only, parse_only = [], [], []
    for _ in range(N):
        t0 = time.perf_counter()
        data = parse_ims_bytes(raw)
        t1 = time.perf_counter()
        y, q = validate_and_repair(data[:, 0], IMS_FS)
        snapshot_features(y, IMS_FS, defect, params)
        t2 = time.perf_counter()
        parse_only.append((t1 - t0) * 1000)
        feat_only.append((t2 - t1) * 1000)
        full.append((t2 - t0) * 1000)

    # server: cold start to first healthy response, then memory under load
    env = dict(os.environ, OMP_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1", MKL_NUM_THREADS="1")
    t0 = time.perf_counter()
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "server.app:app", "--port", str(PORT), "--log-level", "warning"],
                            cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    cold = None
    for _ in range(600):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/health", timeout=1) as r:
                if r.status == 200:
                    cold = time.perf_counter() - t0
                    break
        except Exception:
            time.sleep(0.05)
    p = psutil.Process(proc.pid)
    rss_idle = rss_tree(p)
    for url in (f"/api/runs", f"/api/replay/test3?condition=clean", f"/api/spectrum/test3/3/6000?condition=clean"):
        urllib.request.urlopen(f"http://127.0.0.1:{PORT}{url}", timeout=30).read()
    # live analyze endpoint, end-to-end over HTTP (includes upload, parsing, analysis, JSON)
    boundary = "----tocsinbench"
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"s.txt\"\r\n\r\n").encode() + raw + \
           (f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"reference\"\r\n\r\ntest2:1\r\n--{boundary}--\r\n").encode()
    http_ms = []
    for i in range(40):
        req = urllib.request.Request(f"http://127.0.0.1:{PORT}/api/analyze", data=body, method="POST",
                                     headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
        t = time.perf_counter()
        urllib.request.urlopen(req, timeout=30).read()
        if i >= 5:
            http_ms.append((time.perf_counter() - t) * 1000)
    rss_loaded = rss_tree(p)
    for q in p.children(recursive=True):
        q.terminate()
    proc.terminate()
    proc.wait(timeout=10)

    vm = psutil.virtual_memory()
    hw = {"cpu": cpu_name(), "logical_cores": psutil.cpu_count(), "ram_gb": round(vm.total / 1e9, 1),
          "os": platform.platform(), "python": platform.python_version()}
    hw["summary"] = f"{hw['cpu']}, {hw['logical_cores']} logical cores, {hw['ram_gb']} GB RAM, {platform.system()}"
    art = dir_size(os.path.join(ROOT, "artifacts"))
    cfg_size = os.path.getsize(os.path.join(ROOT, "config", "frozen.json"))
    out = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "hardware": hw,
        "config_sha": cfg["sha256"],
        "samples": {"in_process_runs": N, "http_runs": len(http_ms)},
        "raw": {
            "analysis_ms": {"median": statistics.median(full), "p95": pct(full, 95)},
            "features_only_ms": {"median": statistics.median(feat_only), "p95": pct(feat_only, 95)},
            "parse_ms": {"median": statistics.median(parse_only), "p95": pct(parse_only, 95)},
            "http_analyze_ms": {"median": statistics.median(http_ms), "p95": pct(http_ms, 95)},
            "cold_start_s": cold, "rss_idle_mb": rss_idle / 1e6, "rss_after_load_mb": rss_loaded / 1e6,
            "artifacts_mb": art / 1e6, "per_bearing_reference_bytes": 6 * 8, "frozen_config_bytes": cfg_size,
        },
    }
    r = out["raw"]
    out["rows"] = [
        {"name": "Analysis per reading, one channel (median / p95)",
         "value": f"{r['analysis_ms']['median']:.1f} / {r['analysis_ms']['p95']:.1f} ms",
         "includes": f"Parsing the 4-channel ASCII file, validation, band-pass, Hilbert envelope, FFT, defect-band features. Warm, single process, {N} runs."},
        {"name": "Signal processing only (median)", "value": f"{r['features_only_ms']['median']:.1f} ms",
         "includes": "Validation and features for one channel, excluding file parsing."},
        {"name": "HTTP /api/analyze round trip (median / p95)",
         "value": f"{r['http_analyze_ms']['median']:.0f} / {r['http_analyze_ms']['p95']:.0f} ms",
         "includes": f"Local upload of a 0.55 MB file, parsing, analysis and JSON response. Server limited to 1 BLAS thread. {len(http_ms)} warm runs."},
        {"name": "Server cold start", "value": f"{cold:.1f} s" if cold else "not measured",
         "includes": "Python interpreter start, imports and first /api/health response."},
        {"name": "Server memory (resident)", "value": f"{r['rss_idle_mb']:.0f} MB idle · {r['rss_after_load_mb']:.0f} MB after load",
         "includes": "Whole process tree (on Windows this includes the small venv launcher). Measured after serving the largest replay (Test 3), a spectrum, and 40 live analyses."},
        {"name": "Learned state per bearing", "value": "48 bytes",
         "includes": "A median and a spread for each of three defect families. There is no trained model file."},
        {"name": "Precomputed replay artifacts", "value": f"{r['artifacts_mb']:.0f} MB",
         "includes": "All replays and stored spectra for the demo. Not needed for live analysis."},
    ]
    out["note"] = ("Measured on a developer laptop, not on a 0.5-CPU / 256 MB container. Docker was not available on the build machine, "
                   "so the constrained-container benchmark proposed in planning was not run.")
    with open(os.path.join(ROOT, "results", "deploy.json"), "w") as fh:
        json.dump(out, fh, indent=2)
    for row in out["rows"]:
        print(f"{row['name']}: {row['value']}")


if __name__ == "__main__":
    main()
