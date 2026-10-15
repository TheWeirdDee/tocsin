# Deployment

TOCSIN runs as two services: a static frontend on Vercel and one API service on Railway. Both deploy from GitHub `TheWeirdDee/tocsin`, branch `main`, on every push. Nothing needs a secret: the frontend holds only the public API address, and the API needs only its allowed origin.

## Ownership (established 15 Oct 2026 from the providers' authenticated APIs)

| | Frontend (Vercel) | API (Railway) |
|---|---|---|
| Account | Vercel user `theweirddee`, personal team "Divine's projects" (`divines-projects-36ae43d8`), role OWNER | The owner's Railway account (registered under a different email from Vercel/GitHub; confirmed by the owner on 15 Oct 2026), workspace "My Projects" |
| Project | `tocsin` | `gentle-mercy`, service `tocsin`, environment `production`, region `sfo` |
| Source | GitHub integration, `TheWeirdDee/tocsin`, production branch `main`, root `web` | GitHub `TheWeirdDee/tocsin`, branch `main`, Dockerfile via `railway.json` |
| How it deploys | Vercel Git integration (not the CLI, not Actions) | Railway GitHub integration |
| URL | https://tocsin-phi.vercel.app | https://tocsin-production.up.railway.app |
| Plan / credit | Hobby | Trial; $2.95 credit left, $0.05 used so far (15 Oct 2026). The API stops when the credit or trial runs out |
| Dashboard | https://vercel.com/divines-projects-36ae43d8/tocsin | Railway dashboard of the account that holds the project (link given to the owner privately) |

The Railway project predates TOCSIN (created 30 Sep 2026) and also holds an unrelated detached volume. It has not been touched.

Both services are therefore managed by the project owner; no transfer is needed. If the API ever has to move to another Railway account, a project transfer keeps its URL (the receiving workspace needs a Hobby or Pro plan; see [Railway: projects](https://docs.railway.com/projects)). A new service gets a new URL, and then Vercel `VITE_API_BASE` (followed by a frontend redeploy), `API_URL` in `.github/workflows/deployed-smoke.yml`, the API address in the README and `docs/SUBMISSION_FACTS.md`, and the default in `web/e2e/audit_repro.mjs` must all change.

## Configuration

Every variable below is read by the code (`server/app.py`, `web/vite.config.ts`, `web/src/lib/api.ts`, `scripts/fetch_artifacts.py`, `Dockerfile`). None is a secret.

| Variable | Service | Required? | Purpose | Public or secret | Actual value / source | When read; what applies a change | Safe default | How its effect is verified |
|---|---|---|---|---|---|---|---|---|
| `VITE_API_BASE` | Vercel | Yes, for the split deployment | API origin the browser calls | Public (compiled into the bundle) | `https://tocsin-production.up.railway.app`, set for Production, Preview and Development | Build time; a **frontend redeploy** applies it | Empty: same origin (works only when the API also serves the frontend) | `/version.json` `api_base`; the footer's API commit; browser suite |
| `VERCEL_GIT_COMMIT_SHA` | Vercel (system) | Provided | Frontend commit in `/version.json` and the footer | Public | Set by Vercel on Git deployments | Build time | Falls back to `git rev-parse HEAD` | `/version.json` `commit` equals the deployed commit |
| `TOCSIN_ALLOWED_ORIGINS` | Railway | Yes | CORS allow-list (comma-separated origins) | Public | `https://tocsin-phi.vercel.app` | Runtime; a **restart** applies it | Only localhost development origins, so a deployed frontend is refused | `verify_deployment.py`: preflight allowed for the frontend, refused for an unknown origin |
| `TOCSIN_CLIENT_IP_HEADER` | Railway | No | Header that carries the visitor's address for rate limiting | Public | Unset, so the default applies | Runtime; restart | `x-real-ip` when `RAILWAY_PUBLIC_DOMAIN` is set (Railway's edge sets it), otherwise none (peer address) | `/api/client-id` `source: header`; the deployed-smoke identity job |
| `RAILWAY_PUBLIC_DOMAIN` | Railway (system) | Provided | Signals the Railway edge, which selects the header default above | Public | Set by Railway | Runtime | n/a | as above |
| `RAILWAY_GIT_COMMIT_SHA` | Railway (system) | Provided | API commit in `/api/version` and `/api/health` | Public | Set by Railway | Runtime | `TOCSIN_BUILD_COMMIT`, then "unknown" | `/api/version` `build_commit` equals the deployed commit |
| `TOCSIN_BUILD_COMMIT` | API (non-Railway hosts) | No | Commit id where the platform provides none | Public | Unset | Runtime | none | `/api/version` |
| `PORT` | Railway (system) | Provided | Listening port | Public | Set by Railway; the Dockerfile defaults to 8000 | Container start | 8000 | Health check on `/api/health` |
| `TOCSIN_ANALYZE_RATE_PER_MIN` | Railway | No | Analyses per visitor per minute | Public | Unset | Runtime; restart | 30 | Local test (429 with `Retry-After`); not load-tested in public |
| `TOCSIN_ANALYZE_CONCURRENCY` | Railway | No | Analyses computed at once | Public | Unset | Runtime; restart | 2 | Local tests |
| `TOCSIN_ANALYZE_TIMEOUT_S` | Railway | No | Seconds before an analysis response gives up (504); its slot is held until the work ends | Public | Unset | Runtime; restart | 30 | Local test |
| `TOCSIN_ARTIFACTS` | API, scripts | No | Where the demo bundle lives | Public | Unset: `/app/artifacts`, filled at build by `scripts/fetch_artifacts.py` | Build (fetch) and runtime | `artifacts/` in the repository root | `/api/version` `consistent: true`; the build fails if any checksum differs from `config/artifacts.lock.json` |
| `TOCSIN_CONFIG`, `TOCSIN_RESULTS`, `TOCSIN_WEB` | API | No | Paths to the frozen config, results and a same-origin frontend build | Public | Unset (repository paths) | Runtime | Repository paths | `/api/version` `config_sha` |
| `OMP_NUM_THREADS`, `OPENBLAS_NUM_THREADS`, `MKL_NUM_THREADS` | API (Dockerfile) | Fixed | One numeric thread per analysis | Public | `1` in the Dockerfile | Container start | `1` | `results/deploy.json` single-core benchmark |

Not deployment variables: `TOCSIN_BSDTAR` (data pipeline only) and the `E2E_*` variables (test runs only).

Notes:

- **Preview deployments.** Vercel previews compile the same `VITE_API_BASE`, but the API allows only the production origin, so a preview's API calls are refused by CORS. That is deliberate: previews are not public entry points.
- **Proxy trust.** uvicorn runs with `--no-proxy-headers`, and `X-Forwarded-For` is never read. On Railway the visitor is identified by `X-Real-IP`, which Railway's edge sets and replaces if a client sends its own ([Railway specs and limits](https://docs.railway.com/networking/public-networking/specs-and-limits)). A missing, repeated or malformed value falls back to the peer address. That can only merge visitors into one bucket; it can never let one visitor escape the limit.
- **Vercel build.** Framework Vite, root `web`, install `npm ci`, build `npm run build` (type-check then Vite), output `dist`. `web/vercel.json` rewrites every path to `index.html`, so direct links and refreshes work, and makes hashed assets immutable.
- **Railway build.** `Dockerfile`: Python 3.12, dependencies, and the pinned artifact bundle fetched and checksum-verified at build time. It runs as a non-root user, with `uvicorn --host 0.0.0.0 --port $PORT --workers 1 --no-proxy-headers`. Health check `/api/health` (timeout 120 s), restart on failure, one replica.

## Verifying a deployment

After both services report the pushed commit, the `Deployed smoke` workflow runs on its own (or from the Actions tab). Its jobs are independent; the final gate fails if any of them failed:

1. **Versions.** The frontend and API serve the expected commit, and the config and artifact bundle agree.
2. **Deployment checks.** `scripts/verify_deployment.py`: health, artifacts, CORS, uploads, error codes and direct routes.
3. **Identity (TC-11).** The API identifies the runner by its real public address, and spoofed `X-Real-IP` / `X-Forwarded-For` values do not change it.
4. **Audit.** `web/e2e/audit_repro.mjs` plus `scripts/check_audit_deployed.py` judge all 12 audit findings.
5. **Browser.** The full browser suite against the live URLs, on desktop and phone.
