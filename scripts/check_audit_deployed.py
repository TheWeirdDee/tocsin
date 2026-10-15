"""Check all 12 external-audit findings against a deployed TOCSIN, read-only.

  node web/e2e/audit_repro.mjs <web> results/audit/reproduction-deployed.json <api>
  python scripts/check_audit_deployed.py --api https://<api> --web https://<frontend> \
      --repro results/audit/reproduction-deployed.json [--expect-ip-sha <12 hex>] [--out results/audit/deployed-check.json]

Browser findings (TC-01, 03, 05, 06, 07, 09) are judged from the reproduction script's output.
API findings (TC-02, 04, 08, 10, 11) are checked with a handful of ordinary requests; the rate
limit itself is not exercised on the public service (it is tested locally), so this sends no load.
TC-12 is a documentation finding and is checked against the repository files.

--expect-ip-sha is the first 12 hex characters of SHA-256 of the caller's public address. When
given, TC-11 also checks that the deployment identifies this caller by its real address. It
checks one caller only; separating different visitors needs this run from two networks.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLE = os.path.join(ROOT, "web", "public", "samples", "ims_test2_2004.02.19.05.42.39.txt")


def request(url, method="GET", body=None, headers=None):
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()
    except OSError as e:  # network failure or timeout: reported as a failed check, not a crash
        return 0, {}, json.dumps({"code": "network_error", "detail": str(e)}).encode()


def analyze(api, raw, filename="ims.txt", origin=None, **fields):
    boundary = uuid.uuid4().hex
    parts = []
    for k, v in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
                 f"Content-Type: text/plain\r\n\r\n".encode() + raw + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    if origin:
        headers["Origin"] = origin
    status, h, body = request(f"{api}/api/analyze", "POST", b"".join(parts), headers)
    try:
        data = json.loads(body)
    except ValueError:
        data = {}
    return status, {k.lower(): v for k, v in h.items()}, data


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", required=True)
    ap.add_argument("--web", required=True)
    ap.add_argument("--repro", required=True)
    ap.add_argument("--expect-ip-sha")
    ap.add_argument("--out", default=os.path.join(ROOT, "results", "audit", "deployed-check.json"))
    a = ap.parse_args()
    api, web = a.api.rstrip("/"), a.web.rstrip("/")
    repro = json.load(open(a.repro, encoding="utf-8"))
    checks = []

    def check(tc, name, ok, detail=""):
        checks.append({"finding": tc, "check": name, "pass": bool(ok), "detail": detail})
        print(f"{'PASS' if ok else 'FAIL'}  {tc}  {name}  {detail}")

    # TC-01: malformed cursors render a usable, canonical page without errors
    for t, want in {"1.5": "t=1", "-4": "t=0", "abc": "t=0", "99999": "t=6323"}.items():
        r = repro["tc01"][t]
        check("TC-01", f"cursor {t}", r["usable"] and r["url"].endswith(want) and not r["pageErrors"], r["url"].split("?")[-1])

    # TC-03: no reference-relative evidence during calibration; neutral order
    ev, pr = repro["tc03"]["evidenceText"] or "", repro["tc03"]["priorityText"] or ""
    leaked = [w for w in ("Healthy reference", "Ratio to reference", "Score vs threshold", "Implicated band") if w in ev]
    check("TC-03", "calibration evidence has no reference values", not leaked and "Calibration" in ev, ", ".join(leaked))
    check("TC-03", "calibration order is by bearing number", pr.find("Bearing 1") < pr.find("Bearing 2") < pr.find("Bearing 3") < pr.find("Bearing 4"))

    # TC-05: a result whose inputs changed is flagged
    check("TC-05", "stale result is flagged", repro["tc05"]["staleWarning"])

    # TC-06: switching runs never shows the previous run under the new name
    t6 = repro["tc06"]
    check("TC-06", "new run selected, old data not shown under it", t6["selected"] == "test3" and "Test 3" in (t6["priorityHeader"] or ""), f"time shown: {t6['shownTime']}")

    # TC-07: retained values are labelled as the last valid measurement
    ev7 = repro["tc07"]["evidenceText"] or ""
    check("TC-07", "retained values labelled last valid", "No valid data" in ev7 and "last valid" in ev7)

    # TC-09: spectrum keeps up with playback and names its reading
    t9 = repro["tc09"]
    check("TC-09", "spectrum requested during playback", t9["spectrumRequestsDuring2_5sPlay"] > 0, f"{t9['spectrumRequestsDuring2_5sPlay']} requests in 2.5 s")
    check("TC-09", "spectrum label names the reading shown", "reading" in (t9["specDuring"] or "").lower())

    raw = open(SAMPLE, "rb").read()
    # TC-02 / TC-08: unsupported settings get a structured 422 that a browser can read
    for rate, rpm in ((1000, 2000), (20000, 30000)):
        s, h, d = analyze(api, raw, origin=web, sample_rate=rate, rpm=rpm)
        check("TC-02/TC-08", f"{rate} Hz, {rpm} RPM refused with reason", s == 422 and d.get("code") == "unsupported_configuration"
              and h.get("access-control-allow-origin") == web, f"HTTP {s} {d.get('code')}")

    # TC-04: the sentence names the upload, not a hard-coded bearing
    s, h, d = analyze(api, raw, column=3, reference="test2:4")
    sent = (d.get("evidence") or {}).get("sentence", "")
    check("TC-04", "sentence names the uploaded column", s == 200 and sent.startswith("Uploaded reading (column 3):") and "Bearing 1" not in sent, sent[:60])

    # TC-10: empty tab-separated cells stay in place; ragged rows are refused, not shifted
    rows = [ln.split() for ln in raw.decode().splitlines() if ln.strip()]
    tsv = ["\t".join(r[:2]) for r in rows]
    for i in range(100, 140):
        tsv[i] = "\t" + rows[i][1]
    s, h, d = analyze(api, "\n".join(tsv).encode(), filename="gaps.tsv", column=0)
    q = d.get("quality") or {}
    check("TC-10", "empty cells become a 40-sample gap in place", s == 200 and q.get("longest_gap") == 40
          and (d.get("inputs") or {}).get("n_columns") == 2, f"HTTP {s} gap {q.get('longest_gap')}")
    tsv[5] = "0.1\t\t0.2"
    s, h, d = analyze(api, "\n".join(tsv).encode(), filename="ragged.tsv", column=0)
    check("TC-10", "inconsistent rows refused", s == 422, f"HTTP {s} {d.get('code')}")

    # TC-11: identity comes from the edge-set header; caller-supplied headers cannot change it
    ids = []
    for hdr in ({}, {"X-Forwarded-For": "203.0.113.7"}, {"X-Real-IP": "203.0.113.8"},
                {"X-Real-IP": "203.0.113.9", "X-Forwarded-For": "198.51.100.9, 192.0.2.1"}):
        s, h, body = request(f"{api}/api/client-id", headers=hdr)
        ids.append(json.loads(body) if s == 200 else {"http": s})
    hashes = {i.get("client_hash") for i in ids}
    check("TC-11", "identity taken from the edge header", all(i.get("source") == "header" for i in ids), json.dumps(ids[0]))
    check("TC-11", "spoofed X-Forwarded-For / X-Real-IP do not change identity", len(hashes) == 1,
          f"{len(hashes)} distinct identities from 4 requests")
    spoof = {hashlib.sha256(x.encode()).hexdigest()[:12] for x in ("203.0.113.7", "203.0.113.8", "203.0.113.9")}
    check("TC-11", "identity is not a spoofed value", not (hashes & spoof))
    if a.expect_ip_sha:
        check("TC-11", "identity is this caller's real address", hashes == {a.expect_ip_sha}, f"expected {a.expect_ip_sha}")

    # TC-12: one interpreter throughout the documented commands
    readme = open(os.path.join(ROOT, "README.md"), encoding="utf-8").read()
    repro_sh = open(os.path.join(ROOT, "scripts", "reproduce.sh"), encoding="utf-8").read()
    check("TC-12", "README uses the project venv and has Windows commands", ".venv/bin/python" in readme and ".venv\\Scripts\\python" in readme)
    check("TC-12", "reproduce.sh defaults to the venv", ".venv" in repro_sh)

    failed = [c for c in checks if not c["pass"]]
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump({"api": api, "web": web, "repro_time": repro.get("time"), "passed": len(checks) - len(failed),
                   "failed": len(failed), "checks": checks}, fh, indent=1)
    print(f"{len(checks) - len(failed)} passed, {len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
