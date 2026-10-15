"""TOCSIN API (and, when built locally, the static frontend).

Read-only endpoints serve precomputed, versioned analysis artifacts (generated
by scripts/build_artifacts.py from the real pipeline). POST /api/analyze runs
the full pipeline live on an uploaded snapshot.

Deployment: the frontend is served by Vercel and calls this API cross-origin.
Allowed origins come from TOCSIN_ALLOWED_ORIGINS (comma-separated); local dev
origins are always allowed. /api/health returns 503 until the config and the
artifact bundle are present and agree on the config hash.
"""
from __future__ import annotations

import asyncio
import json
import math
import os
import sys
import time
from collections import defaultdict, deque
from functools import lru_cache

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tocsin import __version__  # noqa: E402
from tocsin.bearing import FAULT_FAMILIES, IMS_ZA2115  # noqa: E402
from tocsin.explain import evidence  # noqa: E402
from tocsin.features import FeatureParams, display_spectrum, snapshot_features  # noqa: E402
from tocsin.ingest import ValidationRules, read_upload, validate_and_repair  # noqa: E402
from tocsin.spectra_codec import decode as decode_spectrum  # noqa: E402
from tocsin.state import ALERT, NORMAL, WATCH  # noqa: E402

ARTIFACTS = os.environ.get("TOCSIN_ARTIFACTS", os.path.join(ROOT, "artifacts"))
RESULTS = os.environ.get("TOCSIN_RESULTS", os.path.join(ROOT, "results"))
CONFIG = os.environ.get("TOCSIN_CONFIG", os.path.join(ROOT, "config", "frozen.json"))
WEB_DIST = os.environ.get("TOCSIN_WEB", os.path.join(ROOT, "web", "dist"))
MAX_UPLOAD = 8 * 1024 * 1024  # file bytes
MAX_BODY = MAX_UPLOAD + 64 * 1024  # multipart overhead allowance
DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173", "http://127.0.0.1:4173"]
ALLOWED_ORIGINS = DEV_ORIGINS + [o.strip().rstrip("/") for o in os.environ.get("TOCSIN_ALLOWED_ORIGINS", "").split(",") if o.strip()]
BUILD_COMMIT = os.environ.get("RAILWAY_GIT_COMMIT_SHA") or os.environ.get("TOCSIN_BUILD_COMMIT")
RESULT_FILES = {"heldout", "robustness", "sensitivity", "tuning_test1", "deploy", "manifest", "tests", "posthoc_tol4", "e2e",
                "derived_metrics", "robustness_examples", "deploy-verification"}
# Pre-registered v1.0 results are kept exactly as first computed.
RESULT_ALIASES = {"heldout_v1_0": os.path.join("v1.0_preregistered", "heldout.json"),
                  "robustness_v1_0": os.path.join("v1.0_preregistered", "robustness.json")}
STARTED = time.time()

app = FastAPI(title="TOCSIN API", version=__version__, docs_url="/api/docs", openapi_url="/api/openapi.json")
class CatchAll:
    """Turn unexpected exceptions into a JSON 500 *inside* the CORS layer, so browsers can read it."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        started = False

        async def send_wrapper(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            import logging
            logging.getLogger("tocsin").exception("unhandled error on %s", scope.get("path"))
            if not started:
                resp = JSONResponse({"detail": "Internal error while processing the request.", "code": "internal_error"},
                                    status_code=500)
                await resp(scope, receive, send)


app.add_middleware(CatchAll)
app.add_middleware(GZipMiddleware, minimum_size=1024)


class BodyLimit:
    """Reject oversized uploads before they are parsed (Content-Length required for POST)."""

    def __init__(self, app, limit: int):
        self.app, self.limit = app, limit

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["method"] == "POST":
            headers = dict(scope.get("headers") or [])
            length = headers.get(b"content-length")
            status, msg = None, None
            if length is None:
                status, msg = 411, "Content-Length header is required for uploads"
            elif not length.isdigit() or int(length) > self.limit:
                status, msg = 413, f"upload larger than {MAX_UPLOAD // (1024 * 1024)} MB"
            if status:
                resp = JSONResponse({"detail": msg}, status_code=status)
                await resp(scope, receive, send)
                return
        await self.app(scope, receive, send)


app.add_middleware(BodyLimit, limit=MAX_BODY)
# Middleware is applied in reverse registration order.  Keep CORS outermost so
# browser clients can read every deliberate error response, including the
# request-size guard above.
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_methods=["GET", "POST", "OPTIONS"],
                   allow_headers=["Content-Type"], allow_credentials=False, max_age=600)


def _safe(name: str) -> str:
    if not name.replace("_", "").replace("-", "").isalnum():
        raise HTTPException(400, "invalid identifier")
    return name


@lru_cache(maxsize=1)
def frozen() -> dict:
    with open(CONFIG) as fh:
        return json.load(fh)


@lru_cache(maxsize=1)
def runs_index() -> dict:
    with open(os.path.join(ARTIFACTS, "runs.json")) as fh:
        return json.load(fh)


@lru_cache(maxsize=8)
def _spectra(run: str, cond: str, band: str) -> np.ndarray:
    path = os.path.join(ARTIFACTS, "spectra", run, f"{cond}__{band}.npy")
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    return np.load(path, mmap_mode="r")


@lru_cache(maxsize=1)
def artifact_manifest() -> dict | None:
    path = os.path.join(ARTIFACTS, "ARTIFACT_MANIFEST.json")
    if not os.path.exists(path):
        return None
    with open(path) as fh:
        return json.load(fh)


def readiness() -> tuple[bool, list[str]]:
    problems = []
    if not os.path.exists(CONFIG):
        problems.append("frozen config missing")
    if not os.path.exists(os.path.join(ARTIFACTS, "runs.json")):
        problems.append("artifact bundle missing (runs.json)")
    if not problems:
        cfg_sha = frozen().get("sha256")
        if runs_index().get("config_sha") != cfg_sha:
            problems.append("artifact bundle was built with a different config")
        man = artifact_manifest()
        if man is not None and man.get("config_sha") != cfg_sha:
            problems.append("artifact manifest config hash does not match the frozen config")
    return not problems, problems


def _band_markers(cfg: dict) -> list[dict]:
    fp = cfg["feature_params"]
    out = []
    for fam, label in FAULT_FAMILIES.items():
        f0 = cfg["defect_hz"][fam]
        for h in range(1, fp["harmonics"] + 1):
            c = h * f0
            out.append({"family": fam, "label": label, "harmonic": h, "center": round(c, 2),
                        "lo": round(c * (1 - fp["band_tol"]), 2), "hi": round(c * (1 + fp["band_tol"]), 2)})
    return out


@app.get("/api/health")
def health():
    ok, problems = readiness()
    man = artifact_manifest() if ok else None
    body = {"status": "ok" if ok else "not_ready", "version": __version__,
            "config_sha": frozen().get("sha256") if os.path.exists(CONFIG) else None,
            "artifacts": ok, "artifact_bundle": man.get("bundle") if man else None,
            "build_commit": BUILD_COMMIT, "problems": problems, "uptime_s": round(time.time() - STARTED, 1)}
    return JSONResponse(body, status_code=200 if ok else 503)


@app.get("/api/version")
def version():
    """One record of what is running: code, configuration and data bundle."""
    cfg = frozen() if os.path.exists(CONFIG) else {}
    man = artifact_manifest() if os.path.exists(os.path.join(ARTIFACTS, "ARTIFACT_MANIFEST.json")) else None
    try:
        runs_sha = runs_index().get("config_sha")
    except FileNotFoundError:
        runs_sha = None
    return {"app_version": __version__, "build_commit": BUILD_COMMIT, "config_sha": cfg.get("sha256"),
            "config_version": cfg.get("version"), "artifact_bundle": man.get("bundle") if man else None,
            "artifact_config_sha": runs_sha, "consistent": bool(cfg) and runs_sha == cfg.get("sha256")}


@app.get("/api/runs")
def runs():
    try:
        return runs_index()
    except FileNotFoundError:
        raise HTTPException(503, "analysis artifacts are not built on this server")


@app.get("/api/config")
def config():
    cfg = dict(frozen())
    cfg["band_markers"] = _band_markers(cfg)
    return cfg


@app.get("/api/replay/{run}")
def replay(run: str, condition: str = "clean"):
    run, condition = _safe(run), _safe(condition)
    path = os.path.join(ARTIFACTS, "replay", run, f"{condition}.json")
    if not os.path.exists(path):
        raise HTTPException(404, f"no precomputed analysis for run '{run}' under condition '{condition}'")
    return FileResponse(path, media_type="application/json", headers={"Cache-Control": "public, max-age=3600"})


@app.get("/api/spectrum/{run}/{bearing}/{index}")
def spectrum(run: str, bearing: int, index: int, condition: str = "clean"):
    run, condition = _safe(run), _safe(condition)
    idx = runs_index()
    meta = next((r for r in idx["runs"] if r["id"] == run), None)
    if meta is None:
        raise HTTPException(404, "unknown run")
    if condition not in meta["spectra_conditions"]:
        # Conditions that only remove readings leave valid readings unchanged.
        if condition in meta.get("spectra_same_as_clean", []):
            condition = "clean"
        else:
            raise HTTPException(404, f"spectra not stored for condition '{condition}'")
    try:
        arr = _spectra(run, condition, frozen()["band"])
    except FileNotFoundError:
        raise HTTPException(503, "spectra artifact missing")
    if not (1 <= bearing <= arr.shape[1]) or not (0 <= index < arr.shape[0]):
        raise HTTPException(404, "index out of range")
    amp = decode_spectrum(np.asarray(arr[index, bearing - 1]))
    present = bool(np.any(amp != 0))
    return {"run": run, "bearing": bearing, "index": index, "condition": condition, "present": present,
            "f0": idx["spectrum_freqs"]["f0"], "df": idx["spectrum_freqs"]["df"],
            "amp": [float(f"{v:.4g}") for v in amp] if present else []}


@app.get("/api/results/{name}")
def results(name: str):
    name = _safe(name)
    if name in RESULT_ALIASES:
        path = os.path.join(RESULTS, RESULT_ALIASES[name])
    elif name in RESULT_FILES:
        path = os.path.join(RESULTS, f"{name}.json")
    else:
        raise HTTPException(404, "unknown result")
    if not os.path.exists(path):
        raise HTTPException(404, f"result '{name}' has not been generated")
    return FileResponse(path, media_type="application/json")


def _num(x):
    if x is None:
        return None
    x = float(x)
    return round(x, 4) if math.isfinite(x) else None


# The frozen detector's references were learned from IMS readings recorded at
# 20 kHz and 2000 RPM (20,480 samples). Comparing a reading taken under other
# acquisition settings with those references is not supported, even when the
# signal processing itself could be computed.
SUPPORTED = {"sample_rate": 20_000.0, "rpm": 2_000.0}
ANALYZE_CONCURRENCY = int(os.environ.get("TOCSIN_ANALYZE_CONCURRENCY", "2"))
ANALYZE_RATE_PER_MIN = int(os.environ.get("TOCSIN_ANALYZE_RATE_PER_MIN", "30"))
ANALYZE_TIMEOUT_S = float(os.environ.get("TOCSIN_ANALYZE_TIMEOUT_S", "30"))
MAX_READING_ROWS = 2 * 20_480  # bounds the work per request (the supported reading is 20,480 samples)
# Client identity for rate limiting. Behind Railway's edge proxy the peer address is the proxy,
# so the client is the right-most X-Forwarded-For entry (the one the proxy appended). Entries
# further left are supplied by the client and are ignored, so they cannot be used to dodge the
# limit. Locally (no proxy) the peer address is used and X-Forwarded-For is ignored entirely.
TRUSTED_PROXY_HOPS = int(os.environ.get("TOCSIN_TRUSTED_PROXY_HOPS", "1" if os.environ.get("RAILWAY_PUBLIC_DOMAIN") else "0"))
_analyze_slots = asyncio.Semaphore(ANALYZE_CONCURRENCY)
_inflight = {"count": 0}  # analyses still computing in worker threads, including abandoned ones
_rate: dict[str, deque] = defaultdict(deque)


class AnalyzeProblem(Exception):
    def __init__(self, status: int, code: str, message: str, **extra):
        super().__init__(message)
        self.status, self.code, self.message, self.extra = status, code, message, extra


def _problem(status: int, code: str, message: str, **extra) -> JSONResponse:
    return JSONResponse({"detail": message, "code": code, **extra}, status_code=status)


def client_id(request: Request) -> str:
    peer = request.client.host if request.client else "unknown"
    if TRUSTED_PROXY_HOPS <= 0:
        return peer
    xff = request.headers.get("x-forwarded-for", "")
    parts = [p.strip() for p in xff.split(",") if p.strip()]
    return parts[-TRUSTED_PROXY_HOPS] if len(parts) >= TRUSTED_PROXY_HOPS else peer


def _rate_limited(client: str) -> float | None:
    """Sliding one-minute window per client address; returns seconds to wait, or None."""
    now = time.monotonic()
    q = _rate[client]
    while q and now - q[0] > 60.0:
        q.popleft()
    if len(q) >= ANALYZE_RATE_PER_MIN:
        return 60.0 - (now - q[0])
    q.append(now)
    if len(_rate) > 10_000:  # bound memory: forget idle clients
        for k in [k for k, v in _rate.items() if not v]:
            del _rate[k]
    return None


def _analyze_sync(raw: bytes, filename: str, sample_rate: float, rpm: float, column: int, reference: str) -> dict:
    t0 = time.perf_counter()
    if not (math.isfinite(sample_rate) and math.isfinite(rpm)):
        raise AnalyzeProblem(422, "invalid_number", "sample_rate and rpm must be finite numbers")
    if sample_rate != SUPPORTED["sample_rate"] or rpm != SUPPORTED["rpm"]:
        raise AnalyzeProblem(
            422, "unsupported_configuration",
            f"Unsupported configuration ({sample_rate:g} Hz, {rpm:g} RPM). The stored healthy references were recorded "
            f"at {SUPPORTED['sample_rate']:g} Hz and {SUPPORTED['rpm']:g} RPM on the IMS ZA-2115 rig, so readings taken "
            "under other settings cannot be compared with them.",
            supported=SUPPORTED)
    cfg = frozen()
    try:
        ref_run, ref_b = reference.split(":")
        ref = runs_index()["references"][ref_run][ref_b]
    except (ValueError, KeyError):
        raise AnalyzeProblem(422, "unknown_reference", "Unknown reference; use for example 'test2:1'.")
    try:
        data = read_upload(raw, filename)
    except (ValueError, UnicodeDecodeError) as e:
        raise AnalyzeProblem(422, "unparseable_file", f"Could not parse the file: {e}")
    if data.shape[0] > MAX_READING_ROWS:
        raise AnalyzeProblem(422, "too_long", f"The reading has {data.shape[0]:,} samples; at most {MAX_READING_ROWS:,} are accepted "
                             f"(the supported reading is 20,480 samples).")
    if not (0 <= column < data.shape[1]):
        raise AnalyzeProblem(422, "missing_column", f"Column {column} is not present (the file has {data.shape[1]} columns).")
    t_parse = time.perf_counter()
    inputs = {"filename": filename, "bytes": len(raw), "sample_rate": sample_rate, "rpm": rpm, "column": column,
              "reference": reference, "n_samples": int(data.shape[0]), "n_columns": int(data.shape[1])}
    ref_info = {"run": ref_run, "bearing": int(ref_b), "label": ref.get("label")}
    subject = f"Uploaded reading (column {column})"

    rules = ValidationRules(**{**cfg["validation"], "expected_fs": sample_rate})
    x, q = validate_and_repair(data[:, column], sample_rate, rules)
    if x is None:
        return {"valid": False, "inputs": inputs, "reference": ref_info, "quality": q.to_dict(), "verdict": "DATA_INSUFFICIENT",
                "sentence": f"{subject}: no verdict. {'; '.join(q.reasons).capitalize()}.",
                "timing_ms": {"total": round((time.perf_counter() - t0) * 1000, 2)}}
    frac = cfg.get("low_signal_fraction")
    rms_now = float(np.sqrt(np.mean(x * x)))
    if frac and ref.get("rms_median") and rms_now < frac * ref["rms_median"]:
        pct = 100 * rms_now / ref["rms_median"]
        reason = f"signal level is {pct:.0f}% of the reference bearing's normal level (machine stopped or sensor disconnected)"
        return {"valid": False, "inputs": inputs, "reference": ref_info,
                "quality": {**q.to_dict(), "valid": False, "reasons": [reason]}, "verdict": "DATA_INSUFFICIENT",
                "sentence": f"{subject}: no verdict. The {reason}.", "timing_ms": {"total": round((time.perf_counter() - t0) * 1000, 2)}}
    defect_hz = IMS_ZA2115.frequencies(rpm)
    fp = cfg["feature_params"]
    params = FeatureParams(band=tuple(fp["band"]), filter_order=fp["filter_order"], harmonics=fp["harmonics"],
                           band_tol=fp["band_tol"], background_halfwidth_hz=fp["background_halfwidth_hz"],
                           env_max_hz=fp["env_max_hz"])
    f = snapshot_features(x, sample_rate, defect_hz, params, keep_spectrum=True)
    t_feat = time.perf_counter()
    fr, sp = display_spectrum(f.pop("_freqs"), f.pop("_spec"))
    fams = list(FAULT_FAMILIES)
    if not all(math.isfinite(f[f"{fam}_prom_db"]) for fam in fams):
        raise AnalyzeProblem(422, "not_computable", "The defect-band features could not be computed for this reading.")
    z = {fam: (f[f"{fam}_prom_db"] - ref["tocsin"][fam]["median"]) / ref["tocsin"][fam]["sigma"] for fam in fams}
    best = max(fams, key=lambda k: z[k])
    score = z[best]
    theta = cfg["thetas"]["tocsin"]
    state = WATCH if score >= theta else NORMAL
    ev = evidence(None, filename, state, fams.index(best), score, theta, 1 if state == WATCH else 0,
                  cfg["k"], {fam: f[f"{fam}_prom_db"] for fam in fams}, ref["tocsin"], defect_hz,
                  peak_hz=f.get(f"{best}_h1_freq"), config_sha=cfg["sha256"], subject=subject)
    t_end = time.perf_counter()
    return {
        "valid": True,
        "inputs": inputs,
        "quality": q.to_dict(),
        "reference": ref_info,
        "speed_note": f"speed assumed {cfg['rpm_assumed']:.0f} RPM (IMS rig nominal)",
        "features": {k: _num(v) for k, v in f.items()},
        "z": {k: _num(v) for k, v in z.items()},
        "score": _num(score),
        "threshold": theta,
        "verdict": "ABOVE_THRESHOLD" if state == WATCH else "BELOW_THRESHOLD",
        "persistence_note": f"A single reading can reach WATCH at most; ALERT needs {cfg['k']} consecutive readings above threshold.",
        "evidence": ev,
        "spectrum": {"f0": float(fr[0]), "df": float(fr[1] - fr[0]), "amp": [float(f"{v:.4g}") for v in sp]},
        "band_markers": _band_markers({**cfg, "defect_hz": defect_hz}),
        "timing_ms": {"parse": round((t_parse - t0) * 1000, 2), "features": round((t_feat - t_parse) * 1000, 2),
                      "total": round((t_end - t0) * 1000, 2)},
    }


@app.post("/api/analyze")
async def analyze(request: Request, file: UploadFile = File(...), sample_rate: float = Form(20000.0),
                  rpm: float = Form(2000.0), column: int = Form(0), reference: str = Form("test2:1")):
    """Run the frozen pipeline on one uploaded reading against a stored healthy reference.

    Supported configuration only (see SUPPORTED). CPU work runs in a worker thread,
    at most ANALYZE_CONCURRENCY at a time, with a per-client rate limit.
    """
    wait = _rate_limited(client_id(request))
    if wait is not None:
        resp = _problem(429, "rate_limited", f"Too many analyses from this address; retry in {math.ceil(wait)} s.")
        resp.headers["Retry-After"] = str(math.ceil(wait))
        return resp
    raw = await file.read(MAX_UPLOAD + 1)
    if len(raw) > MAX_UPLOAD:
        return _problem(413, "too_large", f"upload larger than {MAX_UPLOAD // (1024 * 1024)} MB")
    try:
        await asyncio.wait_for(_analyze_slots.acquire(), timeout=10.0)
    except asyncio.TimeoutError:
        return _problem(503, "busy", "The analysis service is busy; retry shortly.")
    # The worker thread cannot be killed, so the concurrency slot is released when the work
    # actually finishes, not when the client is answered. A timed-out analysis therefore keeps
    # its slot until it completes; the bounded input size keeps that completion finite.
    loop = asyncio.get_running_loop()
    _inflight["count"] += 1

    def _done(_fut):
        _inflight["count"] -= 1
        _analyze_slots.release()

    fut = loop.run_in_executor(None, _analyze_sync, raw, file.filename or "upload", sample_rate, rpm, column, reference)
    fut.add_done_callback(_done)
    try:
        return await asyncio.wait_for(asyncio.shield(fut), timeout=ANALYZE_TIMEOUT_S)
    except AnalyzeProblem as p:
        return _problem(p.status, p.code, p.message, **p.extra)
    except asyncio.TimeoutError:
        return _problem(504, "timeout", "Analysis took too long and was abandoned; its capacity is freed when it finishes.")


@app.get("/api/client-id")
def client_identity(request: Request):
    """Diagnostic for rate-limit identity: a short hash, never the address itself."""
    import hashlib
    cid = client_id(request)
    return {"client_hash": hashlib.sha256(cid.encode()).hexdigest()[:12], "trusted_proxy_hops": TRUSTED_PROXY_HOPS,
            "forwarded_entries": len([p for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()])}


# ---- static frontend with SPA fallback (direct URLs and refresh work) ----
@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    if path.startswith("api/"):
        return JSONResponse({"detail": "not found"}, status_code=404)
    if not os.path.isdir(WEB_DIST):
        # API-only deployment (Railway): the app itself is served by the frontend host.
        body = {"service": "TOCSIN API", "version": __version__, "health": "/api/health", "docs": "/api/docs"}
        return JSONResponse(body, status_code=200 if path == "" else 404)
    web_root = os.path.abspath(WEB_DIST)
    candidate = os.path.abspath(os.path.normpath(os.path.join(web_root, path)))
    # `startswith` is not a directory-boundary check: a sibling named
    # `dist-private` would share the `dist` prefix.  commonpath rejects it.
    inside_root = os.path.commonpath([web_root, candidate]) == web_root
    if inside_root and os.path.isfile(candidate):
        headers = {"Cache-Control": "public, max-age=31536000, immutable"} if "/assets/" in candidate.replace("\\", "/") else {}
        return FileResponse(candidate, headers=headers)
    return FileResponse(os.path.join(WEB_DIST, "index.html"), headers={"Cache-Control": "no-cache"})
