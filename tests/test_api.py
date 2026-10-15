"""API contract tests, including failure paths."""
import json
import os

import pytest
from fastapi.testclient import TestClient

from server.app import app

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HAVE_ART = os.path.exists(os.path.join(ROOT, "artifacts", "runs.json"))
SAMPLE = os.path.join(ROOT, "web", "public", "samples", "ims_test2_2004.02.19.05.42.39.txt")
client = TestClient(app)
needs_art = pytest.mark.skipif(not HAVE_ART, reason="artifacts not built")


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["status"] in ("ok", "degraded")


@needs_art
def test_runs_and_replay_contract():
    runs = client.get("/api/runs").json()
    ids = {r["id"] for r in runs["runs"]}
    assert {"test2", "test3"} <= ids
    rep = client.get("/api/replay/test2?condition=clean").json()
    n = len(rep["times"])
    assert rep["precomputed"] is True and rep["config_sha"] == runs["config_sha"]
    for b in rep["bearings"].values():
        for det in ("tocsin", "b0_rms", "b1_iforest"):
            assert len(b["detectors"][det]["effective"]) == n
        assert len(b["valid"]) == n


@needs_art
def test_unknown_run_condition_and_index_fail_cleanly():
    assert client.get("/api/replay/test9?condition=clean").status_code == 404
    assert client.get("/api/replay/test2?condition=nope").status_code == 404
    assert client.get("/api/replay/..%2Fconfig?condition=clean").status_code in (400, 404)
    assert client.get("/api/spectrum/test2/1/999999?condition=clean").status_code == 404
    assert client.get("/api/spectrum/test2/9/0?condition=clean").status_code == 404
    assert client.get("/api/results/secret").status_code == 404


@needs_art
def test_spectrum_for_condition_that_only_drops_readings_falls_back_to_clean():
    r = client.get("/api/spectrum/test2/1/500?condition=loss30")
    assert r.status_code == 200 and r.json()["condition"] == "clean"


@needs_art
@pytest.mark.skipif(not os.path.exists(SAMPLE), reason="sample missing")
def test_analyze_real_file():
    with open(SAMPLE, "rb") as fh:
        r = client.post("/api/analyze", files={"file": ("s.txt", fh, "text/plain")}, data={"reference": "test2:1"})
    body = r.json()
    assert r.status_code == 200 and body["valid"]
    # Documented behaviour: against bearing 1's own reference, this late Test 2 reading has the
    # outer-race band strongest but just below the threshold (the v1 miss explained in the docs).
    assert body["evidence"]["family"] == "BPFO"
    assert 0 < body["score"] < body["threshold"]
    assert body["verdict"] == "BELOW_THRESHOLD"
    assert body["timing_ms"]["total"] < 2000
    assert len(body["spectrum"]["amp"]) > 100


@needs_art
def test_analyze_rejects_bad_input():
    assert client.post("/api/analyze", files={"file": ("x.txt", b"hello world", "text/plain")}).status_code == 422
    short = "\n".join("0.1" for _ in range(500)).encode()
    r = client.post("/api/analyze", files={"file": ("x.csv", short, "text/csv")})
    assert r.status_code == 200 and r.json()["verdict"] == "DATA_INSUFFICIENT"
    assert client.post("/api/analyze", files={"file": ("x.csv", short, "text/csv")}, data={"column": "5"}).status_code == 422
    assert client.post("/api/analyze", files={"file": ("x.csv", short, "text/csv")}, data={"reference": "zz:9"}).status_code == 422


def test_spa_fallback_and_api_404():
    assert client.get("/api/does-not-exist").status_code == 404
    import server.app as srv
    r = client.get("/demo/test2?b=1&t=10")
    root = client.get("/")
    if os.path.isdir(srv.WEB_DIST):
        # Local same-origin mode: direct URLs fall back to the SPA.
        assert r.status_code == 200 and "text/html" in r.headers["content-type"]
    else:
        # API-only mode (Railway): the root describes the service, other paths are 404 JSON.
        assert root.status_code == 200 and root.json()["service"] == "TOCSIN API"
        assert r.status_code == 404


def test_cors_allows_known_origin_and_preflight_but_not_others():
    ok = client.options("/api/analyze", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST",
                                                 "Access-Control-Request-Headers": "content-type"})
    assert ok.status_code == 200 and ok.headers["access-control-allow-origin"] == "http://localhost:5173"
    bad = client.options("/api/analyze", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert bad.status_code == 400 and "access-control-allow-origin" not in bad.headers
    simple = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in simple.headers


def test_upload_size_limit_rejected_before_parsing():
    big = b"0.1\n" * (3 * 1024 * 1024)  # ~12 MB
    r = client.post("/api/analyze", files={"file": ("big.txt", big, "text/plain")},
                    headers={"Origin": "http://localhost:5173"})
    assert r.status_code == 413 and "8 MB" in r.json()["detail"]
    # The size guard sits inside CORS: browsers must be able to read this
    # deliberate error rather than presenting it as a network failure.
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_health_is_503_when_artifacts_missing(tmp_path, monkeypatch):
    import server.app as srv
    monkeypatch.setattr(srv, "ARTIFACTS", str(tmp_path))
    srv.runs_index.cache_clear()
    srv.artifact_manifest.cache_clear()
    try:
        r = client.get("/api/health")
        assert r.status_code == 503 and r.json()["status"] == "not_ready"
    finally:
        srv.runs_index.cache_clear()
        srv.artifact_manifest.cache_clear()
