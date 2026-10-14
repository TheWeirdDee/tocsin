import type { BandMarker, Replay, RunsIndex, SpectrumResp } from './types'

/**
 * Base URL of the TOCSIN API. Empty means same origin (local dev via the Vite proxy,
 * or the API serving the built frontend). In the Vercel deployment it is the public
 * Railway URL, set at build time through VITE_API_BASE. It contains no secrets.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '')
const u = (path: string) => `${API_BASE}${path}`

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(u(url), { signal })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError(0, 'The analysis server could not be reached. Check your connection and retry.')
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = body.detail ?? detail
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, String(detail))
  }
  return (await res.json()) as T
}

const cache = new Map<string, Promise<unknown>>()
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit) return hit as Promise<T>
  const p = load().catch((e) => {
    cache.delete(key)
    throw e
  })
  cache.set(key, p)
  return p
}

export interface FrozenConfig {
  sha256: string
  band: string
  k: number
  n_ref: number
  thetas: Record<string, number>
  rpm_assumed: number
  defect_hz: Record<string, number>
  band_markers: BandMarker[]
  feature_params: { band: number[]; band_tol: number; harmonics: number; background_halfwidth_hz: number }
  bearing: { name: string; n_rollers: number; pitch_diameter: number; roller_diameter: number; contact_angle_deg: number; source: string }
  validation: { max_missing_fraction: number; max_gap_samples: number; min_length_fraction: number; expected_n: number; expected_fs: number }
  frozen_at: string
}

export const api = {
  runs: () => cached('runs', () => getJson<RunsIndex>('/api/runs')),
  config: () => cached('config', () => getJson<FrozenConfig>('/api/config')),
  replay: (run: string, cond: string) =>
    cached(`replay/${run}/${cond}`, () => getJson<Replay>(`/api/replay/${encodeURIComponent(run)}?condition=${encodeURIComponent(cond)}`)),
  spectrum: (run: string, bearing: number, index: number, cond: string, signal?: AbortSignal) =>
    getJson<SpectrumResp>(`/api/spectrum/${run}/${bearing}/${index}?condition=${encodeURIComponent(cond)}`, signal),
  result: <T = unknown>(name: string) => cached(`result/${name}`, () => getJson<T>(`/api/results/${name}`)),
  health: () => getJson<{ status: string; version: string; config_sha: string }>('/api/health'),
}

export async function analyzeUpload(form: FormData): Promise<AnalyzeResult> {
  let res: Response
  try {
    res = await fetch(u('/api/analyze'), { method: 'POST', body: form })
  } catch {
    throw new ApiError(0, 'The analysis server could not be reached.')
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, body.detail ?? res.statusText)
  return body as AnalyzeResult
}

export interface AnalyzeResult {
  valid: boolean
  quality: { valid: boolean; n_samples: number; missing_fraction: number; longest_gap: number; interpolated: number; reasons: string[] }
  verdict: string
  sentence?: string
  reference?: { run: string; bearing: number; label: string }
  speed_note?: string
  features?: Record<string, number | null>
  z?: Record<string, number | null>
  score?: number | null
  threshold?: number
  persistence_note?: string
  evidence?: import('./types').Evidence
  spectrum?: { f0: number; df: number; amp: number[] }
  band_markers?: BandMarker[]
  timing_ms: Record<string, number>
}
