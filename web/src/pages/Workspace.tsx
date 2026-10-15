import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertLog } from '../components/AlertLog'
import { DETECTORS } from '../components/charts/AlertTimeline'
import { SpectrumChart } from '../components/charts/SpectrumChart'
import { TrendChart } from '../components/charts/TrendChart'
import { Jump, Pause, Play, Reset, Step, StepBack, Warn } from '../components/Icons'
import { StateBadge } from '../components/StateBadge'
import { STATE_LABEL } from '../lib/state'
import { ApiError, api, type FrozenConfig } from '../lib/api'
import { bearingNow, clampCursor, evidenceAt, parseCursor, priorityOrder, referenceReadyIndex, type BearingNow } from '../lib/decision'
import { fmtDuration, fmtHz, fmtNum, fmtStamp, hoursBetween } from '../lib/format'
import type { Replay, RunsIndex, SpectrumResp } from '../lib/types'
import { S } from '../lib/types'
import './workspace.css'

const SPEEDS = [1, 4, 16, 64]
type Guide = 'alert' | 'miss' | 'gaps'

interface Loaded { key: string; data: Replay }

export default function Workspace() {
  const { run: runParam } = useParams()
  const [sp, setSp] = useSearchParams()
  const navigate = useNavigate()
  const [index, setIndex] = useState<RunsIndex | null>(null)
  const [cfg, setCfg] = useState<FrozenConfig | null>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null)
  const [indexError, setIndexError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(16)
  const [attempt, setAttempt] = useState(0)

  const run = runParam ?? 'test2'
  const cond = sp.get('cond') ?? 'clean'
  const guide = (['alert', 'miss', 'gaps'] as const).find((g) => g === sp.get('guide')) ?? null
  const key = `${run}|${cond}`
  const cursor = parseCursor(sp.get('t'))
  const [t, setT] = useState(cursor.value)

  // The replay shown must belong to the current request (audit TC-06): never render
  // data loaded for another run or condition under the current selection.
  const replay = loaded && loaded.key === key ? loaded.data : null
  const error = loadError && loadError.key === key ? loadError.message : null

  useEffect(() => {
    Promise.all([api.runs(), api.config()])
      .then(([r, c]) => { setIndex(r); setCfg(c) })
      .catch((e) => setIndexError(e instanceof ApiError ? e.message : 'Could not load the run list.'))
  }, [])

  const runMeta = index?.runs.find((r) => r.id === run) ?? null
  const unknownRun = !!index && !runMeta
  const unknownCond = !!runMeta && !runMeta.conditions.some((c) => c.id === cond)

  useEffect(() => {
    if (unknownRun || unknownCond) return
    let alive = true
    setPlaying(false)
    setLoadError(null)
    api.replay(run, cond)
      .then((r) => { if (alive) setLoaded({ key, data: r }) })
      .catch((e) => { if (alive) setLoadError({ key, message: e instanceof ApiError ? e.message : 'Could not load this analysis.' }) })
    return () => { alive = false }
  }, [run, cond, key, unknownRun, unknownCond, attempt])

  const n = replay?.times.length ?? 0
  const tt = clampCursor(t, n)

  // Guided examples choose their reading from the analysis output, never from a scripted index.
  const guideApplied = useRef<string | null>(null)
  // The reading a guide chose, until the cursor state has reached it (see the canonical URL effect).
  const guideTarget = useRef<number | null>(null)
  useEffect(() => {
    if (!replay || !guide || sp.get('t') != null || guideApplied.current === key + guide) return
    const bid = sp.get('b') ?? (guide === 'alert' ? '3' : '1')
    const b = replay.bearings[bid]
    if (!b) return
    let target = 0
    if (guide === 'alert') target = b.alert_events[0]?.index ?? 0
    if (guide === 'miss') target = b.detectors.b0_rms.effective.findIndex((s) => s === S.ALERT)
    if (guide === 'gaps') target = b.valid.findIndex((v, i) => v === 0 && i > replay.n_ref + 10)
    guideApplied.current = key + guide
    guideTarget.current = Math.max(0, target)
    setT(guideTarget.current)
  }, [replay, guide, key, sp])

  // playback clock
  const last = useRef<number | null>(null)
  const acc = useRef(0)
  useEffect(() => {
    if (!playing || !replay) return
    let raf = 0
    const tick = (now: number) => {
      if (last.current != null) acc.current += ((now - last.current) / 1000) * speed
      last.current = now
      const steps = Math.floor(acc.current)
      if (steps > 0) {
        acc.current -= steps
        setT((cur) => {
          const nx = Math.min(cur + steps, replay.times.length - 1)
          if (nx >= replay.times.length - 1) setPlaying(false)
          return nx
        })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); last.current = null; acc.current = 0 }
  }, [playing, speed, replay])

  const now: BearingNow[] = useMemo(
    () => (replay ? Object.keys(replay.bearings).map((b) => bearingNow(replay, b, tt)) : []),
    [replay, tt],
  )
  const ranked = useMemo(() => priorityOrder(now), [now])
  const bParam = sp.get('b')
  const bValid = !!replay && !!bParam && !!replay.bearings[bParam]
  const sel = bValid ? (bParam as string) : ranked[0] ? String(ranked[0].bearing) : '1'

  // Canonical URL (audit TC-01): integer cursor within range, known bearing, while paused.
  useEffect(() => {
    if (playing || !replay) return
    if (guide && sp.get('t') == null && guideApplied.current !== key + guide) return // guide picks the reading first
    // In the render where a guide chose its reading, the cursor has not caught up yet; writing the old
    // cursor now would send the URL (and then the cursor) back to it.
    if (guideTarget.current != null) {
      if (tt !== clampCursor(guideTarget.current, n)) return
      guideTarget.current = null
    }
    const next = new URLSearchParams(sp)
    next.set('t', String(tt))
    if (bParam != null && !bValid) next.delete('b')
    if (next.toString() !== sp.toString()) setSp(next, { replace: true })
    if (t !== tt) setT(tt)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tt, playing, replay, bValid])

  const setParam = useCallback((k: string, v: string | null) => {
    const next = new URLSearchParams(sp)
    if (v == null) next.delete(k)
    else next.set(k, v)
    setSp(next, { replace: true })
  }, [sp, setSp])

  // keyboard: space play/pause, arrows step (ignored while typing in a field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(tag)) return
      if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p) }
      if (e.key === 'ArrowRight') setT((c) => Math.min(c + 1, Math.max(0, n - 1)))
      if (e.key === 'ArrowLeft') setT((c) => Math.max(c - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [n])

  // Back/forward and edited URLs move the cursor (our own canonical writes are no-ops here).
  const tParam = sp.get('t')
  useEffect(() => {
    if (playing || tParam == null) return
    const parsed = parseCursor(tParam).value
    setT((cur) => (cur === parsed ? cur : parsed))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tParam])

  const nextAlert = replay ? findNextAlert(replay, tt) : null
  const gap = replay && tt > 0 ? hoursBetween(replay.times[tt - 1], replay.times[tt]) : null

  return (
    <div className="wrap ws-page">
      <div className="ws-title">
        <div>
          <p className="eyebrow">Explore an example</p>
          <h1>Bearing replay</h1>
          <p className="muted">Which bearing should be inspected first, and what evidence supports it.</p>
        </div>
        <div className="replay-label" role="note">
          <span className="dot" aria-hidden="true" /> Recorded dataset replay. Not a live machine feed.
        </div>
      </div>

      <nav className="guide-tabs" aria-label="Scenarios">
        <Link className={`guide-tab${guide === 'alert' ? ' on' : ''}`} to="/demo/test3?guide=alert&b=3">Understand an alert</Link>
        <Link className={`guide-tab${guide === 'miss' ? ' on' : ''}`} to="/demo/test2?guide=miss&b=1">Inspect the missed failure</Link>
        <Link className={`guide-tab${guide === 'gaps' ? ' on' : ''}`} to="/demo/test2?guide=gaps&cond=gaps&b=1">See missing-data handling</Link>
        <Link className="guide-tab" to="/analyze?sample=late">Analyze a supported sample</Link>
        <Link className="guide-tab" to="/evaluation#glance">Compare the methods</Link>
        <Link className={`guide-tab${!guide ? ' on' : ''}`} to={`/demo/${run}`}>Free exploration</Link>
      </nav>

      {guide && replay && <GuideNote guide={guide} replay={replay} bid={sel} />}

      {(unknownRun || unknownCond || indexError) && (
        <div className="notice error" role="alert">
          <Warn />
          <div>
            {indexError ? <><strong>The run list could not be loaded.</strong> {indexError}</>
              : unknownRun ? <><strong>There is no recording called “{run}”.</strong> Choose one of the recordings below.</>
              : <><strong>“{cond}” is not an analysed condition for this recording.</strong> <button className="btn btn-sm" onClick={() => setParam('cond', 'clean')}>Show the recording as recorded</button></>}
          </div>
        </div>
      )}

      <section className="panel replay-bar" aria-label="Replay controls">
        <div className="rb-row">
          <label className="field">
            <span>Recording</span>
            <select value={runMeta ? run : ''} onChange={(e) => navigate(`/demo/${e.target.value}?cond=clean`)}>
              {!runMeta && <option value="" disabled>Choose a recording</option>}
              {(index?.runs ?? []).map((r) => (
                <option key={r.id} value={r.id}>{r.label} · {r.role === 'held-out' ? 'held-out' : 'tuning set'}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Complication</span>
            <select value={unknownCond ? '' : cond} onChange={(e) => setParam('cond', e.target.value)} disabled={!runMeta || runMeta.conditions.length < 2}>
              {unknownCond && <option value="" disabled>Choose a condition</option>}
              {(runMeta?.conditions ?? [{ id: 'clean', label: 'As recorded' }]).map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>
          <div className="rb-transport" role="group" aria-label="Playback">
            <button className="btn btn-icon" onClick={() => { setPlaying(false); setT(0) }} aria-label="Reset to start" disabled={!replay}><Reset /></button>
            <button className="btn btn-icon" onClick={() => setT((c) => Math.max(0, c - 1))} aria-label="Previous reading" disabled={!replay}><StepBack /></button>
            <button className="btn btn-primary play" onClick={() => { if (tt >= n - 1) setT(0); setPlaying((p) => !p) }} disabled={!replay} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? <Pause /> : <Play />}<span>{playing ? 'Pause' : 'Play'}</span>
            </button>
            <button className="btn btn-icon" onClick={() => setT((c) => Math.min(Math.max(0, n - 1), c + 1))} aria-label="Next reading" disabled={!replay}><Step /></button>
          </div>
          <div className="field">
            <span id="speed-label">Speed (readings per second)</span>
            <div className="seg" role="group" aria-labelledby="speed-label">
              {SPEEDS.map((s) => (
                <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="rb-scrub">
          <input type="range" min={0} max={Math.max(0, n - 1)} value={tt} onChange={(e) => { setPlaying(false); setT(Number(e.target.value)) }}
            aria-label="Seek within recording" aria-valuetext={replay ? fmtStamp(replay.times[tt]) : ''} disabled={!replay} />
        </div>
        <div className="rb-meta">
          <span><strong className="num">{replay ? fmtStamp(replay.times[tt]) : '—'}</strong> recording time</span>
          <span className="num">Reading {replay ? tt + 1 : '—'} of {n || '—'}</span>
          <span>Each reading is 1 s of vibration{gap != null ? ` · previous reading ${fmtDuration(gap)} earlier` : ''}</span>
          {nextAlert != null && (
            <button className="btn btn-sm btn-ghost" onClick={() => { setPlaying(false); setT(nextAlert.t); setParam('b', String(nextAlert.b)) }}>
              <Jump /> Jump ahead to the next alert onset
            </button>
          )}
        </div>
        {replay && (
          <p className="rb-prov small muted" data-testid="replay-provenance">
            Play reveals stored results; it does not re-run the analysis. {cond === 'clean' ? 'Decisions' : <>Signals modified as stated (<strong>{replay.condition_label}</strong>, a seeded perturbation of the real recording), then the full pipeline was rerun. Decisions</>} were precomputed by the TOCSIN pipeline
            for this exact recording and condition (config <code>{replay.config_sha.slice(0, 8)}</code>). The replay reveals them one reading at a time and never shows a later reading.
          </p>
        )}
      </section>

      {error && (
        <div className="notice error" role="alert" style={{ marginTop: 12 }}>
          <Warn />
          <div><strong>This analysis could not be loaded.</strong> {error} <button className="btn btn-sm" onClick={() => setAttempt((a) => a + 1)}>Retry</button></div>
        </div>
      )}
      {!replay && !error && !unknownRun && !unknownCond && (
        <div className="ws-loading" role="status">
          <span className="spinner" /> Loading the precomputed analysis for {runMeta?.label ?? run} · {runMeta?.conditions.find((c) => c.id === cond)?.label ?? cond}…
        </div>
      )}

      {replay && (
        <div className="ws-grid">
          <section className="panel" aria-labelledby="prio-h">
            <div className="panel-head">
              <h2 id="prio-h">Bearings by priority</h2>
              <span className="panel-sub">{replay.label}</span>
            </div>
            <ol className="prio-list">
              {ranked.map((b, i) => (
                <li key={b.bearing}>
                  <button className={`prio-item${String(b.bearing) === sel ? ' on' : ''}`} aria-pressed={String(b.bearing) === sel}
                    onClick={() => setParam('b', String(b.bearing))}>
                    <span className="prio-rank num" aria-label={`Priority ${i + 1}`}>{i + 1}</span>
                    <span className="prio-main">
                      <span className="prio-name">Bearing {b.bearing}</span>
                      <span className="prio-sub small">
                        {!b.baselineReady
                          ? `Learning baseline · ${b.validSeen} of ${replay.n_ref} valid readings`
                          : `Score ${fmtNum(b.score, 1)} · alert at ${replay.thresholds.tocsin}`}
                      </span>
                      {b.stale && (
                        <span className="prio-stale small">No valid data now · last valid {fmtDuration(b.lastValidAgeH)} ago</span>
                      )}
                    </span>
                    <StateBadge state={b.effective} compact />
                  </button>
                </li>
              ))}
            </ol>
            <p className="prio-foot small muted">
              Ordered by the state of each bearing's last valid reading, then by score. Bearings still learning their baseline have no score and keep a fixed order.
              The replay does not use the dataset's failure labels.
            </p>
          </section>

          <BearingDetail key={`${key}-${sel}`} replay={replay} run={run} cond={cond} bid={sel} t={tt} cfg={cfg} index={index} playing={playing} onSeek={(i) => { setPlaying(false); setT(i) }} />
        </div>
      )}
    </div>
  )
}

function GuideNote({ guide, replay, bid }: { guide: Guide; replay: Replay; bid: string }) {
  const b = replay.bearings[bid]
  const end = replay.times[replay.times.length - 1]
  const firstAlert = b?.alert_events[0]
  const rmsIdx = b ? b.detectors.b0_rms.effective.findIndex((s) => s === S.ALERT) : -1
  const iforestIdx = b ? b.detectors.b1_iforest.effective.findIndex((s) => s === S.ALERT) : -1
  let title = ''
  let rows: [string, string][] = []
  if (guide === 'alert') {
    title = 'Understand an alert'
    rows = [
      ['You are looking at', `${replay.label}, bearing ${bid}: real vibration readings from a bearing test rig, replayed with precomputed decisions. The dataset says this bearing had an outer-race failure at the end of the test.`],
      ['The detector concluded', firstAlert ? `ALERT at ${fmtStamp(firstAlert.timestamp)}, ${fmtDuration(hoursBetween(firstAlert.timestamp, end))} before the recording endpoint.` : 'No alert on this bearing.'],
      ['The evidence', 'The outer-race frequency band rose above this bearing’s own early-recording level for three consecutive valid readings. See the evidence card, the score trend and the spectrum below.'],
      ['It does not establish', 'That every failure is caught (TOCSIN missed one of the two held-out failures), when the bearing physically failed, or that a defect exists. It identifies an abnormal pattern worth a confirmatory inspection.'],
    ]
  } else if (guide === 'miss') {
    title = 'Inspect the missed failure'
    rows = [
      ['You are looking at', `${replay.label}, bearing ${bid}, which the dataset says failed (outer race) at the end of the test.`],
      ['The detector concluded', `TOCSIN: ${b?.alert_events.length ? 'alerted only late' : 'never alerted on this bearing'}. RMS alarm: ${rmsIdx >= 0 ? `alert from ${fmtStamp(replay.times[rmsIdx])}, ${fmtDuration(hoursBetween(replay.times[rmsIdx], end))} before the endpoint` : 'no alert'}. Isolation forest: ${iforestIdx >= 0 ? `alert from ${fmtStamp(replay.times[iforestIdx])}` : 'no alert'}.`],
      ['The evidence', 'In the spectrum, the tallest peak sits just left of the shaded outer-race window. TOCSIN’s window around the computed frequency was too narrow to contain the real tone.'],
      ['It does not establish', 'That a wider window would work in general. That change was explored only after seeing these results, so it would need new data to validate.'],
    ]
  } else {
    title = 'See missing-data handling'
    rows = [
      ['You are looking at', 'A seeded perturbation of the real recording: 15% of readings had a contiguous 40% of their samples removed. This is labelled synthetic damage, not a real sensor fault.'],
      ['The detector concluded', 'For a reading that fails the quality checks: no verdict. The previous valid state is kept and its age is shown.'],
      ['The evidence', 'The badge reads “No valid data”, the reason names the failed check, and the values shown are labelled as the last valid measurement, with its timestamp.'],
      ['It does not establish', 'That every kind of real sensor fault is detected. Only the implemented quality checks are covered.'],
    ]
  }
  return (
    <section className="guide-note panel" aria-label={`Scenario: ${title}`}>
      <p className="eyebrow">Scenario · {title}</p>
      <dl className="guide-grid">
        {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      {guide === 'miss' && <p className="small"><Link to="/evaluation#diagnosis">Read the full diagnosis</Link></p>}
    </section>
  )
}

function findNextAlert(r: Replay, t: number): { t: number; b: number } | null {
  let best: { t: number; b: number } | null = null
  for (const [bid, b] of Object.entries(r.bearings)) {
    for (const ev of b.alert_events) {
      if (ev.index != null && ev.index > t && (!best || ev.index < best.t)) best = { t: ev.index, b: Number(bid) }
    }
  }
  return best
}

type Spec = SpectrumResp & { index: number }

/** Spectrum for the wanted reading, throttled so playback cannot starve it (audit TC-09). */
function useThrottledSpectrum(run: string, bid: string, cond: string, wanted: number) {
  const [spec, setSpec] = useState<Spec | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const want = useRef(wanted)
  want.current = wanted
  useEffect(() => {
    let alive = true
    let inflight = false
    let lastFetched = -2
    const ctl = new AbortController()
    const pump = () => {
      const w = want.current
      if (!alive || inflight || w === lastFetched) return
      if (w < 0) { lastFetched = w; setSpec(null); return }
      inflight = true
      lastFetched = w
      api.spectrum(run, Number(bid), w, cond, ctl.signal)
        .then((s) => { if (alive) { setSpec({ ...s, index: w }); setErr(null) } })
        .catch((e) => { if (alive && e.name !== 'AbortError') setErr(e instanceof ApiError ? e.message : 'Spectrum unavailable') })
        .finally(() => { inflight = false })
    }
    pump()
    const timer = window.setInterval(pump, 200)
    return () => { alive = false; ctl.abort(); window.clearInterval(timer) }
  }, [run, bid, cond])
  return { spec, err }
}

function BearingDetail({ replay, run, cond, bid, t, cfg, index, playing, onSeek }: {
  replay: Replay; run: string; cond: string; bid: string; t: number; cfg: FrozenConfig | null; index: RunsIndex | null; playing: boolean; onSeek: (i: number) => void
}) {
  const b = replay.bearings[bid]
  const now = bearingNow(replay, bid, t)
  const ev = evidenceAt(replay, bid, t)
  const tr = b.detectors.tocsin
  const specIdx = now.lastValidIdx
  const { spec, err: specErr } = useThrottledSpectrum(run, bid, cond, specIdx)
  const readyFrom = useMemo(() => referenceReadyIndex(b), [b])
  const strips = DETECTORS.map((d) => ({ label: d.label, effective: b.detectors[d.id].effective, color: d.color }))
  const quality = b.valid[t]
    ? (b.interpolated[t] > 0 ? `Valid · ${b.interpolated[t].toLocaleString()} missing samples (${fmtNum((b.missing[t] ?? 0) * 100, 1)}%) filled by interpolation` : 'Valid · complete reading')
    : `No verdict · ${now.dataNote}`
  const measuredLabel = ev.retained ? 'last valid' : 'this reading'
  const specLabel = !spec ? (specIdx >= 0 ? 'Loading…' : 'No valid reading yet')
    : spec.index === specIdx
      ? `Reading ${spec.index + 1}${specIdx !== t ? ` (last valid, ${fmtStamp(replay.times[specIdx])})` : ''}`
      : `Showing reading ${spec.index + 1} · updating to reading ${specIdx + 1}${playing ? ' during playback' : ''}`

  return (
    <section className="detail" aria-labelledby="detail-h">
      <div className={`panel evidence s-${ev.state}`}>
        <div className="panel-head">
          <h2 id="detail-h">Bearing {bid}</h2>
          <div className="ev-states">
            {now.stale && <StateBadge state="DATA_INSUFFICIENT" />}
            <StateBadge state={now.effective} />
          </div>
        </div>
        <div className="panel-body">
          <p className="ev-sentence" aria-live="polite">{ev.sentence}</p>
          {ev.retained && (
            <p className="retained-note small">
              Values below are the <strong>last valid measurement</strong> ({fmtStamp(ev.measuredAt!)}, {fmtDuration(now.lastValidAgeH)} before this reading). This reading has no verdict.
            </p>
          )}
          {!now.baselineReady ? (
            <>
              <dl className="ev-grid">
                <div><dt>Calibration</dt><dd className="num">{now.validSeen} of {replay.n_ref} valid readings</dd></div>
                <div><dt>Reference available</dt><dd>after {now.baselineRemaining} more valid reading{now.baselineRemaining === 1 ? '' : 's'}</dd></div>
                {replay.families.map((f) => (
                  <div key={f}><dt>Raw {replay.family_labels[f]} prominence ({measuredLabel})</dt><dd className="num">{fmtNum(now.rawProm[f])} dB</dd></div>
                ))}
                <div className="wide"><dt>Data quality</dt><dd>{quality}</dd></div>
                <div className="wide"><dt>Recording time · analysis version</dt><dd><span className="num">{fmtStamp(replay.times[t])}</span> · config <code>{replay.config_sha.slice(0, 8)}</code> · v{replay.version}</dd></div>
              </dl>
              <p className="small muted ev-foot">
                The healthy reference is the median and spread of this bearing's first {replay.n_ref} valid readings. Until those have been seen, no score,
                reference comparison or implicated band exists, so none is shown. Raw prominence is measured from this bearing's readings alone.
              </p>
            </>
          ) : (
            <>
              <dl className="ev-grid">
                <div><dt>Implicated band</dt><dd>{ev.family_label ? `${cap(ev.family_label)} · ${fmtHz(ev.defect_hz)}` : '—'}</dd></div>
                <div><dt>Peak found at ({measuredLabel})</dt><dd className="num">{fmtHz(ev.peak_hz)}</dd></div>
                <div><dt>Band prominence ({measuredLabel})</dt><dd className="num">{fmtNum(ev.current_prom_db)} dB</dd></div>
                <div><dt>Healthy reference</dt><dd className="num">{fmtNum(ev.reference_prom_db)} dB</dd></div>
                <div><dt>Ratio to reference</dt><dd className="num">{ev.ratio_vs_reference != null ? `${fmtNum(ev.ratio_vs_reference, 2)}×` : '—'}</dd></div>
                <div><dt>Score vs threshold ({measuredLabel})</dt><dd className="num">{fmtNum(now.score, 1)} / {replay.thresholds.tocsin}</dd></div>
                <div><dt>Persistence</dt><dd className="num">{now.effective === 'ALERT' && now.clear > 0 ? `${now.clear} of ${replay.k} below (clearing)` : `${now.counter} of ${replay.k} readings`}</dd></div>
                <div><dt>Trend (last 6 valid readings)</dt><dd className="num">{now.trendPerHour != null ? `${now.trendPerHour >= 0 ? '+' : ''}${fmtNum(now.trendPerHour, 2)} per hour` : '—'}</dd></div>
                <div className="wide"><dt>Data quality</dt><dd>{quality}</dd></div>
                <div className="wide"><dt>Recording time · analysis version</dt><dd><span className="num">{fmtStamp(replay.times[t])}</span> · config <code>{replay.config_sha.slice(0, 8)}</code> · v{replay.version}{cfg ? ` · speed assumed ${cfg.rpm_assumed} RPM (rig nominal)` : ''}</dd></div>
              </dl>
              {now.effective === 'ALERT' && (
                <p className="action-note-ws">
                  <strong>Suggested action:</strong> review this bearing's vibration trend and arrange a confirmatory inspection. The alert identifies an abnormal pattern; it does not confirm a physical defect.
                </p>
              )}
              <p className="small muted ev-foot">
                The score counts how many of this bearing's normal spreads the strongest defect band has moved above its reference. It is not a probability of failure.
              </p>
            </>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Defect-band score over time</h3>
          <span className="panel-sub">Readings up to the cursor only · click to seek</span>
        </div>
        <div className="panel-body">
          <TrendChart title={`Bearing ${bid} TOCSIN score`} times={replay.times} score={tr.score} valid={b.valid}
            threshold={replay.thresholds.tocsin} t={t} strips={strips} onSeek={onSeek} scoreFrom={readyFrom} />
          <div className="legend" style={{ marginTop: 8 }}>
            <span><i style={{ background: 'var(--det-tocsin)' }} />TOCSIN score</span>
            {(['ALERT', 'WATCH', 'NORMAL', 'BASELINING', 'DATA_INSUFFICIENT'] as const).map((s) => (
              <span key={s}><i className="box" style={{ background: `var(--st-${s === 'ALERT' ? 'alert' : s === 'WATCH' ? 'watch' : s === 'NORMAL' ? 'normal' : s === 'BASELINING' ? 'base' : 'nodata'})`, opacity: s === 'NORMAL' ? 0.5 : 1 }} />{STATE_LABEL[s]}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Envelope spectrum</h3>
          <span className="panel-sub" data-testid="spectrum-label">{specLabel} · {cfg ? `${cfg.band.replace('-', '–')} Hz band-passed` : ''}</span>
        </div>
        <div className="panel-body">
          {specErr && <div className="notice warn"><Warn />{specErr}</div>}
          {!specErr && spec && spec.present && cfg ? (
            <SpectrumChart title={`Envelope spectrum, bearing ${bid}, reading ${spec.index + 1}`} f0={spec.f0} df={spec.df} amp={spec.amp}
              bands={cfg.band_markers} highlight={now.baselineReady ? now.family : null} />
          ) : !specErr ? (
            <div className="skeleton" style={{ height: 220 }} aria-hidden="true" />
          ) : null}
          <p className="small muted" style={{ marginTop: 8 }}>
            Shaded: ±2% windows at the first three harmonics of each defect frequency, computed from bearing geometry.{now.baselineReady ? ' Brighter shading marks the implicated family.' : ' No family is implicated until the reference exists.'}
            {index?.display_note ? ` ${index.display_note}` : ''}
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h3>Same reading, other detectors</h3><span className="panel-sub">Same calibration window and persistence rule</span></div>
        <div className="panel-body cmp">
          <div><span className="swatch" style={{ background: 'var(--det-rms)' }} />RMS level alarm <StateBadge state={now.rms} compact /></div>
          <div><span className="swatch" style={{ background: 'var(--det-iforest)' }} />Isolation forest <StateBadge state={now.iforest} compact /></div>
          <div className="small muted">Context, not used by TOCSIN's decision ({measuredLabel}): RMS {fmtNum(b.features.rms?.[now.lastValidIdx] ?? null, 3)} · kurtosis {fmtNum(b.features.kurtosis?.[now.lastValidIdx] ?? null, 2)}</div>
        </div>
      </div>

      <AlertLog replay={replay} bid={bid} t={t} onSeek={onSeek} hoursTo={(i) => hoursBetween(replay.times[i], replay.times[t])} />
    </section>
  )
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
