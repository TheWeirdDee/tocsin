# Response to the external audit (15 Oct 2026)

Every finding was reproduced independently before it was fixed:

- **Browser findings:** reproduced with `web/e2e/audit_repro.mjs` against the live site at commit `400a328`. Output: `results/audit/reproduction-before.json`.
- **API findings:** reproduced with direct HTTP calls against the live API.

Status of the fixes:

- **Local:** verified against a local build. The same script's output is in `results/audit/reproduction-after.json`, and the regression tests are listed in `docs/TEST_RESULTS.md`.
- **Deployed:** not verified yet. The fixes are not committed or deployed.

| ID | Kind | Reproduced? | Root cause | Correction | Regression test |
|---|---|---|---|---|---|
| TC-01 | Observed bug | Yes. `t=1.5` blanked the page (`TypeError … 'split'`) | The cursor was used as an array index without integer validation | The cursor is parsed to an integer and clamped. The URL is rewritten canonically. Unknown run, condition and bearing get explicit notices. An application error boundary keeps navigation and recovery available. The cursor follows back/forward | `audit.spec.ts` TC-01 (5 cursor values × refresh, unknown run/condition/bearing, back/forward), `decision.test.ts` |
| TC-02 | Observed bug | Yes. 1,000 Hz and 30,000 RPM returned HTTP 500 without a CORS header, shown as "server could not be reached" | Settings beyond the filter and envelope coverage produced non-finite features. The unhandled error bypassed CORS | Settings are validated before computing (supported configuration only; see TC-08) and non-finite features are rejected. Errors are structured (`code`, `detail`, `supported`). A catch-all inside the CORS layer turns unexpected errors into a JSON 500 that browsers can read. The UI shows the server's message | `test_audit_regressions.py` (4 configurations, 500-with-CORS); `audit.spec.ts` (message shown) |
| TC-03 | Observed bug | Yes. Reading 1 showed reference 6.1 dB, ratio 1.25× and score 1.2, and the priority list was score-ordered | The UI displayed reference-relative values computed with the full 72-reading reference before that reference existed | While a bearing is baselining: no score, reference, ratio, implicated band or trend; raw prominences and calibration progress are shown instead. The trend chart draws nothing before the reference exists. Ordering is neutral by bearing number | `audit.spec.ts` TC-03; `decision.test.ts` |
| TC-04 | Observed bug | Yes. Column 3 against the bearing 4 reference said "Bearing 1" | Hard-coded bearing identifier | The sentence names "Uploaded reading (column N)". The reference is shown separately, and every result carries an immutable input summary | `test_audit_regressions.py`; `audit.spec.ts` |
| TC-05 | Observed bug | Yes. The result stayed current-looking after inputs changed | No link between a result and its inputs | Results store their input snapshot. Any change shows "Previous result. The inputs have changed" and dims the result | `audit.spec.ts` |
| TC-06 | Observed bug | Yes. Test 3 selected while Test 2 data was shown | The replay was not keyed to the request | Data is only shown for the request key that loaded it, with a loading state in between. Failures show an alert with Retry even when older data exists | `audit.spec.ts` (delayed and failed loads) |
| TC-07 | Observed bug | Yes. "Band prominence now" was shown with retained values | Labels assumed the current reading was valid | A "last valid measurement" note with timestamp and age. Labels read "(last valid)" | `audit.spec.ts` TC-07 |
| TC-08 | Source-level concern | Confirmed in code | Any sample rate or RPM was accepted and compared with IMS references | The API accepts only the references' acquisition configuration (20 kHz, 2000 RPM) and rejects others with a structured reason. The UI shows these as fixed values with a scope note. It distinguishes "parseable", "computable" and "scientifically supported" | `test_audit_regressions.py`; `audit.spec.ts` |
| TC-09 | Inferred, confirmed worse than inferred | Yes. **Zero** spectrum requests in 2.5 s at 16 readings/s, while the label said "This reading" | A 90 ms debounce was cancelled on every playback step | A throttled request pump (200 ms) that always fetches the latest wanted reading. The label names the reading shown ("updating to reading N" while catching up) | `audit.spec.ts` TC-09 |
| TC-10 | Inferred, confirmed worse than inferred | Yes. A TSV with empty cells was rejected, and the fast IMS path **silently shifted** values when empty fields balanced out | Whitespace splitting drops empty fields | The fast path defers to a delimiter-aware parser whenever empty tab fields appear. Empty cells become NaN in place. Inconsistent field counts are rejected | `test_audit_regressions.py` |
| TC-11 | Source-level concern | Confirmed in code. No rate limit; CPU work ran on the event loop | | Per-client sliding-window rate limit (default 30/min, 429 with `Retry-After`), a concurrency cap (default 2) with a 10 s wait limit, analysis in a worker thread, and a 30 s response timeout (504). A timed-out analysis keeps its concurrency slot until its worker finishes, so timeouts cannot stack unbounded work; input is capped at two readings' worth of rows before analysis starts. Behind Railway's proxy the client is the right-most `X-Forwarded-For` entry (the one the proxy appends); entries a client adds itself are ignored, and uvicorn runs with `--no-proxy-headers`. No load test was run against the public service | `test_audit_regressions.py` (slot held after 504, spoofed forwarded entries, rate limit not bypassed by forwarded headers, over-long input rejected) |
| TC-12 | Observed documentation issue | Yes | Mixed interpreters | Every command uses `.venv/bin/python`; there are separate Windows instructions; `reproduce.sh` defaults to the venv | Manual review |

## Verification status

Labels: **Agent-verified locally** (checked by the AI coding agent on the build machine), **Agent-verified on deployment** (checked by the agent against the public URLs), **Independently verified** (checked by someone other than the agent), **Still unverified**.

| ID | Agent-verified locally | Agent-verified on deployment | Independently verified |
|---|---|---|---|
| TC-01 to TC-10, TC-12 | Yes (tests above; logs in `results/test-logs/`) | Still unverified (fixes not deployed) | Still unverified |
| TC-11 | Yes, in-process and on a local server | Still unverified. The proxy hop count must be confirmed on Railway: `GET /api/client-id` must give the same hash from two requests with different spoofed `X-Forwarded-For` values | Still unverified |

None of the findings is marked closed by an independent party.

## Other audit points addressed

- **Absolute missing-data claim:** replaced with "When a reading fails the supported quality checks, TOCSIN withholds a verdict instead of treating missing data as normal."
- **Playback interval wording:** the fixed "every 10 min" was replaced by the actual time since the previous reading.
- **Frontend version:** the commit is embedded at build time. It is shown in the footer next to the API commit, flagged when the two differ, and published at `/version.json`.
- **Deployed browser smoke:** `.github/workflows/deployed-smoke.yml` runs after a Vercel production deployment, or on demand. It checks that `/version.json` and `/api/health` report the deployed commit, then runs the desktop browser suite against the live URLs.
- **Architecture document:** now describes both spectrum encodings (float16 locally, 8-bit in the release bundle).
- **Product framing:** the replay is presented as "Explore an example". `docs/PRODUCT_GAP.md` assesses the manual-upload monitoring workflow, with scope and acceptance criteria. It has not been implemented.

## Not changed

- Frozen thresholds, the calibration policy, historical results and evaluation artifacts are all unchanged.
- The missed failure, the inferior detection count, the better-performing simpler variant and the post-hoc labels remain prominent on the landing and results pages.

## Follow-up hardening (realignment pass)

- **TC-05:** a request sequence guard stops an older analysis response from overwriting a newer one.
- **TC-10:** tests now cover leading, trailing, repeated and middle empty fields in both TSV and CSV.
- **TC-11:** public 500 responses carry no paths or tracebacks (tested). The rate limit was confirmed on a local server: the benchmark hit 429 until its own limit was raised.
- **TC-12:** a clean-environment run (new venv from `requirements-dev.txt`, bundle fetched from the GitHub release, full tests) is logged in `results/test-logs/clean_environment.txt`.
- **Version record:** `GET /api/version` returns the app version, build commit, config hash, artifact bundle and a consistency flag.
