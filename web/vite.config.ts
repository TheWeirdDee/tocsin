/// <reference types="vitest" />
import { execSync } from 'node:child_process'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Commit the bundle was built from: Vercel provides it; locally fall back to git.
function buildCommit(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA
  try {
    const head = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const dirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() !== ''
    return dirty ? `${head}+uncommitted` : head
  } catch {
    return 'dev'
  }
}
const COMMIT = buildCommit()

// Publish /version.json so the deployed frontend's commit can be checked without a browser.
function versionFile(): Plugin {
  return {
    name: 'tocsin-version-file',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ commit: COMMIT, api_base: process.env.VITE_API_BASE ?? '', built: new Date().toISOString() }, null, 1),
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), versionFile()],
  define: { __BUILD_COMMIT__: JSON.stringify(COMMIT) },
  server: {
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  // No proxy for `vite preview`: it must behave like the static Vercel deployment.
  preview: { proxy: {} },
  build: { sourcemap: false, chunkSizeWarningLimit: 600 },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
