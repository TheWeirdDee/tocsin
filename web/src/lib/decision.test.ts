import { describe, expect, it } from 'vitest'
import { bearingNow, clampCursor, evidenceAt, parseCursor, priorityOrder, referenceReadyIndex, sentence } from './decision'
import type { Replay } from './types'

// Minimal synthetic replay: 8 readings, n_ref 2, k 3. Used only to test UI decision logic.
function makeReplay(): Replay {
  const times = Array.from({ length: 8 }, (_, i) => `2004-02-12T10:${String(i * 10).padStart(2, '0')}:00`)
  const mk = (score: (number | null)[], state: number[], effective: number[], valid: number[], counter: number[]) => ({
    faulty: false, label: null, valid, missing: valid.map(() => 0), interpolated: valid.map(() => 0),
    reasons: ['', 'gap of 9000 consecutive missing samples'], reason: valid.map((v) => (v ? 0 : 1)),
    features: { BPFO_prom_db: score.map((s) => (s == null ? null : 6 + s)), BPFO_h1_freq: score.map(() => 232.4), rms: score.map(() => 0.1), kurtosis: score.map(() => 3) },
    detectors: {
      tocsin: { score, state, effective, counter, clear: score.map(() => 0), family: score.map(() => 0), reference: { BPFO: { median: 6, sigma: 1 }, BPFI: { median: 6, sigma: 1 }, '2xBSF': { median: 6, sigma: 1 } } },
      b0_rms: { score, state: effective, effective, reference: { median: 0, sigma: 1 } },
      b1_iforest: { score, state: effective, effective, reference: { median: 0, sigma: 1 } },
    },
    metrics: {}, alert_events: [],
  })
  return {
    run: 'test2', label: 'IMS Test 2', role: 'held-out', condition: 'clean', condition_label: 'As recorded', precomputed: true,
    generated: '', config_sha: 'abc', version: '1', band: '2000-8000', k: 3, n_ref: 2,
    thresholds: { tocsin: 3.5, b0_rms: 5.5, b1_iforest: 4.5 }, families: ['BPFO', 'BPFI', '2xBSF'],
    family_labels: { BPFO: 'outer-race', BPFI: 'inner-race', '2xBSF': 'rolling-element' }, defect_hz: { BPFO: 236.4, BPFI: 296.9, '2xBSF': 279.8 },
    times,
    bearings: {
      // bearing 1: alerts at reading 6, reading 7 is invalid (alert must persist)
      '1': mk([0, 0, 1, 4, 5, 6, 7, null], [0, 0, 1, 2, 2, 3, 3, 4], [0, 0, 1, 2, 2, 3, 3, 3], [1, 1, 1, 1, 1, 1, 1, 0], [0, 0, 0, 1, 2, 3, 4, 4]),
      // bearing 2: normal throughout
      '2': mk([0, 0, 1, 1, 2, 1, 1, 1], [0, 0, 1, 1, 1, 1, 1, 1], [0, 0, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1, 1], [0, 0, 0, 0, 0, 0, 0, 0]),
      // bearing 3: watch at the end
      '3': mk([0, 0, 1, 1, 1, 1, 1, 4], [0, 0, 1, 1, 1, 1, 1, 2], [0, 0, 1, 1, 1, 1, 1, 2], [1, 1, 1, 1, 1, 1, 1, 1], [0, 0, 0, 0, 0, 0, 0, 1]),
    },
  } as unknown as Replay
}

describe('replay decisions', () => {
  const r = makeReplay()

  it('keeps the last valid ALERT through a missing reading and reports its age', () => {
    const b = bearingNow(r, '1', 7)
    expect(b.shown).toBe('DATA_INSUFFICIENT')
    expect(b.effective).toBe('ALERT')
    expect(b.stale).toBe(true)
    expect(b.lastValidIdx).toBe(6)
    expect(b.lastValidAgeH).toBeCloseTo(10 / 60)
    expect(b.dataNote).toContain('gap')
  })

  it('orders by effective state, then score relative to threshold', () => {
    const order = priorityOrder(['1', '2', '3'].map((b) => bearingNow(r, b, 7))).map((b) => b.bearing)
    expect(order).toEqual([1, 3, 2])
  })

  it('reports baselining progress', () => {
    expect(bearingNow(r, '2', 0).baselineRemaining).toBe(1)
  })

  it('never reads past the cursor', () => {
    const early = bearingNow(r, '1', 3)
    expect(early.effective).toBe('WATCH')
    expect(early.score).toBe(4)
  })

  it('builds sentences from structured evidence', () => {
    const watch = evidenceAt(r, '3', 7)
    expect(watch.sentence).toContain('1 of 3 readings')
    expect(watch.sentence).toContain('outer-race band (236 Hz)')
    const nodata = evidenceAt(r, '1', 7)
    expect(nodata.state).toBe('DATA_INSUFFICIENT')
    expect(nodata.sentence).toContain('The last valid state, ALERT, is kept')
    const alert = evidenceAt(r, '1', 6)
    expect(alert.sentence).toContain('Prioritize inspection')
    expect(alert.ratio_vs_reference).toBeCloseTo(10 ** (7 / 20))
  })

  it('handles the baselining sentence', () => {
    expect(sentence({ ...evidenceAt(r, '2', 0), state: 'BASELINING' })).toContain('learning')
  })
})

describe('audit regressions (unit)', () => {
  const r = makeReplay()

  it('TC-01: cursor values are parsed and clamped to integers', () => {
    expect(parseCursor('12')).toEqual({ value: 12, canonical: true })
    expect(parseCursor('1.5')).toEqual({ value: 1, canonical: false })
    expect(parseCursor('-4').value).toBe(0)
    expect(parseCursor('abc').value).toBe(0)
    expect(clampCursor(99999, 8)).toBe(7)
    expect(clampCursor(Number.NaN, 8)).toBe(0)
  })

  it('TC-03: no score, ratio, family or trend before the reference exists', () => {
    const b = bearingNow(r, '1', 1)
    expect(b.baselineReady).toBe(false)
    expect(b.score).toBeNull()
    expect(b.ratio).toBeNull()
    expect(b.family).toBeNull()
    expect(b.trendPerHour).toBeNull()
    expect(b.rawProm.BPFO).not.toBeNull()
    const ev = evidenceAt(r, '1', 1)
    expect(ev.reference_prom_db).toBeNull()
    expect(ev.ratio_vs_reference).toBeNull()
    expect(referenceReadyIndex(r.bearings['1'])).toBe(2)
  })

  it('TC-03: baselining bearings keep a neutral order', () => {
    const order = priorityOrder(['3', '1', '2'].map((b) => bearingNow(r, b, 1))).map((b) => b.bearing)
    expect(order).toEqual([1, 2, 3])
  })

  it('TC-07: evidence from an earlier reading is flagged as retained', () => {
    const ev = evidenceAt(r, '1', 7)
    expect(ev.retained).toBe(true)
    expect(ev.measuredAt).toBe(r.times[6])
  })
})
