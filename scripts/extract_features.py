"""Stream an IMS run out of its RAR archive and compute per-snapshot features.

Usage:
  python scripts/extract_features.py test1 --bands 1000-9000,2000-8000,4000-9000 --conditions clean
  python scripts/extract_features.py test2 --bands <frozen> --conditions all --spectra clean,noise10,noise0,drop20

Writes data/work/features_<run>.npz and artifacts/spectra/<run>/<cond>__<band>.npy
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from multiprocessing import Pool

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tocsin import complications  # noqa: E402
from tocsin.archive import iter_members, list_members  # noqa: E402
from tocsin.bearing import IMS_NOMINAL_RPM, IMS_ZA2115  # noqa: E402
from tocsin.features import FeatureParams, display_spectrum, snapshot_features, time_features  # noqa: E402
from tocsin.ingest import IMS_FS, parse_ims_bytes, parse_ims_timestamp, validate_and_repair  # noqa: E402
from tocsin.runs import BEARINGS, RUNS  # noqa: E402

RAW = os.path.join(ROOT, "data", "raw")
WORK = os.path.join(ROOT, "data", "work")
N_REF_NOISE = 72  # reference window used to scale added noise (same as detector N)

_CTX: dict = {}


def _init(ctx):
    _CTX.update(ctx)


def _work(item):
    idx, name, raw = item
    run = _CTX["run"]
    chans = RUNS[run]["channels"]
    defect_hz = IMS_ZA2115.frequencies(IMS_NOMINAL_RPM)
    out = {"idx": idx, "parse_error": None, "rows": {}, "spectra": {}}
    try:
        data = parse_ims_bytes(raw)
    except ValueError as e:
        out["parse_error"] = str(e)
        return out
    for b in BEARINGS:
        col = chans[b]
        if col >= data.shape[1]:
            out["parse_error"] = f"missing column {col}"
            return out
        x0 = data[:, col]
        for cond in _CTX["conditions"]:
            x = complications.apply(cond, x0, run, b, idx, _CTX["ref_rms"].get(b))
            if x is None:
                out["rows"][(cond, b)] = {"valid": False, "reason": "reading never arrived", "missing_fraction": 1.0, "interpolated": 0, "feats": {}}
                continue
            clean, q = validate_and_repair(x, IMS_FS)
            row = {"valid": q.valid, "reason": "; ".join(q.reasons), "missing_fraction": q.missing_fraction,
                   "interpolated": q.interpolated, "feats": {}}
            if q.valid:
                for bk in _CTX["bands"]:
                    p = FeatureParams(band=bk, band_tol=_CTX["tol"]) if _CTX.get("tol") else FeatureParams(band=bk)
                    keep = cond in _CTX["spectra"]
                    f = snapshot_features(clean, IMS_FS, defect_hz, p, keep_spectrum=keep)
                    if keep:
                        fr, sp = display_spectrum(f.pop("_freqs"), f.pop("_spec"))
                        out["spectra"][(cond, p.key(), b)] = sp.astype(np.float16)
                        out["freqs"] = fr
                    row["feats"][p.key()] = f
            out["rows"][(cond, b)] = row
    return out


def reference_rms(archive: str, run: str) -> dict[int, float]:
    """Median clean RMS over the first N_REF_NOISE readings, per bearing (for noise scaling)."""
    vals = {b: [] for b in BEARINGS}
    for m, raw, _ in iter_members(archive, limit=N_REF_NOISE):
        data = parse_ims_bytes(raw)
        for b in BEARINGS:
            vals[b].append(time_features(data[:, RUNS[run]["channels"][b]])["rms"])
    return {b: float(np.median(v)) for b, v in vals.items()}


def _frozen_sha():
    path = os.path.join(ROOT, "config", "frozen.json")
    if not os.path.exists(path):
        return None
    with open(path) as fh:
        return json.load(fh).get("sha256")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run", choices=list(RUNS))
    ap.add_argument("--bands", required=True)
    ap.add_argument("--conditions", default="clean")
    ap.add_argument("--spectra", default="clean")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--tol", type=float, default=None, help="override band tolerance (post-hoc diagnostics only)")
    ap.add_argument("--tag", default="", help="suffix for output files, e.g. _tol4")
    args = ap.parse_args()

    run = args.run
    archive = os.path.join(RAW, RUNS[run]["archive"])
    bands = [tuple(float(v) for v in b.split("-")) for b in args.bands.split(",")]
    conditions = list(complications.CONDITIONS) if args.conditions == "all" else args.conditions.split(",")
    spectra_conds = [c for c in args.spectra.split(",") if c in conditions]
    band_keys = [FeatureParams(band=b).key() for b in bands]

    t0 = time.time()
    members = list_members(archive)
    if args.limit:
        members = members[: args.limit]
    n = len(members)
    names = [m.name for m in members]
    times = [parse_ims_timestamp(nm) for nm in names]
    print(f"[{run}] {n} members, {len(conditions)} conditions, bands {band_keys}", flush=True)

    ref_rms = reference_rms(archive, run) if any(c in complications.NOISE_SNR for c in conditions) else {}

    valid = {(c, b): np.zeros(n, bool) for c in conditions for b in BEARINGS}
    miss = {(c, b): np.zeros(n, np.float32) for c in conditions for b in BEARINGS}
    interp = {(c, b): np.zeros(n, np.int32) for c in conditions for b in BEARINGS}
    reasons = {(c, b): [""] * n for c in conditions for b in BEARINGS}
    feats: dict = {}
    spectra = {(c, bk): None for c in spectra_conds for bk in band_keys}
    sha = [""] * n
    parse_errors = {}
    freqs = None

    def items():
        for i, (m, raw, h) in enumerate(iter_members(archive, limit=args.limit)):
            sha[i] = h
            yield i, m.name, raw

    ctx = {"run": run, "conditions": conditions, "bands": bands, "spectra": spectra_conds, "ref_rms": ref_rms, "tol": args.tol}
    with Pool(args.workers, initializer=_init, initargs=(ctx,)) as pool:
        for k, res in enumerate(pool.imap(_work, items(), chunksize=4)):
            i = res["idx"]
            if res["parse_error"]:
                parse_errors[names[i]] = res["parse_error"]
                for c in conditions:
                    for b in BEARINGS:
                        reasons[(c, b)][i] = "file could not be parsed: " + res["parse_error"]
                        miss[(c, b)][i] = 1.0
                continue
            if "freqs" in res and freqs is None:
                freqs = res["freqs"]
            for (c, b), row in res["rows"].items():
                valid[(c, b)][i] = row["valid"]
                miss[(c, b)][i] = row["missing_fraction"]
                interp[(c, b)][i] = row["interpolated"]
                reasons[(c, b)][i] = row["reason"]
                for bk, f in row["feats"].items():
                    for fk, fv in f.items():
                        key = (c, bk, b, fk)
                        arr = feats.get(key)
                        if arr is None:
                            arr = feats[key] = np.full(n, np.nan)
                        arr[i] = fv
            for (c, bk, b), sp in res["spectra"].items():
                if spectra[(c, bk)] is None:
                    spectra[(c, bk)] = np.zeros((n, len(BEARINGS), sp.size), np.float16)
                spectra[(c, bk)][i, b - 1] = sp
            if (k + 1) % 200 == 0:
                print(f"  {k + 1}/{n}  {time.time() - t0:.0f}s", flush=True)

    # Archive order is not always chronological (Test 3 stores one file out of
    # place). Sort every per-reading array by timestamp before saving.
    order = np.argsort(np.array([t.isoformat() for t in times]), kind="stable")
    names = [names[i] for i in order]
    times = [times[i] for i in order]
    sha = [sha[i] for i in order]
    for key in list(valid):
        valid[key] = valid[key][order]
        miss[key] = miss[key][order]
        interp[key] = interp[key][order]
        reasons[key] = [reasons[key][i] for i in order]
    for key in list(feats):
        feats[key] = feats[key][order]
    for key, arr in spectra.items():
        if arr is not None:
            spectra[key] = arr[order]

    os.makedirs(WORK, exist_ok=True)
    out = {
        "names": np.array(names),
        "times": np.array([t.isoformat() for t in times]),
        "sha256": np.array(sha),
    }
    for (c, b), v in valid.items():
        out[f"valid/{c}/{b}"] = v
        out[f"missing/{c}/{b}"] = miss[(c, b)]
        out[f"interp/{c}/{b}"] = interp[(c, b)]
        out[f"reason/{c}/{b}"] = np.array(reasons[(c, b)])
    for (c, bk, b, fk), arr in feats.items():
        out[f"feat/{c}/{bk}/{b}/{fk}"] = arr
    np.savez_compressed(os.path.join(WORK, f"features_{run}{args.tag}.npz"), **out)

    spec_dir = os.path.join(ROOT, "artifacts", "spectra", run)
    if not spectra_conds:
        spectra = {}
    os.makedirs(spec_dir, exist_ok=True)
    for (c, bk), arr in spectra.items():
        if arr is not None:
            np.save(os.path.join(spec_dir, f"{c}__{bk}.npy"), arr)
    if freqs is not None:
        np.save(os.path.join(spec_dir, "freqs.npy"), freqs.astype(np.float32))

    meta = {
        "run": run, "archive": RUNS[run]["archive"], "n_files": n, "readme_files": RUNS[run]["readme_files"],
        "first": times[0].isoformat(), "last": times[-1].isoformat(), "conditions": conditions,
        "bands": band_keys, "spectra": spectra_conds, "ref_rms_for_noise": ref_rms,
        "parse_errors": parse_errors, "elapsed_s": round(time.time() - t0, 1),
        "config_sha": None if args.tol else _frozen_sha(),
        "band_tol_override": args.tol,
        "chronological": True,
    }
    with open(os.path.join(WORK, f"features_{run}{args.tag}.meta.json"), "w") as fh:
        json.dump(meta, fh, indent=2)
    print(json.dumps({k: meta[k] for k in ("run", "n_files", "first", "last", "elapsed_s")}), flush=True)
    print(f"parse errors: {len(parse_errors)}", flush=True)


if __name__ == "__main__":
    main()
