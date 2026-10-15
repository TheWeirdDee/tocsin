"""Regression tests for the external audit findings (TC-02, TC-04, TC-08, TC-10, TC-11)."""
import os

import numpy as np
import pytest
from fastapi.testclient import TestClient

import server.app as srv
from tocsin.ingest import parse_ims_bytes, read_upload

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLE = os.path.join(ROOT, "web", "public", "samples", "ims_test2_2004.02.12.10.32.39.txt")
HAVE = os.path.exists(os.path.join(srv.ARTIFACTS, "runs.json")) and os.path.exists(SAMPLE)
needs = pytest.mark.skipif(not HAVE, reason="artifacts or sample missing")
ORIGIN = "http://localhost:5173"
client = TestClient(srv.app)


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    srv._rate.clear()
    yield
    srv._rate.clear()


def _post(**data):
    with open(SAMPLE, "rb") as fh:
        return client.post("/api/analyze", files={"file": ("ims.txt", fh, "text/plain")},
                           data={k: str(v) for k, v in data.items()}, headers={"Origin": ORIGIN})


@needs
@pytest.mark.parametrize("rate,rpm", [(1000, 2000), (20000, 30000), (20000, 2500), (25600, 2000)])
def test_tc02_tc08_unsupported_settings_are_structured_422_with_cors(rate, rpm):
    r = _post(sample_rate=rate, rpm=rpm)
    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "unsupported_configuration"
    assert body["supported"] == {"sample_rate": 20000.0, "rpm": 2000.0}
    assert r.headers.get("access-control-allow-origin") == ORIGIN


@needs
def test_tc02_supported_settings_still_analyse():
    r = _post(sample_rate=20000, rpm=2000)
    assert r.status_code == 200 and r.json()["valid"]


@needs
def test_tc02_unexpected_errors_return_json_500_with_cors(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("simulated failure")
    monkeypatch.setattr(srv, "_analyze_sync", boom)
    r = TestClient(srv.app, raise_server_exceptions=False).post(
        "/api/analyze", files={"file": ("x.txt", b"1\n", "text/plain")}, headers={"Origin": ORIGIN})
    assert r.status_code == 500 and r.json()["code"] == "internal_error"
    assert r.headers.get("access-control-allow-origin") == ORIGIN


@needs
def test_tc04_sentence_names_the_upload_not_a_hardcoded_bearing():
    r = _post(column=3, reference="test2:4").json()
    assert r["reference"]["bearing"] == 4
    assert r["evidence"]["sentence"].startswith("Uploaded reading (column 3):")
    assert "Bearing 1" not in r["evidence"]["sentence"]
    assert r["inputs"]["column"] == 3 and r["inputs"]["reference"] == "test2:4"


def test_tc10_tab_separated_empty_cells_keep_their_position():
    raw = b"0.1\t0.2\r\n\t0.3\r\n0.4\t\r\n"
    a = read_upload(raw, "gaps.tsv")
    assert a.shape == (3, 2)
    assert np.isnan(a[1, 0]) and a[1, 1] == pytest.approx(0.3)
    assert a[2, 0] == pytest.approx(0.4) and np.isnan(a[2, 1])
    # repeated tabs create an extra field: rejected, never silently shifted
    with pytest.raises(ValueError):
        read_upload(b"0.1\t0.2\n0.5\t\t0.3\n", "bad.tsv")


def test_tc10_csv_and_ims_paths_unchanged():
    a = read_upload(b"0.1,0.2\n,0.3\n", "x.csv")
    assert np.isnan(a[1, 0])
    assert parse_ims_bytes(b"-0.022\t-0.039\r\n0.1\t0.2\r\n").shape == (2, 2)


@needs
def test_tc11_rate_limit_returns_429_with_retry_after(monkeypatch):
    monkeypatch.setattr(srv, "ANALYZE_RATE_PER_MIN", 2)
    assert _post().status_code == 200
    assert _post().status_code == 200
    r = _post()
    assert r.status_code == 429 and r.json()["code"] == "rate_limited"
    assert int(r.headers["Retry-After"]) > 0
    assert r.headers.get("access-control-allow-origin") == ORIGIN


def test_tc11_analysis_runs_off_the_event_loop():
    import inspect
    src = inspect.getsource(srv.analyze)
    assert "run_in_executor" in src and "_analyze_slots" in src


def test_version_record_reports_consistent_config_and_bundle():
    v = client.get("/api/version").json()
    assert v["app_version"] and v["config_sha"]
    if HAVE:
        assert v["consistent"] is True and v["artifact_bundle"].startswith("tocsin-demo-artifacts")


def test_public_errors_do_not_leak_paths_or_tracebacks(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError(r"C:\secret\path traceback")
    monkeypatch.setattr(srv, "_analyze_sync", boom)
    r = TestClient(srv.app, raise_server_exceptions=False).post("/api/analyze", files={"file": ("x.txt", b"1\n", "text/plain")})
    assert r.status_code == 500 and "secret" not in r.text and "Traceback" not in r.text


def test_tc10_consistent_empty_middle_fields_are_kept_as_missing():
    a = read_upload(b"0.1\t0.2\t0.3\n0.4\t\t0.6\n", "x.tsv")
    assert a.shape == (2, 3) and np.isnan(a[1, 1]) and a[1, 2] == pytest.approx(0.6)
    c = read_upload(b"1,2,3\n4,,6\n,8,\n", "x.csv")
    assert np.isnan(c[1, 1]) and np.isnan(c[2, 0]) and np.isnan(c[2, 2])


@needs
def test_tc11_timed_out_analysis_keeps_its_slot_until_the_work_finishes(monkeypatch):
    """One event loop for the whole scenario, so worker threads are observed while still running."""
    import asyncio
    import threading
    import httpx
    release = threading.Event()
    real = srv._analyze_sync

    def slow(*a, **k):
        release.wait(10)
        return real(*a, **k)

    monkeypatch.setattr(srv, "_analyze_sync", slow)
    monkeypatch.setattr(srv, "ANALYZE_TIMEOUT_S", 0.3)
    raw = open(SAMPLE, "rb").read()
    monkeypatch.setattr(srv, "_analyze_slots", asyncio.Semaphore(srv.ANALYZE_CONCURRENCY))  # fresh, restored after the test

    async def scenario():
        pass
        before = srv._analyze_slots._value
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=srv.app), base_url="http://t") as c:
            r = await c.post("/api/analyze", files={"file": ("ims.txt", raw, "text/plain")})
            assert r.status_code == 504 and r.json()["code"] == "timeout"
            # answered, but the worker is still running: its slot is still held
            assert srv._inflight["count"] == 1
            assert srv._analyze_slots._value == before - 1
            release.set()
            for _ in range(100):
                if srv._inflight["count"] == 0:
                    break
                await asyncio.sleep(0.05)
            assert srv._inflight["count"] == 0
            assert srv._analyze_slots._value == before

    try:
        asyncio.run(scenario())
    finally:
        release.set()


def test_tc11_client_identity_ignores_spoofed_forwarded_entries(monkeypatch):
    from starlette.requests import Request

    def req(xff, peer="10.0.0.5"):
        headers = [(b"x-forwarded-for", xff.encode())] if xff is not None else []
        return Request({"type": "http", "headers": headers, "client": (peer, 1234), "method": "GET", "path": "/"})

    monkeypatch.setattr(srv, "TRUSTED_PROXY_HOPS", 1)
    assert srv.client_id(req("203.0.113.7")) == "203.0.113.7"
    # a client cannot choose its identity by prepending entries: the proxy-appended one wins
    assert srv.client_id(req("1.1.1.1, 203.0.113.7")) == "203.0.113.7"
    assert srv.client_id(req("9.9.9.9, 8.8.8.8, 203.0.113.7")) == "203.0.113.7"
    assert srv.client_id(req(None)) == "10.0.0.5"
    monkeypatch.setattr(srv, "TRUSTED_PROXY_HOPS", 0)
    # without a trusted proxy, forwarded headers are ignored completely
    assert srv.client_id(req("1.1.1.1", peer="198.51.100.2")) == "198.51.100.2"


@needs
def test_tc11_rate_limit_cannot_be_dodged_with_forwarded_headers(monkeypatch):
    monkeypatch.setattr(srv, "ANALYZE_RATE_PER_MIN", 2)
    monkeypatch.setattr(srv, "TRUSTED_PROXY_HOPS", 1)
    codes = []
    for i in range(3):
        with open(SAMPLE, "rb") as fh:
            r = client.post("/api/analyze", files={"file": ("ims.txt", fh, "text/plain")},
                            headers={"X-Forwarded-For": f"10.9.9.{i}, 203.0.113.7"})
        codes.append(r.status_code)
    assert codes == [200, 200, 429]


@needs
def test_tc11_over_long_readings_are_rejected_before_analysis():
    big = ("0.1\n" * (2 * 20480 + 1)).encode()
    r = client.post("/api/analyze", files={"file": ("long.csv", big, "text/csv")})
    assert r.status_code == 422 and r.json()["code"] == "too_long"
