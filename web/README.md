# TOCSIN frontend

React + TypeScript (Vite). See the repository [README](../README.md) for the product, results and deployment.

```bash
npm ci
npm run dev          # http://localhost:5173, proxies /api to http://127.0.0.1:8000
npm run build        # -> dist/
npx vitest run       # unit tests
npx playwright test  # end-to-end (starts the API from the repo root)
```

`VITE_API_BASE`: public URL of the TOCSIN API (for example the Railway service). Leave it empty for same-origin use. It is embedded in the client bundle, so it must never hold a secret.
