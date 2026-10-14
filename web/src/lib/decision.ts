/**
 * Current-state decisions for the replay, read from the precomputed causal
 * pipeline output. Nothing here re-scores data; it only reads index <= t.
 */
import { hoursBetween } from './format'
import type { BearingReplay, Evidence, Replay, StateName } from './types'
import { S, STATE_NAMES } from './types'

export interface BearingNow {
  bearing: number
  shown: StateName // state of this reading (may be DATA_INSUFFICIENT)
  effective: StateName // last valid state, what the operator should act on
  stale: boolean
  lastValidIdx: number
  lastValidAgeH: number | null
  score: number | null // last valid TOCSIN score
  ratio: number | null // score / threshold
  family: string | null
  counter: number
  clear: number
  trendPerHour: number | null
  dataNote: string | null
  baselineRemaining: number
  rms: StateName
  iforest: StateName
}

const RANK: Record<StateName, number> = { ALERT: 4, WATCH: 3, NORMAL: 1, BASELINING: 0, DATA_INSUFFICIENT: 0 }

function lastValid(b: BearingReplay, t: number): number {
  for (let i = t; i >= 0; i--) if (b.valid[i]) return i
  return -1
}

/** Least-squares slope of TOCSIN score per hour over the last `n` valid readings up to t. */
export function trendPerHour(r: Replay, b: BearingReplay, t: number, n = 6): number | null {
  const xs: number[] = []
  const ys: number[] = []
  for (let i = t; i >= 0 && xs.length < n; i--) {
    const s = b.detectors.tocsin.score[i]
    if (b.valid[i] && s != null && b.detectors.tocsin.state[i] !== S.BASELINING) {
      xs.push(hoursBetween(r.times[0], r.times[i]))
      ys.push(s)
    }
  }
  if (xs.length < 3) return null
  const mx = xs.reduce((a, v) => a + v, 0) / xs.length
  const my = ys.reduce((a, v) => a + v, 0) / ys.length
  let num = 0
  let den = 0
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    den += (xs[i] - mx) ** 2
  }
  return den > 1e-9 ? num / den : null
}

export function bearingNow(r: Replay, bid: string, t: number): BearingNow {
  const b = r.bearings[bid]
  const tr = b.detectors.tocsin
  const lv = lastValid(b, t)
  const shown = STATE_NAMES[tr.state[t]]
  const effective = STATE_NAMES[tr.effective[t]]
  const score = lv >= 0 ? tr.score[lv] : null
  const famIdx = lv >= 0 && tr.family ? tr.family[lv] : -1
  let validSeen = 0
  for (let i = 0; i <= t; i++) validSeen += b.valid[i]
  return {
    bearing: Number(bid),
    shown,
    effective,
    stale: shown === 'DATA_INSUFFICIENT',
    lastValidIdx: lv,
    lastValidAgeH: lv >= 0 ? hoursBetween(r.times[lv], r.times[t]) : null,
    score,
    ratio: score != null ? score / r.thresholds.tocsin : null,
    family: famIdx >= 0 ? r.families[famIdx] : null,
    counter: tr.counter?.[t] ?? 0,
    clear: tr.clear?.[t] ?? 0,
    trendPerHour: trendPerHour(r, b, t),
    dataNote: !b.valid[t] ? b.reasons[b.reason[t]] || 'reading failed validation' : null,
    baselineRemaining: Math.max(0, r.n_ref - validSeen),
    rms: STATE_NAMES[b.detectors.b0_rms.effective[t]],
    iforest: STATE_NAMES[b.detectors.b1_iforest.effective[t]],
  }
}

/** Inspection priority: state of last valid reading first, then score relative to threshold. */
export function priorityOrder(items: BearingNow[]): BearingNow[] {
  return [...items].sort((a, b) => {
    const ra = RANK[a.effective]
    const rb = RANK[b.effective]
    if (ra !== rb) return rb - ra
    return (b.ratio ?? -Infinity) - (a.ratio ?? -Infinity)
  })
}

const fmt = (x: number | null | undefined, nd = 1) => (x == null || !Number.isFinite(x) ? 'n/a' : x.toFixed(nd))

/** Mirror of tocsin/explain.py::sentence, built from the same structured fields. */
export function evidenceAt(r: Replay, bid: string, t: number): Evidence {
  const b = r.bearings[bid]
  const now = bearingNow(r, bid, t)
  const i = now.lastValidIdx
  const fam = now.family
  const ref = fam ? (b.detectors.tocsin.reference as Record<string, { median: number }>)[fam]?.median ?? null : null
  const cur = fam && i >= 0 ? b.features[`${fam}_prom_db`]?.[i] ?? null : null
  const ratio = cur != null && ref != null ? 10 ** ((cur - ref) / 20) : null
  const state: StateName = now.shown === 'DATA_INSUFFICIENT' ? 'DATA_INSUFFICIENT' : now.effective
  const ev: Evidence = {
    bearing: now.bearing,
    timestamp: r.times[t],
    index: t,
    state,
    family: fam,
    family_label: fam ? r.family_labels[fam] : null,
    defect_hz: fam ? r.defect_hz[fam] : null,
    peak_hz: fam && i >= 0 ? b.features[`${fam}_h1_freq`]?.[i] ?? null : null,
    current_prom_db: cur,
    reference_prom_db: ref,
    ratio_vs_reference: ratio,
    score: now.score,
    threshold: r.thresholds.tocsin,
    score_over_threshold: now.ratio,
    persistence: { count: now.counter, required: r.k, clear_count: now.clear },
    sentence: '',
    config_sha: r.config_sha,
  }
  ev.sentence = sentence(ev, now.dataNote, now.effective)
  return ev
}

export function sentence(ev: Evidence, dataNote: string | null = null, lastValidState?: StateName): string {
  const b = ev.bearing
  if (ev.state === 'BASELINING') return `Bearing ${b}: learning this bearing's healthy reference; no alerts are possible yet.`
  if (ev.state === 'DATA_INSUFFICIENT') {
    const keep = lastValidState && lastValidState !== 'DATA_INSUFFICIENT' ? ` The last valid state, ${lastValidState}, is kept.` : ' The previous state is kept.'
    return `Bearing ${b}: no verdict for this reading because ${dataNote ?? 'the reading failed validation'}.${keep}`
  }
  const famLabel = ev.family_label ?? 'defect'
  const band = `${famLabel} band (${fmt(ev.defect_hz, 0)} Hz)`
  let level = `${band} stands ${fmt(ev.current_prom_db)} dB above its local background versus ${fmt(ev.reference_prom_db)} dB in this bearing's healthy reference`
  if (ev.ratio_vs_reference != null) level += ` (${fmt(ev.ratio_vs_reference)}× the reference)`
  const p = ev.persistence
  if (ev.state === 'ALERT' && (p.clear_count ?? 0) > 0)
    return `Bearing ${b}: alert still active. ${level}, now below the threshold for ${p.clear_count} of ${p.required} readings needed to clear it.`
  if (ev.state === 'ALERT')
    return `Bearing ${b}: ${level}, at or above the alert threshold for ${p.count} consecutive readings (needs ${p.required}). Prioritize inspection of this bearing.`
  if (ev.state === 'WATCH')
    return `Bearing ${b}: ${level}. Above threshold for ${p.count} of ${p.required} readings; it becomes an alert if it holds for ${p.required - p.count} more.`
  return `Bearing ${b}: no defect band is above its threshold. Strongest: ${level}.`
}
