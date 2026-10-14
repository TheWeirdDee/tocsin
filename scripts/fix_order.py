"""One-off migration: put already-extracted readings in chronological order.

v1.0 processed readings in archive order. Test 3's archive stores one file
(2004.04.18.02.42.55) out of order. extract_features.py now sorts before
saving; this applies the identical permutation to existing outputs so the
50-minute extraction does not have to be repeated. Feature values are
unchanged; only their order (and the spectra rows) move.
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, "data", "work")


def main():
    for run in ("test1", "test2", "test3"):
        path = os.path.join(WORK, f"features_{run}.npz")
        meta_path = os.path.join(WORK, f"features_{run}.meta.json")
        with open(meta_path) as fh:
            meta = json.load(fh)
        if meta.get("chronological"):
            print(f"{run}: already chronological")
            continue
        with np.load(path, allow_pickle=False) as d:
            data = {k: d[k] for k in d.files}
        order = np.argsort(data["times"], kind="stable")
        moved = int((order != np.arange(order.size)).sum())
        n = order.size
        for k, v in data.items():
            if v.ndim >= 1 and v.shape[0] == n:
                data[k] = v[order]
        np.savez_compressed(path, **data)
        spec_dir = os.path.join(ROOT, "artifacts", "spectra", run)
        for fn in os.listdir(spec_dir):
            if fn.endswith(".npy") and fn != "freqs.npy":
                p = os.path.join(spec_dir, fn)
                arr = np.load(p)
                if arr.shape[0] == n:
                    np.save(p, arr[order])
        meta["chronological"] = True
        meta["reordered_positions"] = moved
        meta["last"] = str(data["times"][-1])
        with open(meta_path, "w") as fh:
            json.dump(meta, fh, indent=2)
        print(f"{run}: {moved} positions changed; last reading now {data['times'][-1]}")


if __name__ == "__main__":
    sys.exit(main())
