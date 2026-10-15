export const STATE_NAMES = ['BASELINING', 'NORMAL', 'WATCH', 'ALERT', 'DATA_INSUFFICIENT'] as const
export type StateName = (typeof STATE_NAMES)[number]
export const S = { BASELINING: 0, NORMAL: 1, WATCH: 2, ALERT: 3, DATA_INSUFFICIENT: 4 } as const

export type Num = number | null

export interface FamilyRef { median: number; sigma: number }

export interface BearingMetrics {
  faulty: boolean
  n_snapshots: number
  n_valid: number
  monitored_hours: number
  alert_episodes: number
  alert_hours: number
  alert_fraction: Num
  alert_hours_per_day: number
  alerted: boolean
  first_alert: string | null
  lead_time_h: Num
  terminal_alert_lead_time_h: Num
  alert_active_at_end: boolean
  alert_episodes_last24h: number
  alert_episodes_before_last24h: number
  endpoint: string
  bearing: number
  run?: string
}

export interface Evidence {
  bearing: number | null
  subject?: string
  timestamp: string
  index?: number
  state: StateName
  family: string | null
  family_label: string | null
  defect_hz: Num
  peak_hz: Num
  current_prom_db: Num
  reference_prom_db: Num
  ratio_vs_reference: Num
  score: Num
  threshold: number
  score_over_threshold: Num
  persistence: { count: number; required: number; clear_count?: number }
  sentence: string
  config_sha?: string
}

export interface DetectorTrace {
  score: Num[]
  state: number[]
  effective: number[]
  counter?: number[]
  clear?: number[]
  family?: number[]
  z?: Record<string, Num[]>
  reference: Record<string, FamilyRef> | FamilyRef
}

export interface BearingReplay {
  faulty: boolean
  label: string | null
  valid: number[]
  missing: Num[]
  interpolated: number[]
  reasons: string[]
  reason: number[]
  features: Record<string, Num[]>
  detectors: { tocsin: DetectorTrace; b0_rms: DetectorTrace; b1_iforest: DetectorTrace }
  metrics: Record<string, BearingMetrics>
  alert_events: Evidence[]
}

export interface Replay {
  run: string
  label: string
  role: string
  condition: string
  condition_label: string
  precomputed: boolean
  generated: string
  config_sha: string
  version: string
  band: string
  k: number
  n_ref: number
  thresholds: { tocsin: number; b0_rms: number; b1_iforest: number }
  families: string[]
  family_labels: Record<string, string>
  defect_hz: Record<string, number>
  times: string[]
  bearings: Record<string, BearingReplay>
}

export interface RunMeta {
  id: string
  label: string
  role: string
  archive: string
  n_snapshots: number
  readme_files: number
  first: string
  last: string
  faulty: Record<string, string>
  readme: string
  channels: Record<string, number>
  conditions: { id: string; label: string }[]
  spectra_conditions: string[]
  spectra_same_as_clean: string[]
  parse_errors: number
}

export interface RunsIndex {
  generated: string
  version: string
  config_sha: string
  runs: RunMeta[]
  references: Record<string, Record<string, { label: string }>>
  spectrum_freqs: { f0: number; df: number; n: number } | null
  display_note: string
}

export interface BandMarker { family: string; label: string; harmonic: number; center: number; lo: number; hi: number }

export interface SpectrumResp {
  present: boolean
  f0: number
  df: number
  amp: number[]
  condition: string
}

export interface Summary {
  n_faulty: number
  n_healthy: number
  tp: number
  fn: number
  fp: number
  tn: number
  precision: Num
  recall: Num
  lead_times_h: number[]
  terminal_lead_times_h: number[]
  healthy_alert_episodes: number
  healthy_alert_episodes_excl_last24h: number
  healthy_alert_hours: number
  healthy_monitored_days: number
  healthy_alert_hours_per_bearing_day: Num
}
