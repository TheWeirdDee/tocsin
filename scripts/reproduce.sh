#!/usr/bin/env sh
# Rebuild every number and artifact from the NASA archive. ~45 min on a laptop, ~1.2 GB disk.
set -eu
if [ -z "${PYTHON:-}" ]; then if [ -x .venv/bin/python ]; then PYTHON=.venv/bin/python; else PYTHON=python3; fi; fi
PY="$PYTHON"
$PY scripts/fetch_data.py
$PY scripts/extract_features.py test1 --bands 1000-9000,2000-8000,4000-9000 --spectra clean
$PY scripts/tune.py
BAND=$($PY -c "import json;print(json.load(open('config/frozen.json'))['band'])")
for RUN in test2 test3; do
  $PY scripts/extract_features.py $RUN --bands "$BAND" --conditions all --spectra clean,noise10,noise0,drop20
done
$PY scripts/evaluate.py
$PY scripts/build_artifacts.py
$PY scripts/manifest.py
$PY -m pytest -q tests
