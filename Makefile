# Entry points for the commands documented in the README. Python defaults to the project venv.
PYTHON ?= $(if $(wildcard .venv/bin/python),.venv/bin/python,python3)

.PHONY: reproduce artifacts test

# Rebuild every number and artifact from the NASA archive (~45 min, ~1.2 GB disk, needs bsdtar).
reproduce:
	PYTHON=$(PYTHON) sh scripts/reproduce.sh

# Fetch the pinned demo bundle from the GitHub release and verify every checksum.
artifacts:
	$(PYTHON) scripts/fetch_artifacts.py

# Python tests (needs the demo bundle: run `make artifacts` first on a fresh clone).
test:
	$(PYTHON) -m pytest -q tests
