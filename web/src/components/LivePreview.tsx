import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { bearingNow, evidenceAt, priorityOrder, referenceReadyIndex } from '../lib/decision'
import { fmtDuration, fmtStamp, hoursBetween } from '../lib/format'
import { usePreviewFocus } from '../lib/landingMotion'
import type { Replay } from '../lib/types'
import { DETECTORS } from './charts/AlertTimeline'
import { TrendChart } from './charts/TrendChart'
import { StateBadge } from './StateBadge'

/**
 * A working, reduced replay of IMS Test 3 (real precomputed decisions, same logic as
 * the full workspace). Loaded only when scrolled into view.
 */
export function LivePreview() {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [replay, setReplay] = useState<Replay | null>(null)
  const [err, setErr] = useState(false)
  const [t, setT] = useState<number | null>(null)
  const [bid, setBid] = useState('3')
  usePreviewFocus(ref, replay != null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect() } }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    api.replay('test3', 'clean').then((r) => {
      setReplay(r)
      setT(r.bearings['3']?.alert_events[0]?.index ?? r.times.length - 1)
    }).catch(() => setErr(true))
  }, [visible])

  const n = replay?.times.length ?? 0
  const lo = useMemo(() => Math.max(0, n - 600), [n]) // the last ~4 days of the run
  const tt = t == null ? 0 : Math.min(Math.max(t, lo), n - 1)
  const ranked = useMemo(() => (replay ? priorityOrder(Object.keys(replay.bearings).map((b) => bearingNow(replay, b, tt))) : []), [replay, tt])
  const ev = replay ? evidenceAt(replay, bid, tt) : null
  const b = replay?.bearings[bid]

  return (
    <div ref={ref} className="preview-frame" aria-label="Working preview of the TOCSIN replay">
      <div className="preview-bar">
        <span className="dots" aria-hidden="true"><i /><i /><i /></span>
        <span className="small"><strong>Recorded replay</strong> <span className="muted">Real IMS Test 3 readings with precomputed decisions. Drag through the last four days.</span></span>
        <Link to="/demo/test3?guide=alert&b=3" className="btn btn-sm">Open full replay</Link>
      </div>
      {!replay ? (
        <div className="preview-body preview-loading">{err ? <span className="muted">The preview could not load. The replay itself is at /demo.</span> : <><span className="spinner" /> <span className="muted">Loading real replay data…</span></>}</div>
      ) : (
        <div className="preview-body">
          <aside className="preview-prio">
            <p className="mono-label" style={{ padding: '0 8px' }}>Bearings by priority</p>
            <ol>
              {ranked.map((r, i) => (
                <li key={r.bearing}>
                  <button className={String(r.bearing) === bid ? 'on' : ''} aria-pressed={String(r.bearing) === bid} onClick={() => setBid(String(r.bearing))}>
                    <span className="num rank">{i + 1}</span>
                    <span>Bearing {r.bearing}</span>
                    <StateBadge state={r.effective} compact />
                  </button>
                </li>
              ))}
            </ol>
          </aside>
          <div className="preview-main">
            <div className="preview-head">
              <span className="num"><strong>{fmtStamp(replay.times[tt])}</strong> · {fmtDuration(hoursBetween(replay.times[tt], replay.times[n - 1]))} before the recording endpoint</span>
              <input type="range" min={lo} max={n - 1} value={tt} onChange={(e) => setT(Number(e.target.value))} aria-label="Move through the last four days of IMS Test 3" />
            </div>
            <p className="preview-sentence">{ev?.sentence}</p>
            {ev && ev.baselineReady && (
              <dl className="preview-stats">
                <div><dt>Band</dt><dd>{ev.family_label ?? '—'}</dd></div>
                <div><dt>Now vs reference</dt><dd>{ev.current_prom_db != null && ev.reference_prom_db != null ? `${ev.current_prom_db.toFixed(1)} / ${ev.reference_prom_db.toFixed(1)} dB` : '—'}</dd></div>
                <div><dt>Score / threshold</dt><dd>{ev.score != null ? `${ev.score.toFixed(1)} / ${ev.threshold}` : '—'}</dd></div>
                <div><dt>Persistence</dt><dd>{ev.persistence.count} of {ev.persistence.required}</dd></div>
              </dl>
            )}
            {b && (
              <TrendChart title={`Bearing ${bid} score, IMS Test 3`} times={replay.times} score={b.detectors.tocsin.score} valid={b.valid}
                threshold={replay.thresholds.tocsin} t={tt} scoreFrom={referenceReadyIndex(b)} from={lo}
                strips={DETECTORS.map((d) => ({ label: d.label, effective: b.detectors[d.id].effective, color: d.color }))} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
