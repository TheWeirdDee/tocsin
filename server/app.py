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

import json
import math
import os
import sys
import time
from functools import lru_cache

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
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
RESULT_FILES = {"heldout", "robustness", "sensitivity", "tuning_test1", "deploy", "manifest", "tests", "posthoc_tol4", "e2e"}
# Pre-registered v1.0 results are kept exactly as first computed.
RESULT_ALIASES = {"heldout_v1_0": os.path.join("v1.0_preregistered", "heldout.json"),
                  "robustness_v1_0": os.path.join("v1.0_preregistered", "robustness.json")}
STARTED = time.time()

app = FastAPI(title="TOCSIN API", version=__version__, docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_methods=["GET", "POST", "OPTIONS"],
                   allow_headers=["Content-Type"], allow_credentials=False, max_age=600)


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


@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...), sample_rate: float = Form(20000.0), rpm: float = Form(2000.0),
                  column: int = Form(0), reference: str = Form("test2:1")):
    """Run the frozen pipeline on one uploaded snapshot against a stored healthy reference."""
    t0 = time.perf_counter()
    raw = await file.read(MAX_UPLOAD + 1)
    if len(raw) > MAX_UPLOAD:
        raise HTTPException(413, "file larger than 8 MB")
    if not (100.0 <= sample_rate <= 200_000.0) or not (60.0 <= rpm <= 30_000.0):
        raise HTTPException(422, "sample_rate or rpm out of supported range")
    try:
        data = read_upload(raw, file.filename or "upload")
    except (ValueError, UnicodeDecodeError) as e:
        raise HTTPException(422, f"could not parse file: {e}")
    if not (0 <= column < data.shape[1]):
        raise HTTPException(422, f"column {column} not present (file has {data.shape[1]} columns)")
    t_parse = time.perf_counter()

    cfg = frozen()
    try:
        ref_run, ref_b = reference.split(":")
        ref = runs_index()["references"][ref_run][ref_b]
    except (ValueError, KeyError):
        raise HTTPException(422, "unknown reference; use e.g. 'test2:1'")

    rules = ValidationRules(**{**cfg["validation"], "expected_fs": sample_rate,
                               "expected_n": cfg["validation"]["expected_n"]})
    x, q = validate_and_repair(data[:, column], sample_rate, rules)
    speed_note = "speed as entered" if rpm != cfg["rpm_assumed"] else f"speed assumed {cfg['rpm_assumed']:.0f} RPM (rig nominal)"
    if x is None:
        return {"valid": False, "quality": q.to_dict(), "verdict": "DATA_INSUFFICIENT",
                "sentence": f"No verdict: {'; '.join(q.reasons)}.", "timing_ms": {"total": round((time.perf_counter() - t0) * 1000, 2)}}
    frac = cfg.get("low_signal_fraction")
    rms_now = float(np.sqrt(np.mean(x * x)))
    if frac and ref.get("rms_median") and rms_now < frac * ref["rms_median"]:
        pct = 100 * rms_now / ref["rms_median"]
        reason = f"signal level is {pct:.0f}% of the reference bearing's normal level (machine stopped or sensor disconnected)"
        return {"valid": False, "quality": {**q.to_dict(), "valid": False, "reasons": [reason]}, "verdict": "DATA_INSUFFICIENT",
                "sentence": f"No verdict: {reason}.", "timing_ms": {"total": round((time.perf_counter() - t0) * 1000, 2)}}
    defect_hz = IMS_ZA2115.frequencies(rpm)
    fp = cfg["feature_params"]
    params = FeatureParams(band=tuple(fp["band"]), filter_order=fp["filter_order"], harmonics=fp["harmonics"],
                           band_tol=fp["band_tol"], background_halfwidth_hz=fp["background_halfwidth_hz"],
                           env_max_hz=fp["env_max_hz"])
    f = snapshot_features(x, sample_rate, defect_hz, params, keep_spectrum=True)
    t_feat = time.perf_counter()
    fr, sp = display_spectrum(f.pop("_freqs"), f.pop("_spec"))
    fams = list(FAULT_FAMILIES)
    z = {fam: (f[f"{fam}_prom_db"] - ref["tocsin"][fam]["median"]) / ref["tocsin"][fam]["sigma"] for fam in fams}
    best = max(fams, key=lambda k: z[k] if math.isfinite(z[k]) else -1e9)
    score = z[best]
    theta = cfg["thetas"]["tocsin"]
    state = WATCH if score >= theta else NORMAL
    ev = evidence(1, file.filename or "upload", state, fams.index(best), score, theta, 1 if state == WATCH else 0,
                  cfg["k"], {fam: f[f"{fam}_prom_db"] for fam in fams}, ref["tocsin"], defect_hz,
                  peak_hz=f.get(f"{best}_h1_freq"), config_sha=cfg["sha256"])
    t_end = time.perf_counter()
    return {
        "valid": True,
        "quality": q.to_dict(),
        "reference": {"run": ref_run, "bearing": int(ref_b), "label": ref.get("label")},
        "speed_note": speed_note,
        "features": {k: _num(v) for k, v in f.items()},
        "z": {k: _num(v) for k, v in z.items()},
        "score": _num(score),
        "threshold": theta,
        "verdict": "ABOVE_THRESHOLD" if state == WATCH else "BELOW_THRESHOLD",
        "persistence_note": f"A single reading can reach WATCH at most; ALERT needs {cfg['k']} consecutive readings above threshold.",
        "evidence": ev,
        "spectrum": {"f0": float(fr[0]), "df": float(fr[1] - fr[0]), "amp": [round(float(v), 7) for v in sp]},
        "band_markers": _band_markers({**cfg, "defect_hz": defect_hz}),
        "timing_ms": {"parse": round((t_parse - t0) * 1000, 2), "features": round((t_feat - t_parse) * 1000, 2),
                      "total": round((t_end - t0) * 1000, 2)},
    }


# ---- static frontend with SPA fallback (direct URLs and refresh work) ----
@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    if path.startswith("api/"):
        return JSONResponse({"detail": "not found"}, status_code=404)
    if not os.path.isdir(WEB_DIST):
        # API-only deployment (Railway): the app itself is served by the frontend host.
        body = {"service": "TOCSIN API", "version": __version__, "health": "/api/health", "docs": "/api/docs"}
        return JSONResponse(body, status_code=200 if path == "" else 404)
    candidate = os.path.normpath(os.path.join(WEB_DIST, path))
    if candidate.startswith(os.path.normpath(WEB_DIST)) and os.path.isfile(candidate):
        headers = {"Cache-Control": "public, max-age=31536000, immutable"} if "/assets/" in candidate.replace("\\", "/") else {}
        return FileResponse(candidate, headers=headers)
    return FileResponse(os.path.join(WEB_DIST, "index.html"), headers={"Cache-Control": "no-cache"})
