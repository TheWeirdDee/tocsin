"""Verify a deployed TOCSIN frontend + API pair beyond /api/health.

  python scripts/verify_deployment.py --api https://<api> --web https://<frontend> [--label after-restart]

Appends a JSON record to results/deploy-verification.json. Every check is a
real HTTP request; latencies include the public network path from the machine
running this script, so they are not server-only timings.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLE = os.path.join(ROOT, "web", "public", "samples", "ims_test2_2004.02.19.05.42.39.txt")


def req(url, method="GET", data=None, headers=None, timeout=60):
    r = urllib.request.Request(url, method=method, data=data, headers=headers or {})
    t = time.perf_counter()
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            body = resp.read()
            return resp.status, dict(resp.headers), body, (time.perf_counter() - t) * 1000
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read(), (time.perf_counter() - t) * 1000


def oversized_status(api: str) -> int | None:
    """Declare a 12 MB body but send only headers: the API must answer 413 without reading it."""
    import http.client
    from urllib.parse import urlparse
    u = urlparse(api)
    conn = (http.client.HTTPSConnection if u.scheme == "https" else http.client.HTTPConnection)(u.netloc, timeout=30)
    conn.putrequest("POST", "/api/analyze")
    conn.putheader("Content-Type", "multipart/form-data; boundary=x")
    conn.putheader("Content-Length", str(12 * 1024 * 1024))
    conn.endheaders()
    try:
        return conn.getresponse().status
    finally:
        conn.close()


def multipart(fields: dict, file_name: str, file_bytes: bytes):
    b = uuid.uuid4().hex
    parts = []
    for k, v in fields.items():
        parts.append(f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
    parts.append(f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\n\r\n".encode() + file_bytes + b"\r\n")
    parts.append(f"--{b}--\r\n".encode())
    return b"".join(parts), {"Content-Type": f"multipart/form-data; boundary={b}"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", required=True)
    ap.add_argument("--web", required=True)
    ap.add_argument("--label", default="")
    a = ap.parse_args()
    api, web = a.api.rstrip("/"), a.web.rstrip("/")
    origin = web
    checks = []

    def check(name, ok, detail=""):
        checks.append({"check": name, "pass": bool(ok), "detail": detail})
        print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")

    s, _, b, _ = req(f"{api}/api/health")
    health = json.loads(b)
    check("health 200 and ready", s == 200 and health.get("status") == "ok", f"commit {str(health.get('build_commit'))[:7]}, bundle {health.get('artifact_bundle')}")
    s, _, b, _ = req(f"{api}/api/runs")
    runs = json.loads(b)
    s2, _, b2, _ = req(f"{api}/api/config")
    cfg = json.loads(b2)
    check("artifact/config version agreement", runs.get("config_sha") == cfg.get("sha256") == health.get("config_sha"),
          f"config {cfg.get('sha256', '')[:12]}")
    s, h, b, _ = req(f"{api}/api/replay/test3?condition=clean", headers={"Accept-Encoding": "gzip"})
    check("replay served gzip-compressed", s == 200 and h.get("Content-Encoding", h.get("content-encoding")) == "gzip", f"{len(b):,} bytes on the wire")
    s, _, b, _ = req(f"{api}/api/spectrum/test2/1/900?condition=clean")
    sp = json.loads(b)
    check("spectrum decodes", s == 200 and sp["present"] and len(sp["amp"]) > 400 and max(sp["amp"]) > 0, f"{len(sp['amp'])} bins")
    for name in ("heldout", "heldout_v1_0", "posthoc_tol4", "robustness", "deploy"):
        s, _, _, _ = req(f"{api}/api/results/{name}")
        check(f"result '{name}' available", s == 200)
    check("unknown run 404", req(f"{api}/api/replay/test9")[0] == 404)
    check("unknown result 404", req(f"{api}/api/results/secret")[0] == 404)
    check("index out of range 404", req(f"{api}/api/spectrum/test2/1/999999")[0] == 404)

    # CORS
    s, h, _, _ = req(f"{api}/api/analyze", "OPTIONS", headers={"Origin": origin, "Access-Control-Request-Method": "POST",
                                                                "Access-Control-Request-Headers": "content-type"})
    lh = {k.lower(): v for k, v in h.items()}
    check("CORS preflight allows the frontend origin", s == 200 and lh.get("access-control-allow-origin") == origin)
    s, h, _, _ = req(f"{api}/api/analyze", "OPTIONS", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    lh = {k.lower(): v for k, v in h.items()}
    check("CORS preflight refuses an unknown origin", s == 400 and "access-control-allow-origin" not in lh)

    # uploads
    raw = open(SAMPLE, "rb").read()
    body, hdr = multipart({"reference": "test2:1"}, "ims.txt", raw)
    lat, srv = [], []
    for i in range(12):
        s, _, b, ms = req(f"{api}/api/analyze", "POST", body, {**hdr, "Origin": origin})
        if i >= 2:
            lat.append(ms)
            srv.append(json.loads(b)["timing_ms"]["total"])
    res = json.loads(b)
    check("valid upload analysed", s == 200 and res["valid"] and res["evidence"]["family"] == "BPFO",
          f"verdict {res.get('verdict')}, server {res['timing_ms']['total']:.0f} ms")
    body, hdr = multipart({}, "bad.txt", b"hello world")
    check("malformed upload 422", req(f"{api}/api/analyze", "POST", body, hdr)[0] == 422)
    short = "\n".join("0.1" for _ in range(500)).encode()
    body, hdr = multipart({}, "short.csv", short)
    s, _, b, _ = req(f"{api}/api/analyze", "POST", body, hdr)
    check("too-short reading -> no verdict", s == 200 and json.loads(b)["verdict"] == "DATA_INSUFFICIENT")
    flat = "\n".join("0.0005\t-0.0004" for _ in range(20480)).encode()
    body, hdr = multipart({"reference": "test2:1"}, "flat.txt", flat)
    s, _, b, _ = req(f"{api}/api/analyze", "POST", body, hdr)
    check("machine-stopped reading -> no verdict", s == 200 and json.loads(b)["verdict"] == "DATA_INSUFFICIENT")
    check("oversized upload refused with 413 before the body is read", oversized_status(api) == 413)

    # frontend
    for path in ("/", "/demo/test3?b=3&t=6083", "/evaluation#diagnosis", "/data", "/analyze", "/no-such-page"):
        s, _, b, _ = req(f"{web}{path}")
        check(f"frontend {path} serves the app (direct URL)", s == 200 and b"<div id=\"root\">" in b)
    s, _, b, _ = req(f"{web}/samples/ims_test2_2004.02.19.05.42.39.txt")
    check("sample reading downloadable", s == 200 and len(b) == len(raw))

    rec = {
        "time": datetime.now(timezone.utc).isoformat(), "label": a.label, "api": api, "web": web,
        "build_commit": health.get("build_commit"), "config_sha": health.get("config_sha"),
        "artifact_bundle": health.get("artifact_bundle"), "uptime_s": health.get("uptime_s"),
        "analyze_round_trip_ms": {"median": round(statistics.median(lat), 1), "max": round(max(lat), 1), "n": len(lat),
                                  "note": "includes uploading the 0.55 MB reading over the verifying machine's own internet connection"},
        "analyze_server_ms": {"median": round(statistics.median(srv), 1), "max": round(max(srv), 1), "n": len(srv),
                              "note": "parse + validate + features + scoring inside the Railway container, as reported by the API"},
        "passed": sum(c["pass"] for c in checks), "failed": sum(not c["pass"] for c in checks), "checks": checks,
    }
    path = os.path.join(ROOT, "results", "deploy-verification.json")
    hist = json.load(open(path)) if os.path.exists(path) else []
    hist.append(rec)
    with open(path, "w") as fh:
        json.dump(hist, fh, indent=1)
    print(f"{rec['passed']} passed, {rec['failed']} failed; analyze server median {rec['analyze_server_ms']['median']} ms, "
          f"round trip median {rec['analyze_round_trip_ms']['median']} ms")
    raise SystemExit(1 if rec["failed"] else 0)


if __name__ == "__main__":
    main()
