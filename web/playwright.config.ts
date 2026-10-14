import { defineConfig, devices } from '@playwright/test'

const PORT = 8001
const CROSS = process.env.E2E_CROSS_ORIGIN === '1'
const PY = process.platform === 'win32' ? String.raw`.venv\Scripts\python.exe` : '.venv/bin/python'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: CROSS ? '../results/e2e-cross-origin.json' : '../results/e2e.json' }]],
  use: { baseURL: CROSS ? 'http://127.0.0.1:4173' : `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  // E2E_CROSS_ORIGIN=1 reproduces the production split: the built frontend on one origin
  // (vite preview, :4173, built with VITE_API_BASE=http://127.0.0.1:8001) calling the API on another.
  webServer: [
    {
      command: `${PY} -m uvicorn server.app:app --port ${PORT}`,
      cwd: '..',
      url: `http://127.0.0.1:${PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    ...(CROSS
      ? [{ command: 'npx vite preview --port 4173 --strictPort --host 127.0.0.1', url: 'http://127.0.0.1:4173', reuseExistingServer: false, timeout: 60_000 }]
      : []),
  ],
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 }, hasTouch: true } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
})
