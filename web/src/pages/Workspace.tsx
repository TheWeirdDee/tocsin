import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertLog } from '../components/AlertLog'
import { DETECTORS } from '../components/charts/AlertTimeline'
import { SpectrumChart } from '../components/charts/SpectrumChart'
import { TrendChart } from '../components/charts/TrendChart'
import { Jump, Pause, Play, Reset, Step, StepBack, Warn } from '../components/Icons'
import { STATE_LABEL, StateBadge } from '../components/StateBadge'
import { ApiError, api, type FrozenConfig } from '../lib/api'
import { bearingNow, evidenceAt, priorityOrder, type BearingNow } from '../lib/decision'
import { fmtDuration, fmtHz, fmtNum, fmtStamp, hoursBetween } from '../lib/format'
import type { Replay, RunsIndex, SpectrumResp } from '../lib/types'
import './workspace.css'

const SPEEDS = [1, 4, 16, 64]

export default function Workspace() {
  const { run: runParam } = useParams()
  const [sp, setSp] = useSearchParams()
  const navigate = useNavigate()
  const [index, setIndex] = useState<RunsIndex | null>(null)
  const [cfg, setCfg] = useState<FrozenConfig | null>(null)
  const [replay, setReplay] = useState<Replay | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(16)

  const run = runParam ?? 'test2'
  const cond = sp.get('cond') ?? 'clean'
  const selected = sp.get('b') ?? ''
  const [t, setT] = useState(() => Math.max(0, Number(sp.get('t') ?? 0) || 0))

  useEffect(() => {
    Promise.all([api.runs(), api.config()])
      .then(([r, c]) => { setIndex(r); setCfg(c) })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load the run list.'))
  }, [])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    setPlaying(false)
    api.replay(run, cond)
      .then((r) => {
        if (!alive) return
        setReplay(r)
        setT((cur) => Math.min(cur, r.times.length - 1))
      })
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : 'Could not load this analysis.'))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [run, cond])

  const runMeta = index?.runs.find((r) => r.id === run)
  const n = replay?.times.length ?? 0

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

  // keep URL shareable without spamming history while playing
  useEffect(() => {
    if (playing) return
    const next = new URLSearchParams(sp)
    next.set('t', String(t))
    if (next.toString() !== sp.toString()) setSp(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, playing])

  const now: BearingNow[] = useMemo(
    () => (replay ? Object.keys(replay.bearings).map((b) => bearingNow(replay, b, Math.min(t, n - 1))) : []),
    [replay, t, n],
  )
  const ranked = useMemo(() => priorityOrder(now), [now])
  const sel = selected && replay?.bearings[selected] ? selected : ranked[0] ? String(ranked[0].bearing) : '1'

  const setParam = useCallback((k: string, v: string) => {
    const next = new URLSearchParams(sp)
    next.set(k, v)
    setSp(next, { replace: true })
  }, [sp, setSp])

  // keyboard: space play/pause, arrows step (ignored while typing in a field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(tag)) return
      if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p) }
      if (e.key === 'ArrowRight') setT((c) => Math.min(c + 1, n - 1))
      if (e.key === 'ArrowLeft') setT((c) => Math.max(c - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [n])

  if (error && !replay) {
    return (
      <div className="wrap ws-page">
        <div className="notice error" role="alert"><Warn /><div><strong>Analysis unavailable.</strong> {error}</div></div>
        <p style={{ marginTop: 16 }}><button className="btn" onClick={() => window.location.reload()}>Retry</button></p>
      </div>
    )
  }

  const tt = Math.min(t, Math.max(0, n - 1))
  const nextAlert = replay ? findNextAlert(replay, tt) : null

  return (
    <div className="wrap ws-page">
      <div className="ws-title">
        <div>
          <h1>Inspection priority</h1>
          <p className="muted">Which bearing should be inspected first, and what evidence supports it.</p>
        </div>
        <div className="replay-label" role="note">
          <span className="dot" aria-hidden="true" /> Recorded dataset replay. Not a live machine feed.
        </div>
      </div>

      <section className="panel replay-bar" aria-label="Replay controls">
        <div className="rb-row">
          <label className="field">
            <span>Recording</span>
            <select value={run} onChange={(e) => navigate(`/demo/${e.target.value}?cond=${cond}`)}>
              {(index?.runs ?? [{ id: run, label: run, role: '' }]).map((r) => (
                <option key={r.id} value={r.id}>{r.label} · {r.role === 'held-out' ? 'held-out' : 'tuning set'}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Complication</span>
            <select value={cond} onChange={(e) => setParam('cond', e.target.value)} disabled={!runMeta || runMeta.conditions.length < 2}>
              {(runMeta?.conditions ?? [{ id: 'clean', label: 'As recorded' }]).map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>
          <div className="rb-transport" role="group" aria-label="Playback">
            <button className="btn btn-icon" onClick={() => { setPlaying(false); setT(0) }} aria-label="Reset to start"><Reset /></button>
            <button className="btn btn-icon" onClick={() => setT((c) => Math.max(0, c - 1))} aria-label="Previous reading"><StepBack /></button>
            <button className="btn btn-primary play" onClick={() => { if (tt >= n - 1) setT(0); setPlaying((p) => !p) }} disabled={!replay} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? <Pause /> : <Play />}<span>{playing ? 'Pause' : 'Play'}</span>
            </button>
            <button className="btn btn-icon" onClick={() => setT((c) => Math.min(n - 1, c + 1))} aria-label="Next reading"><Step /></button>
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
          <span className="num">Reading {tt + 1} of {n || '—'}</span>
          <span>Each reading: 1 s of vibration, taken every 10 min · playback ≈ {Math.round(speed * 600).toLocaleString()}× recorded time</span>
          {nextAlert != null && (
            <button className="btn btn-sm btn-ghost" onClick={() => { setPlaying(false); setT(nextAlert.t); setParam('b', String(nextAlert.b)) }}>
              <Jump /> Next TOCSIN alert onset
            </button>
          )}
        </div>
        {replay && (
          <p className="rb-prov small muted">
            {cond === 'clean' ? 'Decisions' : <>Signals modified as stated (<strong>{replay.condition_label}</strong>), then the full pipeline was rerun. Decisions</>} were precomputed by the TOCSIN pipeline
            for this exact recording and condition (config <code>{replay.config_sha.slice(0, 8)}</code>). The replay reveals them one reading at a time and never shows a later reading.
          </p>
        )}
      </section>

      {loading && (
        <div className="notice" role="status" style={{ marginTop: 12 }}><span className="spinner" /> Loading the precomputed analysis for this recording and condition…</div>
      )}

      {replay && (
        <div className={`ws-grid${loading ? ' is-loading' : ''}`}>
          <section className="panel" aria-labelledby="prio-h">
            <div className="panel-head">
              <h2 id="prio-h">Bearings by priority</h2>
              <span className="panel-sub">{replay.label} · {runMeta?.role === 'held-out' ? 'held-out' : 'tuning set'}</span>
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
                        {b.effective === 'BASELINING'
                          ? `${b.baselineRemaining} readings until the baseline is ready`
                          : b.score != null
                            ? `Score ${fmtNum(b.score, 1)} · alert at ${replay.thresholds.tocsin}`
                            : 'No valid reading yet'}
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
              Sorted by the state of each bearing's last valid reading, then by how far its score is above or below the threshold.
              Dataset labels are on the <Link to="/data">data page</Link>. The replay does not use them.
            </p>
          </section>

          <BearingDetail key={`${run}-${cond}-${sel}`} replay={replay} run={run} cond={cond} bid={sel} t={tt} cfg={cfg} index={index} onSeek={(i) => { setPlaying(false); setT(i) }} />
        </div>
      )}
    </div>
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

function BearingDetail({ replay, run, cond, bid, t, cfg, index, onSeek }: {
  replay: Replay; run: string; cond: string; bid: string; t: number; cfg: FrozenConfig | null; index: RunsIndex | null; onSeek: (i: number) => void
}) {
  const b = replay.bearings[bid]
  const now = bearingNow(replay, bid, t)
  const ev = evidenceAt(replay, bid, t)
  const tr = b.detectors.tocsin
  const [spec, setSpec] = useState<SpectrumResp | null>(null)
  const [specErr, setSpecErr] = useState<string | null>(null)
  const specIdx = now.lastValidIdx

  useEffect(() => {
    if (specIdx < 0) { setSpec(null); return }
    const ctl = new AbortController()
    const h = window.setTimeout(() => {
      api.spectrum(run, Number(bid), specIdx, cond, ctl.signal)
        .then((s) => { setSpec(s); setSpecErr(null) })
        .catch((e) => { if (e.name !== 'AbortError') setSpecErr(e instanceof ApiError ? e.message : 'Spectrum unavailable') })
    }, 90)
    return () => { ctl.abort(); window.clearTimeout(h) }
  }, [run, bid, specIdx, cond])

  const strips = DETECTORS.map((d) => ({ label: d.label, effective: b.detectors[d.id].effective, color: d.color }))
  const quality = b.valid[t]
    ? (b.interpolated[t] > 0 ? `Valid · ${b.interpolated[t].toLocaleString()} missing samples (${fmtNum((b.missing[t] ?? 0) * 100, 1)}%) filled by interpolation` : 'Valid · complete reading')
    : `No verdict · ${now.dataNote}`

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
          <dl className="ev-grid">
            <div><dt>Implicated band</dt><dd>{ev.family_label ? `${cap(ev.family_label)} · ${fmtHz(ev.defect_hz)}` : '—'}</dd></div>
            <div><dt>Peak found at</dt><dd className="num">{fmtHz(ev.peak_hz)}</dd></div>
            <div><dt>Band prominence now</dt><dd className="num">{fmtNum(ev.current_prom_db)} dB</dd></div>
            <div><dt>Healthy reference</dt><dd className="num">{fmtNum(ev.reference_prom_db)} dB</dd></div>
            <div><dt>Ratio to reference</dt><dd className="num">{ev.ratio_vs_reference != null ? `${fmtNum(ev.ratio_vs_reference, 2)}×` : '—'}</dd></div>
            <div><dt>Score vs threshold</dt><dd className="num">{fmtNum(now.score, 1)} / {replay.thresholds.tocsin}</dd></div>
            <div><dt>Persistence</dt><dd className="num">{now.effective === 'ALERT' && now.clear > 0 ? `${now.clear} of ${replay.k} below (clearing)` : `${now.counter} of ${replay.k} readings`}</dd></div>
            <div><dt>Trend (last 6 valid readings)</dt><dd className="num">{now.trendPerHour != null ? `${now.trendPerHour >= 0 ? '+' : ''}${fmtNum(now.trendPerHour, 2)} per hour` : '—'}</dd></div>
            <div className="wide"><dt>Data quality</dt><dd>{quality}{now.stale && now.lastValidAgeH != null ? ` · last valid reading ${fmtDuration(now.lastValidAgeH)} earlier` : ''}</dd></div>
            <div className="wide"><dt>Recording time · analysis version</dt><dd><span className="num">{fmtStamp(replay.times[t])}</span> · config <code>{replay.config_sha.slice(0, 8)}</code> · v{replay.version}{cfg ? ` · speed assumed ${cfg.rpm_assumed} RPM (rig nominal)` : ''}</dd></div>
          </dl>
          <p className="small muted ev-foot">
            The score is a robust z-value, not a probability of failure. It measures how far the strongest defect band sits above this bearing's own healthy spread.
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Defect-band score over time</h3>
          <span className="panel-sub">Readings up to the cursor only · click the chart to seek</span>
        </div>
        <div className="panel-body">
          <TrendChart title={`Bearing ${bid} TOCSIN score`} times={replay.times} score={tr.score} valid={b.valid}
            threshold={replay.thresholds.tocsin} t={t} strips={strips} onSeek={onSeek} />
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
          <span className="panel-sub">
            {specIdx >= 0 ? (specIdx === t ? 'This reading' : `Last valid reading (${fmtStamp(replay.times[specIdx])})`) : 'No valid reading yet'}
            {' '}· {cfg ? `${cfg.band.replace('-', '–')} Hz band-passed` : ''}
          </span>
        </div>
        <div className="panel-body">
          {specErr && <div className="notice warn"><Warn />{specErr}</div>}
          {!specErr && spec && spec.present && cfg ? (
            <SpectrumChart title={`Envelope spectrum, bearing ${bid}`} f0={spec.f0} df={spec.df} amp={spec.amp}
              bands={cfg.band_markers} highlight={now.family} />
          ) : !specErr ? (
            <div className="skeleton" style={{ height: 220 }} aria-hidden="true" />
          ) : null}
          <p className="small muted" style={{ marginTop: 8 }}>
            Shaded: ±2% windows at the first three harmonics of each defect frequency, computed from bearing geometry. Darker shading marks the implicated family.
            {index?.display_note ? ` ${index.display_note}` : ''}
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h3>Same reading, other detectors</h3><span className="panel-sub">Same calibration window and persistence rule</span></div>
        <div className="panel-body cmp">
          <div><span className="swatch" style={{ background: 'var(--det-rms)' }} />RMS level alarm <StateBadge state={now.rms} compact /></div>
          <div><span className="swatch" style={{ background: 'var(--det-iforest)' }} />Isolation forest <StateBadge state={now.iforest} compact /></div>
          <div className="small muted">Context (not used by TOCSIN's decision): RMS {fmtNum(b.features.rms?.[now.lastValidIdx] ?? null, 3)} · kurtosis {fmtNum(b.features.kurtosis?.[now.lastValidIdx] ?? null, 2)}</div>
        </div>
      </div>

      <AlertLog replay={replay} bid={bid} t={t} onSeek={onSeek} hoursTo={(i) => hoursBetween(replay.times[i], replay.times[t])} />
    </section>
  )
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

